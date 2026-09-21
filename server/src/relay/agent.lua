--[[
    Roblox Client MCP :: executor agent
    ---------------------------------------------------------------------------
    Served by the relay as the body of

        loadstring(game:HttpGet("<host>/api/loader/<connect-key>"))()

    Executors have no native WebSocket, so the agent speaks HTTP long-polling:
    it POSTs its console output and command results, and the same response
    carries back any commands the AI queued up.

    The CONFIG line below is rewritten per account by the relay.
]]

-- stylua: ignore
local CONFIG = __RCB_CONFIG__

--------------------------------------------------------------------------- json

local jsonNull = setmetatable({}, { __tostring = function()
	return "null"
end })

local arrayMarker = { __jsonArray = true }

local function jsonArray(list)
	return setmetatable(list or {}, arrayMarker)
end

local jsonEscapes = {
	['"'] = '\\"',
	["\\"] = "\\\\",
	["\b"] = "\\b",
	["\f"] = "\\f",
	["\n"] = "\\n",
	["\r"] = "\\r",
	["\t"] = "\\t",
}

local function jsonQuote(raw)
	return '"' .. raw:gsub('[%z\1-\31\\"]', function(char)
		return jsonEscapes[char] or string.format("\\u%04x", string.byte(char))
	end) .. '"'
end

local function jsonEncode(value, seen)
	seen = seen or {}
	if value == nil or value == jsonNull then
		return "null"
	end

	local kind = type(value)
	if kind == "boolean" then
		return value and "true" or "false"
	end
	if kind == "number" then
		if value ~= value or value == math.huge or value == -math.huge then
			return "null"
		end
		if value % 1 == 0 and math.abs(value) < 2 ^ 53 then
			return string.format("%d", math.floor(value))
		end
		return string.format("%.14g", value)
	end
	if kind == "string" then
		return jsonQuote(value)
	end
	if kind ~= "table" then
		return jsonQuote(tostring(value))
	end

	if seen[value] then
		return "null"
	end
	seen[value] = true

	local count = 0
	local isArray = getmetatable(value) == arrayMarker
	for key in pairs(value) do
		count = count + 1
		if type(key) ~= "number" then
			isArray = false
		end
	end
	if count > 0 and isArray ~= true then
		isArray = false
	elseif count > 0 and getmetatable(value) == arrayMarker then
		isArray = true
	elseif count > 0 then
		local contiguous = true
		for index = 1, count do
			if value[index] == nil then
				contiguous = false
				break
			end
		end
		isArray = contiguous
	end

	local out
	if isArray then
		local parts = {}
		for index = 1, #value do
			parts[index] = jsonEncode(value[index], seen)
		end
		out = "[" .. table.concat(parts, ",") .. "]"
	elseif count == 0 then
		out = "{}"
	else
		local parts = {}
		for key, item in pairs(value) do
			local keyString = type(key) == "string" and key or tostring(key)
			parts[#parts + 1] = jsonQuote(keyString) .. ":" .. jsonEncode(item, seen)
		end
		out = "{" .. table.concat(parts, ",") .. "}"
	end

	seen[value] = nil
	return out
end

local function jsonDecode(text)
	if type(text) ~= "string" or text == "" then
		return nil
	end

	local position = 1
	local parseValue

	local function skipWhitespace()
		while true do
			local char = text:sub(position, position)
			if char == " " or char == "\t" or char == "\n" or char == "\r" then
				position = position + 1
			else
				return
			end
		end
	end

	local function parseString()
		position = position + 1
		local buffer = {}
		while true do
			local char = text:sub(position, position)
			if char == "" then
				error("unterminated string")
			end
			if char == '"' then
				position = position + 1
				return table.concat(buffer)
			end
			if char == "\\" then
				local escape = text:sub(position + 1, position + 1)
				if escape == "n" then
					buffer[#buffer + 1] = "\n"
				elseif escape == "t" then
					buffer[#buffer + 1] = "\t"
				elseif escape == "r" then
					buffer[#buffer + 1] = "\r"
				elseif escape == "b" then
					buffer[#buffer + 1] = "\b"
				elseif escape == "f" then
					buffer[#buffer + 1] = "\f"
				elseif escape == "u" then
					local code = tonumber(text:sub(position + 2, position + 5), 16) or 63
					buffer[#buffer + 1] = code < 128 and string.char(code) or "?"
					position = position + 4
				else
					buffer[#buffer + 1] = escape
				end
				position = position + 2
			else
				buffer[#buffer + 1] = char
				position = position + 1
			end
		end
	end

	local function parseNumber()
		local startPosition = position
		while text:sub(position, position):match("[%d%.eE%+%-]") do
			position = position + 1
		end
		local number = tonumber(text:sub(startPosition, position - 1))
		if number == nil then
			error("invalid number")
		end
		return number
	end

	local function parseArray()
		position = position + 1
		local out = {}
		skipWhitespace()
		if text:sub(position, position) == "]" then
			position = position + 1
			return out
		end
		while true do
			skipWhitespace()
			table.insert(out, parseValue())
			skipWhitespace()
			local char = text:sub(position, position)
			if char == "," then
				position = position + 1
			elseif char == "]" then
				position = position + 1
				return out
			else
				error("expected , or ]")
			end
		end
	end

	local function parseObject()
		position = position + 1
		local out = {}
		skipWhitespace()
		if text:sub(position, position) == "}" then
			position = position + 1
			return out
		end
		while true do
			skipWhitespace()
			local key = parseString()
			skipWhitespace()
			if text:sub(position, position) ~= ":" then
				error("expected :")
			end
			position = position + 1
			skipWhitespace()
			out[key] = parseValue()
			skipWhitespace()
			local char = text:sub(position, position)
			if char == "," then
				position = position + 1
			elseif char == "}" then
				position = position + 1
				return out
			else
				error("expected , or }")
			end
		end
	end

	parseValue = function()
		skipWhitespace()
		local char = text:sub(position, position)
		if char == "{" then
			return parseObject()
		end
		if char == "[" then
			return parseArray()
		end
		if char == '"' then
			return parseString()
		end
		if char == "t" and text:sub(position, position + 3) == "true" then
			position = position + 4
			return true
		end
		if char == "f" and text:sub(position, position + 4) == "false" then
			position = position + 5
			return false
		end
		if char == "n" and text:sub(position, position + 3) == "null" then
			position = position + 4
			return nil
		end
		if char:match("[%d%-]") then
			return parseNumber()
		end
		error("unexpected character at " .. position)
	end

	local ok, result = pcall(parseValue)
	if not ok then
		return nil
	end
	return result
end

-------------------------------------------------------------------------- agent

local ok, err = pcall(function()
	local Players = game:GetService("Players")
	local RunService = game:GetService("RunService")
	local LogService = game:GetService("LogService")
	local StarterGui = game:GetService("StarterGui")
	local MarketplaceService = game:GetService("MarketplaceService")

	local LocalPlayer = Players.LocalPlayer
	local START_TIME = os.time()
	local executorEnv = (type(getgenv) == "function" and getgenv()) or _G

	------------------------------------------------------------------- transport

	local function findRequestFunction()
		-- Built imperatively: a table literal with a nil hole would silently
		-- truncate under ipairs and hide later candidates.
		local found
		local function consider(fn)
			if found == nil and type(fn) == "function" then
				found = fn
			end
		end
		consider(syn and syn.request)
		consider(http and http.request)
		consider(executorEnv and executorEnv.http_request)
		consider(executorEnv and executorEnv.request)
		consider(executorEnv and executorEnv.syn and executorEnv.syn.request)
		consider(rawget(_G, "http_request"))
		consider(rawget(_G, "request"))
		return found
	end

	local httpRequest = findRequestFunction()
	if not httpRequest then
		error("no HTTP request function available (request / syn.request / http_request)")
	end

	local function post(path, payload)
		local response = httpRequest({
			Url = CONFIG.baseUrl .. path,
			Method = "POST",
			Headers = {
				["Content-Type"] = "application/json",
				["X-Connect-Key"] = CONFIG.connectKey,
			},
			Body = jsonEncode(payload),
		})
		if type(response) ~= "table" then
			return nil, "no response"
		end
		local status = response.StatusCode or response.Status or 0
		if status < 200 or status >= 300 then
			return nil, "http " .. tostring(status)
		end
		local decoded = jsonDecode(response.Body or response.body or "")
		if type(decoded) ~= "table" then
			return nil, "malformed response"
		end
		return decoded
	end

	--------------------------------------------------------------- value helpers

	local function placeName()
		local name = ""
		pcall(function()
			name = MarketplaceService:GetProductInfo(game.PlaceId).Name
		end)
		return name
	end

	local function getPath(instance)
		if typeof(instance) ~= "Instance" then
			return nil
		end
		local parts = {}
		local current = instance
		while current and current ~= game do
			table.insert(parts, 1, current.Name)
			current = current.Parent
		end
		return "game." .. table.concat(parts, ".")
	end

	local function resolvePath(path)
		if path == nil or path == "" or path == "game" then
			return game
		end

		local current
		local rest
		local serviceName, remainder = path:match('^game:GetService%s*%(%s*["\']([%w_]+)["\']%s*%)%.?(.*)$')
		if serviceName then
			local okService, service = pcall(function()
				return game:GetService(serviceName)
			end)
			if not okService or not service then
				return nil, "no such service: " .. serviceName
			end
			current = service
			rest = remainder or ""
		else
			current = game
			rest = path:match("^game%.(.*)$") or path
			if path:sub(1, 4) ~= "game" then
				rest = path
			end
		end

		for segment in rest:gmatch("[^%.]+") do
			if segment ~= "" then
				if not current then
					return nil, "path broke at '" .. segment .. "'"
				end
				local child = current:FindFirstChild(segment)
				if not child then
					return nil, "no child '" .. segment .. "' under " .. tostring(current:GetFullName())
				end
				current = child
			end
		end
		return current
	end

	local MAX_DEPTH = 8

	local function serialize(value, depth, seen)
		depth = depth or 0
		seen = seen or {}
		local kind = typeof(value)

		if value == nil then
			return nil
		end
		if kind == "boolean" or kind == "string" then
			return value
		end
		if kind == "number" then
			if value ~= value or value == math.huge or value == -math.huge then
				return tostring(value)
			end
			return value
		end
		if kind == "Instance" then
			return {
				__type = "Instance",
				className = value.ClassName,
				name = value.Name,
				path = getPath(value),
			}
		end
		if kind == "Vector3" then
			return { __type = "Vector3", x = value.X, y = value.Y, z = value.Z }
		end
		if kind == "Vector2" then
			return { __type = "Vector2", x = value.X, y = value.Y }
		end
		if kind == "CFrame" then
			return { __type = "CFrame", position = { x = value.X, y = value.Y, z = value.Z } }
		end
		if kind == "Color3" then
			return { __type = "Color3", r = value.R, g = value.G, b = value.B }
		end
		if kind == "BrickColor" then
			return { __type = "BrickColor", name = value.Name, number = value.Number }
		end
		if kind == "UDim2" then
			return {
				__type = "UDim2",
				x = { scale = value.X.Scale, offset = value.X.Offset },
				y = { scale = value.Y.Scale, offset = value.Y.Offset },
			}
		end
		if kind == "UDim" then
			return { __type = "UDim", scale = value.Scale, offset = value.Offset }
		end
		if kind == "EnumItem" then
			return { __type = "EnumItem", enum = tostring(value.EnumType), name = value.Name }
		end
		if kind == "function" then
			return { __type = "function", description = tostring(value) }
		end
		if kind == "thread" then
			return { __type = "thread" }
		end

		if kind == "table" then
			if seen[value] then
				return { __type = "table", circular = true }
			end
			if depth >= MAX_DEPTH then
				return { __type = "table", truncated = true }
			end
			seen[value] = true

			local out = {}
			for key, item in pairs(value) do
				local encoded = serialize(item, depth + 1, seen)
				out[key] = encoded == nil and jsonNull or encoded
			end
			seen[value] = nil
			return out
		end

		return tostring(value)
	end

	local function deserialize(value)
		if type(value) ~= "table" then
			return value
		end

		local marker = value.__type
		if marker == "Vector3" then
			return Vector3.new(value.x, value.y, value.z)
		elseif marker == "Vector2" then
			return Vector2.new(value.x, value.y)
		elseif marker == "CFrame" then
			return CFrame.new(value.position.x, value.position.y, value.position.z)
		elseif marker == "Color3" then
			return Color3.new(value.r, value.g, value.b)
		elseif marker == "BrickColor" then
			return BrickColor.new(value.name or value.number)
		elseif marker == "UDim2" then
			return UDim2.new(value.x.scale, value.x.offset, value.y.scale, value.y.offset)
		elseif marker == "UDim" then
			return UDim.new(value.scale, value.offset)
		elseif marker == "EnumItem" then
			local enumType = tostring(value.enum):match("Enum%.(%w+)") or tostring(value.enum)
			local okItem, enumItem = pcall(function()
				return Enum[enumType][value.name]
			end)
			return okItem and enumItem or nil
		elseif marker == "Instance" then
			if not value.path then
				return nil
			end
			return (resolvePath(value.path))
		end

		local out = {}
		for key, item in pairs(value) do
			if item ~= jsonNull then
				out[key] = deserialize(item)
			end
		end
		return out
	end

	local function packValues(results)
		local values = jsonArray({})
		for index = 2, math.min(results.n, 9) do
			local encoded = serialize(results[index], 0, {})
			values[index - 1] = encoded == nil and jsonNull or encoded
		end
		return values
	end

	----------------------------------------------------------------- console tee

	local consoleQueue = jsonArray({})
	local CONSOLE_FLUSH_LIMIT = 200

	local messageLevels = {
		[Enum.MessageType.MessageOutput] = "print",
		[Enum.MessageType.MessageWarning] = "warn",
		[Enum.MessageType.MessageError] = "error",
		[Enum.MessageType.MessageInfo] = "info",
	}

	LogService.MessageOut:Connect(function(message, messageType)
		if #consoleQueue >= CONSOLE_FLUSH_LIMIT then
			return
		end
		table.insert(consoleQueue, {
			level = messageLevels[messageType] or "game",
			message = tostring(message),
		})
	end)

	------------------------------------------------------------------ remote spy

	local spy = { active = false, logs = jsonArray({}), limit = 300, serial = 0 }

	local function spyRecord(kind, self, method, args)
		if not spy.active then
			return
		end
		spy.serial = spy.serial + 1
		table.insert(spy.logs, {
			index = spy.serial,
			kind = kind,
			target = (typeof(self) == "Instance") and {
				name = self.Name,
				className = self.ClassName,
				path = getPath(self),
			} or { name = tostring(self) },
			method = method,
			args = serialize(args, 0, {}),
		})
		while #spy.logs > spy.limit do
			table.remove(spy.logs, 1)
		end
	end

	local spyInstalled = false
	local function installSpy()
		if spyInstalled then
			return true
		end
		if type(getrawmetatable) ~= "function" or type(newcclosure) ~= "function" then
			return false
		end
		local rawMeta = getrawmetatable(game)
		if type(rawMeta) ~= "table" then
			return false
		end

		local oldNamecall = rawMeta.__namecall
		setreadonly(rawMeta, false)
		rawMeta.__namecall = newcclosure(function(self, ...)
			local method = getnamecallmethod()
			if spy.active and not checkcaller() and tostring(method) ~= "HttpGet" then
				pcall(spyRecord, "namecall", self, tostring(method), { ... })
			end
			return oldNamecall(self, ...)
		end)
		setreadonly(rawMeta, true)

		spyInstalled = true
		return true
	end

	------------------------------------------------------------------- handlers

	local handlers = {}

	handlers["ping"] = function()
		return { ok = true, pong = os.time() }
	end

	handlers["status"] = function()
		local executorName = CONFIG.executorName
		local executorVersion = ""
		pcall(function()
			local name, version = IdentifyExecutor()
			if name then
				executorName = tostring(name)
			end
			if version then
				executorVersion = tostring(version)
			end
		end)
		return {
			executor = executorName,
			executorVersion = executorVersion,
			gameName = placeName(),
			placeId = game.PlaceId,
			jobId = game.JobId,
			playerName = LocalPlayer and LocalPlayer.Name or "unknown",
			playerUserId = LocalPlayer and LocalPlayer.UserId or 0,
			platform = RunService:IsStudio() and "studio" or "client",
			startedAt = START_TIME,
			uptimeSeconds = os.time() - START_TIME,
		}
	end

	handlers["exec"] = function(params)
		if type(params.code) ~= "string" then
			return { ok = false, error = "code must be a string" }
		end
		local chunk, compileError = loadstring(params.code, "=rcm")
		if not chunk then
			return { ok = false, error = "compile error: " .. tostring(compileError) }
		end
		local results = table.pack(pcall(chunk))
		if not results[1] then
			return { ok = false, error = tostring(results[2]) }
		end
		return { ok = true, values = packValues(results), returned = results.n - 1 }
	end

	handlers["eval"] = function(params)
		if type(params.expression) ~= "string" then
			return { ok = false, error = "expression must be a string" }
		end
		local chunk, compileError = loadstring("return " .. params.expression, "=rcm-eval")
		if not chunk then
			return { ok = false, error = "compile error: " .. tostring(compileError) }
		end
		local results = table.pack(pcall(chunk))
		if not results[1] then
			return { ok = false, error = tostring(results[2]) }
		end
		return { ok = true, values = packValues(results), returned = results.n - 1 }
	end

	handlers["game.info"] = function()
		return {
			placeId = game.PlaceId,
			gameId = game.GameId,
			jobId = game.JobId,
			placeName = placeName(),
			creatorId = game.CreatorId,
			creatorType = tostring(game.CreatorType),
			playerCount = #Players:GetPlayers(),
			maxPlayers = Players.MaxPlayers,
			isStudio = RunService:IsStudio(),
			uptimeSeconds = os.time() - START_TIME,
		}
	end

	handlers["players.list"] = function()
		local out = jsonArray({})
		for _, player in ipairs(Players:GetPlayers()) do
			local character = player.Character
			local humanoid = character and character:FindFirstChildOfClass("Humanoid")
			local root = character and character:FindFirstChild("HumanoidRootPart")
			table.insert(out, {
				name = player.Name,
				displayName = player.DisplayName,
				userId = player.UserId,
				isLocalPlayer = player == LocalPlayer,
				accountAgeDays = player.AccountAge,
				health = humanoid and humanoid.Health or nil,
				maxHealth = humanoid and humanoid.MaxHealth or nil,
				position = root and serialize(root.Position, 0, {}) or nil,
				path = getPath(player),
			})
		end
		return { ok = true, players = out, count = #out }
	end

	handlers["workspace.tree"] = function(params)
		local root, resolveError = resolvePath(params.path or "game.Workspace")
		if not root then
			return { ok = false, error = resolveError }
		end
		local depth = math.clamp(tonumber(params.depth) or 2, 0, 6)
		local maxChildren = math.clamp(tonumber(params.maxChildren) or 40, 1, 500)

		local function walk(instance, remaining)
			local node = { name = instance.Name, className = instance.ClassName }
			if remaining <= 0 then
				node.childCount = #instance:GetChildren()
				return node
			end
			local children = instance:GetChildren()
			local shown = math.min(#children, maxChildren)
			local packed = jsonArray({})
			for index = 1, shown do
				table.insert(packed, walk(children[index], remaining - 1))
			end
			node.children = packed
			if #children > shown then
				node.omitted = #children - shown
			end
			return node
		end

		return { ok = true, tree = walk(root, depth), path = getPath(root) }
	end

	handlers["instance.get"] = function(params)
		local instance, resolveError = resolvePath(params.path)
		if not instance then
			return { ok = false, error = resolveError }
		end

		local properties = {}
		local wanted = params.properties
		if type(wanted) ~= "table" then
			wanted = {
				"Position", "Size", "Value", "Text", "Enabled", "Visible", "Transparency",
				"Health", "WalkSpeed", "JumpPower", "Anchored", "CanCollide", "Material",
				"Color", "BrickColor", "Shape", "UserId", "DisplayName", "Team",
			}
		end
		for _, property in ipairs(wanted) do
			local okValue, value = pcall(function()
				return instance[property]
			end)
			if okValue and value ~= nil then
				properties[property] = serialize(value, 0, {})
			end
		end

		return {
			ok = true,
			name = instance.Name,
			className = instance.ClassName,
			path = getPath(instance),
			childCount = #instance:GetChildren(),
			children = (function()
				local packed = jsonArray({})
				for _, child in ipairs(instance:GetChildren()) do
					table.insert(packed, { name = child.Name, className = child.ClassName })
				end
				return packed
			end)(),
			attributes = (function()
				local okAttributes, attributes = pcall(function()
					return instance:GetAttributes()
				end)
				return okAttributes and serialize(attributes, 0, {}) or {}
			end)(),
			properties = properties,
		}
	end

	handlers["instance.set"] = function(params)
		local instance, resolveError = resolvePath(params.path)
		if not instance then
			return { ok = false, error = resolveError }
		end
		local okSet, setError = pcall(function()
			instance[params.property] = deserialize(params.value)
		end)
		if not okSet then
			return { ok = false, error = tostring(setError) }
		end
		local readBack
		pcall(function()
			readBack = instance[params.property]
		end)
		return { ok = true, value = serialize(readBack, 0, {}) }
	end

	handlers["instance.call"] = function(params)
		local instance, resolveError = resolvePath(params.path)
		if not instance then
			return { ok = false, error = resolveError }
		end
		local args = {}
		if type(params.args) == "table" then
			for index, value in ipairs(params.args) do
				args[index] = deserialize(value)
			end
		end
		local results = table.pack(pcall(function()
			return instance[params.method](instance, unpack(args))
		end))
		if not results[1] then
			return { ok = false, error = tostring(results[2]) }
		end
		return { ok = true, values = packValues(results) }
	end

	handlers["instance.find"] = function(params)
		local limit = math.clamp(tonumber(params.limit) or 100, 1, 2000)
		local nameFilter = params.name and string.lower(tostring(params.name)) or nil
		local classFilter = params.className and string.lower(tostring(params.className)) or nil

		local scanned = 0
		local results = jsonArray({})
		local okScan = pcall(function()
			for _, instance in ipairs(game:GetDescendants()) do
				scanned = scanned + 1
				if #results >= limit then
					return
				end
				local matchesName = (not nameFilter)
					or string.find(string.lower(instance.Name), nameFilter, 1, true) ~= nil
				local matchesClass = (not classFilter)
					or string.find(string.lower(instance.ClassName), classFilter, 1, true) ~= nil
				if matchesName and matchesClass then
					table.insert(results, {
						name = instance.Name,
						className = instance.ClassName,
						path = getPath(instance),
					})
				end
			end
		end)
		if not okScan then
			return { ok = false, error = "instance scan failed" }
		end
		return { ok = true, results = results, count = #results, scanned = scanned }
	end

	handlers["scripts.list"] = function(params)
		local limit = math.clamp(tonumber(params.limit) or 200, 1, 2000)
		local kind = params.kind or "scripts"
		local filter = params.filter and string.lower(tostring(params.filter)) or nil

		local sources = { scripts = getscripts, modules = getmodules, running = getrunningscripts, loaded = getloadedmodules }
		local fetch = sources[kind] or sources.scripts
		local okFetch, list = pcall(fetch, true)
		if not okFetch or type(list) ~= "table" then
			okFetch, list = pcall(fetch)
		end
		if not okFetch or type(list) ~= "table" then
			return { ok = false, error = "could not enumerate " .. tostring(kind) }
		end

		local out = jsonArray({})
		for _, script in ipairs(list) do
			if #out >= limit then
				break
			end
			local hash
			pcall(function()
				hash = getscripthash(script)
			end)
			if not filter or string.find(string.lower(script.Name), filter, 1, true) then
				table.insert(out, {
					name = script.Name,
					className = script.ClassName,
					path = getPath(script),
					hash = hash,
				})
			end
		end
		return { ok = true, scripts = out, count = #out, total = #list, kind = kind }
	end

	handlers["scripts.decompile"] = function(params)
		local target, resolveError = resolvePath(params.path)
		if not target then
			return { ok = false, error = resolveError }
		end
		local okDecompile, source = pcall(decompile, target)
		if not okDecompile or type(source) ~= "string" then
			return { ok = false, error = "decompile failed for " .. tostring(params.path) }
		end
		local bytecode
		pcall(function()
			bytecode = getscriptbytecode(target)
		end)
		return {
			ok = true,
			path = getPath(target),
			className = target.ClassName,
			source = source,
			bytecodeLength = type(bytecode) == "string" and #bytecode or nil,
		}
	end

	handlers["signal.connections"] = function(params)
		local instance, resolveError = resolvePath(params.path)
		if not instance then
			return { ok = false, error = resolveError }
		end
		local signal = instance[params.signal]
		if not signal then
			return { ok = false, error = "no such signal: " .. tostring(params.signal) }
		end
		local okConnections, connections = pcall(getconnections, signal)
		if not okConnections or type(connections) ~= "table" then
			return { ok = false, error = "getconnections is unavailable in this executor" }
		end

		local out = jsonArray({})
		for index, connection in ipairs(connections) do
			local entry = { index = index }
			pcall(function()
				entry.enabled = isconnectionenabled(connection)
			end)
			pcall(function()
				entry.script = connection.Script and getPath(connection.Script) or nil
			end)
			pcall(function()
				entry["function"] = connection.Function and tostring(connection.Function) or nil
			end)
			table.insert(out, entry)
		end

		local declaredArguments
		pcall(function()
			declaredArguments = getsignalarguments(signal)
		end)
		return { ok = true, connections = out, count = #out, declaredArguments = declaredArguments }
	end

	handlers["remotes.spy"] = function(params)
		local action = params.action or "dump"
		if action == "start" then
			if not installSpy() then
				return { ok = false, error = "this executor does not support metatable hooking" }
			end
			spy.active = true
			spy.logs = jsonArray({})
			spy.serial = 0
			return { ok = true, active = true }
		elseif action == "stop" then
			spy.active = false
			return { ok = true, active = false }
		elseif action == "clear" then
			spy.logs = jsonArray({})
			spy.serial = 0
			return { ok = true, active = spy.active }
		elseif action == "dump" then
			return { ok = true, active = spy.active, logs = spy.logs, count = #spy.logs }
		end
		return { ok = false, error = "unknown action: " .. tostring(action) }
	end

	handlers["remotes.fire"] = function(params)
		local instance, resolveError = resolvePath(params.path)
		if not instance then
			return { ok = false, error = resolveError }
		end
		local args = {}
		if type(params.args) == "table" then
			for index, value in ipairs(params.args) do
				args[index] = deserialize(value)
			end
		end
		local method = params.method or "FireServer"
		local okFire, fireError = pcall(function()
			instance[method](instance, unpack(args))
		end)
		if not okFire then
			return { ok = false, error = tostring(fireError) }
		end
		return { ok = true, called = method }
	end

	handlers["http.request"] = function(params)
		local response = httpRequest({
			Url = params.url,
			Method = params.method or "GET",
			Headers = params.headers or {},
			Body = params.body,
		})
		if type(response) ~= "table" then
			return { ok = false, error = "no response" }
		end
		return {
			ok = true,
			status = response.StatusCode or response.Status,
			body = tostring(response.Body or response.body or ""):sub(1, 200000),
		}
	end

	handlers["gui.hint"] = function(params)
		pcall(function()
			StarterGui:SetCore("SendNotification", {
				Title = tostring(params.title or "Roblox Client MCP"),
				Text = tostring(params.text or "Hello from your AI"),
				Duration = tonumber(params.duration) or 5,
			})
		end)
		return { ok = true }
	end

	------------------------------------------------------------------ main loop

	local bootId = tostring(os.time()) .. "-" .. tostring(math.random(1, 100000000))
	local pendingResults = jsonArray({})
	local agentInfo
	pcall(function()
		agentInfo = handlers["status"]({})
	end)

	local firstSync = true
	local running = true
	local consecutiveFailures = 0

	while running do
		local body = {
			bootId = bootId,
			info = firstSync and agentInfo or nil,
			results = pendingResults,
			console = consoleQueue,
		}
		pendingResults = jsonArray({})
		consoleQueue = jsonArray({})

		local response, requestError = post("/api/agent/sync", body)

		if not response then
			consecutiveFailures = consecutiveFailures + 1
			if requestError == "http 404" or requestError == "http 401" then
				warn("[RCB] relay rejected this session (" .. tostring(requestError) .. "), stopping agent")
				running = false
			else
				task.wait(math.min(2 ^ math.min(consecutiveFailures, 4), 15))
			end
		else
			consecutiveFailures = 0
			firstSync = false

			for _, command in ipairs(response.commands or {}) do
				local okExecute, result = pcall(function()
					local handler = handlers[command.method]
					local startedAt = os.clock()
					if not handler then
						return {
							id = command.id,
							ok = false,
							error = "unknown method: " .. tostring(command.method),
						}
					end

					local results = table.pack(pcall(handler, command.params or {}))
					local durationMs = math.floor((os.clock() - startedAt) * 1000)

					if not results[1] then
						return { id = command.id, ok = false, error = tostring(results[2]), durationMs = durationMs }
					end

					local payload = results[2]
					if type(payload) ~= "table" then
						payload = { value = payload }
					end

					-- Handlers signal failure with `ok = false`; everything else is a
					-- success whose table becomes the command's `result`.
					if payload.ok == false then
						return {
							id = command.id,
							ok = false,
							error = tostring(payload.error or "handler failed"),
							durationMs = durationMs,
						}
					end
					payload.ok = nil

					return {
						id = command.id,
						ok = true,
						result = payload,
						durationMs = durationMs,
					}
				end)

				if okExecute then
					table.insert(pendingResults, result)
				else
					table.insert(pendingResults, { id = command.id, ok = false, error = tostring(result) })
				end
			end
		end
	end
end)

if not ok then
	warn("[RCB] agent stopped: " .. tostring(err))
end
