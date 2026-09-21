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

	------------------------------------------------------ remote spy and hooks

	-- A single metamethod hook serves both the passive spy and targeted remote
	-- hooks (log or block one specific remote). Nothing is installed until one of
	-- them is asked for, and the idle path is one boolean check.
	local hookState = {
		spyActive = false,
		spyLogs = jsonArray({}),
		spySerial = 0,
		spyLimit = 300,
		remoteHooks = {},
		hookCount = 0,
		installed = false,
	}

	local function hookActive()
		return hookState.spyActive or hookState.hookCount > 0
	end

	local function safePath(instance)
		local okPath, path = pcall(getPath, instance)
		if okPath then
			return path
		end
		return nil
	end

	local function describeTarget(self)
		if typeof(self) == "Instance" then
			return { name = self.Name, className = self.ClassName, path = safePath(self) }
		end
		return { name = tostring(self) }
	end

	-- Returns true when the call should be swallowed.
	local function applyHooks(self, method, args)
		local targetPath
		if hookState.hookCount > 0 and typeof(self) == "Instance" then
			targetPath = safePath(self)
		end

		if targetPath then
			local rule = hookState.remoteHooks[targetPath]
			if rule and (rule.method == nil or rule.method == method) then
				rule.count = rule.count + 1
				rule.lastAt = os.time()
				table.insert(rule.logs, {
					index = rule.count,
					method = method,
					args = serialize(args, 0, {}),
				})
				while #rule.logs > rule.limit do
					table.remove(rule.logs, 1)
				end
				if rule.mode == "block" then
					return true
				end
			end
		end

		if hookState.spyActive then
			hookState.spySerial = hookState.spySerial + 1
			table.insert(hookState.spyLogs, {
				index = hookState.spySerial,
				kind = "namecall",
				target = describeTarget(self),
				method = method,
				args = serialize(args, 0, {}),
			})
			while #hookState.spyLogs > hookState.spyLimit do
				table.remove(hookState.spyLogs, 1)
			end
		end

		return false
	end

	local function installHook()
		if hookState.installed then
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
			-- Fast path: varargs are used in this same function, never captured.
			if not hookActive() then
				return oldNamecall(self, ...)
			end

			local method = tostring(getnamecallmethod())
			if method ~= "HttpGet" and method ~= "HttpGetAsync" and not checkcaller() then
				local okCall, shouldBlock = pcall(applyHooks, self, method, { ... })
				if okCall and shouldBlock then
					return nil
				end
			end
			return oldNamecall(self, ...)
		end)
		setreadonly(rawMeta, true)

		hookState.installed = true
		return true
	end

	------------------------------------------------------------------- handlers

	local handlers = {}

	-------------------------------------------------------------------- helpers

	local function resolvePlayer(nameOrId)
		if nameOrId == nil or nameOrId == "" then
			return LocalPlayer
		end
		local target = tostring(nameOrId)
		local lower = string.lower(target)
		local partial
		for _, player in ipairs(Players:GetPlayers()) do
			if player.Name == target or tostring(player.UserId) == target then
				return player
			end
			if not partial and string.find(string.lower(player.Name), lower, 1, true) then
				partial = player
			end
		end
		return partial
	end

	local function rootPartOf(character)
		if not character then
			return nil
		end
		return character.PrimaryPart or character:FindFirstChild("HumanoidRootPart")
	end

	-- Wall clock, not CPU time. os.clock() does not advance while the thread
	-- yields, so a deadline built on it never expires inside a task.wait loop.
	local function nowSeconds()
		if type(tick) == "function" then
			return tick()
		end
		return os.clock()
	end

	local function leaderstatsOf(player)
		local stats = {}
		local container = player:FindFirstChild("leaderstats")
		if container then
			for _, stat in ipairs(container:GetChildren()) do
				stats[stat.Name] = serialize(stat.Value, 0, {})
			end
		end
		return stats
	end

	-- Decompiling is expensive, so results (including failures) are cached for
	-- the life of the session, keyed by path plus script hash.
	local decompileCache = {}

	local function decompiledSource(script)
		local path = safePath(script) or tostring(script)
		local hash
		pcall(function()
			hash = getscripthash(script)
		end)
		local key = path .. "|" .. tostring(hash)
		local cached = decompileCache[key]
		if cached ~= nil then
			return cached
		end
		local okDecompile, source = pcall(decompile, script)
		local value = (okDecompile and type(source) == "string") and source or false
		decompileCache[key] = value
		return value
	end

	local function collectScripts(kinds)
		local sources = {
			scripts = getscripts,
			modules = getmodules,
			running = getrunningscripts,
			loaded = getloadedmodules,
		}
		local out, seen = {}, {}
		for _, kind in ipairs(kinds) do
			local fetch = sources[kind]
			if fetch then
				local okFetch, list = pcall(fetch, true)
				if not okFetch then
					okFetch, list = pcall(fetch)
				end
				if okFetch and type(list) == "table" then
					for _, script in ipairs(list) do
						local path = safePath(script) or tostring(script)
						if not seen[path] then
							seen[path] = true
							table.insert(out, script)
						end
					end
				end
			end
		end
		return out
	end

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
			if not installHook() then
				return { ok = false, error = "this executor does not support metatable hooking" }
			end
			hookState.spyActive = true
			hookState.spyLogs = jsonArray({})
			hookState.spySerial = 0
			return { ok = true, active = true }
		elseif action == "stop" then
			hookState.spyActive = false
			return { ok = true, active = false }
		elseif action == "clear" then
			hookState.spyLogs = jsonArray({})
			hookState.spySerial = 0
			return { ok = true, active = hookState.spyActive }
		elseif action == "dump" then
			return {
				ok = true,
				active = hookState.spyActive,
				logs = hookState.spyLogs,
				count = #hookState.spyLogs,
				alsoHooked = hookState.hookCount,
			}
		end
		return { ok = false, error = "unknown action: " .. tostring(action) }
	end

	handlers["remotes.hook"] = function(params)
		local action = params.action or "dump"

		if action == "add" then
			local instance, resolveError = resolvePath(params.path)
			if not instance then
				return { ok = false, error = resolveError }
			end
			local mode = params.mode or "log"
			if mode ~= "log" and mode ~= "block" then
				return { ok = false, error = 'mode must be "log" or "block"' }
			end
			if not installHook() then
				return { ok = false, error = "this executor does not support metatable hooking" }
			end
			local path = getPath(instance)
			if not hookState.remoteHooks[path] then
				hookState.hookCount = hookState.hookCount + 1
			end
			hookState.remoteHooks[path] = {
				path = path,
				name = instance.Name,
				className = instance.ClassName,
				method = params.method,
				mode = mode,
				count = 0,
				lastAt = nil,
				limit = math.clamp(tonumber(params.logLimit) or 100, 1, 500),
				logs = jsonArray({}),
			}
			return { ok = true, hook = hookState.remoteHooks[path] }
		elseif action == "remove" then
			local instance, resolveError = resolvePath(params.path)
			if not instance then
				return { ok = false, error = resolveError }
			end
			local path = getPath(instance)
			if hookState.remoteHooks[path] then
				hookState.remoteHooks[path] = nil
				hookState.hookCount = math.max(0, hookState.hookCount - 1)
				return { ok = true, removed = path }
			end
			return { ok = false, error = "no hook on " .. tostring(path) }
		elseif action == "clear" then
			hookState.remoteHooks = {}
			hookState.hookCount = 0
			return { ok = true, cleared = true }
		elseif action == "dump" then
			local hooks = jsonArray({})
			for _, rule in pairs(hookState.remoteHooks) do
				table.insert(hooks, {
					path = rule.path,
					name = rule.name,
					className = rule.className,
					method = rule.method,
					mode = rule.mode,
					count = rule.count,
					lastAt = rule.lastAt,
					logs = rule.logs,
				})
			end
			return { ok = true, hooks = hooks, count = #hooks }
		end

		return { ok = false, error = "unknown action: " .. tostring(action) }
	end

	handlers["signal.fire"] = function(params)
		local instance, resolveError = resolvePath(params.path)
		if not instance then
			return { ok = false, error = resolveError }
		end
		local signal = instance[params.signal]
		if not signal then
			return { ok = false, error = "no such signal: " .. tostring(params.signal) }
		end
		if type(firesignal) ~= "function" then
			return { ok = false, error = "firesignal is unavailable in this executor" }
		end
		local args = {}
		if type(params.args) == "table" then
			for index, value in ipairs(params.args) do
				args[index] = deserialize(value)
			end
		end
		local okFire, fireError = pcall(firesignal, signal, unpack(args))
		if not okFire then
			return { ok = false, error = tostring(fireError) }
		end
		return { ok = true, fired = tostring(params.signal), argumentCount = #args }
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

	------------------------------------------------------------ player handlers

	handlers["player.local"] = function()
		local player = LocalPlayer
		if not player then
			return { ok = false, error = "there is no local player (still loading?)" }
		end

		local character = player.Character
		local humanoid = character and character:FindFirstChildOfClass("Humanoid")
		local root = rootPartOf(character)
		local camera = game:GetService("Workspace").CurrentCamera

		local velocity
		pcall(function()
			velocity = root and serialize(root.AssemblyLinearVelocity, 0, {}) or nil
		end)

		local humanoidState
		pcall(function()
			humanoidState = humanoid and tostring(humanoid:GetState()) or nil
		end)

		return {
			ok = true,
			name = player.Name,
			displayName = player.DisplayName,
			userId = player.UserId,
			accountAgeDays = player.AccountAge,
			team = player.Team and player.Team.Name or nil,
			characterPath = character and safePath(character) or nil,
			position = root and serialize(root.Position, 0, {}) or nil,
			velocity = velocity,
			health = humanoid and humanoid.Health or nil,
			maxHealth = humanoid and humanoid.MaxHealth or nil,
			walkSpeed = humanoid and humanoid.WalkSpeed or nil,
			jumpPower = humanoid and humanoid.JumpPower or nil,
			humanoidState = humanoidState,
			isSitting = humanoid and humanoid.Sit or nil,
			cameraPosition = camera and serialize(camera.CFrame.Position, 0, {}) or nil,
			leaderstats = leaderstatsOf(player),
		}
	end

	handlers["player.get"] = function(params)
		local player = resolvePlayer(params.nameOrId)
		if not player then
			return { ok = false, error = "no player matching " .. tostring(params.nameOrId) }
		end

		local character = player.Character
		local humanoid = character and character:FindFirstChildOfClass("Humanoid")
		local root = rootPartOf(character)

		local tools = jsonArray({})
		local backpack = player:FindFirstChildOfClass("Backpack")
		if backpack then
			for _, tool in ipairs(backpack:GetChildren()) do
				table.insert(tools, { name = tool.Name, className = tool.ClassName, equipped = false })
			end
		end
		if character then
			for _, tool in ipairs(character:GetChildren()) do
				if tool:IsA("Tool") then
					table.insert(tools, { name = tool.Name, className = tool.ClassName, equipped = true })
				end
			end
		end

		return {
			ok = true,
			name = player.Name,
			displayName = player.DisplayName,
			userId = player.UserId,
			accountAgeDays = player.AccountAge,
			isLocalPlayer = player == LocalPlayer,
			team = player.Team and player.Team.Name or nil,
			path = safePath(player),
			characterPath = character and safePath(character) or nil,
			position = root and serialize(root.Position, 0, {}) or nil,
			health = humanoid and humanoid.Health or nil,
			maxHealth = humanoid and humanoid.MaxHealth or nil,
			walkSpeed = humanoid and humanoid.WalkSpeed or nil,
			leaderstats = leaderstatsOf(player),
			tools = tools,
			toolCount = #tools,
		}
	end

	handlers["player.teleport"] = function(params)
		local player = LocalPlayer
		if not player then
			return { ok = false, error = "there is no local player" }
		end
		local character = player.Character
		if not character then
			return { ok = false, error = "your character is not loaded" }
		end
		local root = rootPartOf(character)
		if not root then
			return { ok = false, error = "your character has no root part" }
		end

		local target
		if params.player then
			local other = resolvePlayer(params.player)
			if not other then
				return { ok = false, error = "no player matching " .. tostring(params.player) }
			end
			local otherRoot = rootPartOf(other.Character)
			if not otherRoot then
				return { ok = false, error = "that player has no loaded character" }
			end
			target = otherRoot.Position
		elseif params.path then
			local instance, resolveError = resolvePath(params.path)
			if not instance then
				return { ok = false, error = resolveError }
			end
			local position = instance.Position
			if not position and instance.CFrame then
				position = instance.CFrame.Position
			end
			if not position then
				return { ok = false, error = "that instance has no Position or CFrame" }
			end
			target = position
		elseif type(params.x) == "number" and type(params.y) == "number" and type(params.z) == "number" then
			target = Vector3.new(params.x, params.y, params.z)
		else
			return { ok = false, error = "give one of: player, path, or x/y/z" }
		end

		local offset = params.offset
		if type(offset) == "table" then
			target = target
				+ Vector3.new(tonumber(offset.x) or 0, tonumber(offset.y) or 0, tonumber(offset.z) or 0)
		end

		local humanoid = character:FindFirstChildOfClass("Humanoid")
		if humanoid and humanoid.Sit then
			pcall(function()
				humanoid.Sit = false
			end)
		end

		local okMove, moveError = pcall(function()
			character:PivotTo(CFrame.new(target))
		end)
		if not okMove then
			okMove, moveError = pcall(function()
				root.CFrame = CFrame.new(target)
			end)
		end
		if not okMove then
			return { ok = false, error = tostring(moveError) }
		end

		return { ok = true, position = serialize(root.Position, 0, {}) }
	end

	--------------------------------------------------------- exploration extras

	handlers["remotes.list"] = function(params)
		local remoteClasses = {
			RemoteEvent = true,
			UnreliableRemoteEvent = true,
			RemoteFunction = true,
			BindableEvent = true,
			BindableFunction = true,
		}
		local kind = params.kind or "all"
		local limit = math.clamp(tonumber(params.limit) or 200, 1, 2000)
		local filter = params.filter and string.lower(tostring(params.filter)) or nil

		local results = jsonArray({})
		local counts = {}
		local scanned = 0

		local okScan = pcall(function()
			for _, instance in ipairs(game:GetDescendants()) do
				local class = instance.ClassName
				if remoteClasses[class] then
					counts[class] = (counts[class] or 0) + 1
					scanned = scanned + 1
					if #results < limit and (kind == "all" or kind == class) then
						if not filter or string.find(string.lower(instance.Name), filter, 1, true) then
							table.insert(results, {
								name = instance.Name,
								className = class,
								path = safePath(instance),
								parentPath = instance.Parent and safePath(instance.Parent) or nil,
							})
						end
					end
				end
			end
		end)
		if not okScan then
			return { ok = false, error = "remote scan failed" }
		end

		return {
			ok = true,
			remotes = results,
			returned = #results,
			totalFound = scanned,
			byClass = counts,
			truncated = #results >= limit,
		}
	end

	handlers["instance.wait"] = function(params)
		if type(params.path) ~= "string" or params.path == "" then
			return { ok = false, error = "path is required" }
		end
		local timeoutMs = math.clamp(tonumber(params.timeoutMs) or 10000, 200, 120000)
		local startedAt = nowSeconds()
		local deadline = startedAt + (timeoutMs / 1000)
		local lastError

		while nowSeconds() < deadline do
			local instance, resolveError = resolvePath(params.path)
			if instance then
				return {
					ok = true,
					found = true,
					name = instance.Name,
					className = instance.ClassName,
					path = safePath(instance),
					childCount = #instance:GetChildren(),
					waitedMs = math.floor((nowSeconds() - startedAt) * 1000),
				}
			end
			lastError = resolveError
			task.wait(0.1)
		end

		return { ok = true, found = false, path = params.path, reason = lastError or "timed out" }
	end

	handlers["asset.info"] = function(params)
		local assetId = tonumber(params.assetId)
		if not assetId then
			return { ok = false, error = "assetId must be a number" }
		end
		local okInfo, info = pcall(function()
			return MarketplaceService:GetProductInfo(assetId)
		end)
		if not okInfo or type(info) ~= "table" then
			return { ok = false, error = "could not fetch asset " .. tostring(assetId) }
		end
		return {
			ok = true,
			assetId = assetId,
			name = info.Name,
			description = info.Description,
			assetTypeId = info.AssetTypeId,
			creator = info.Creator and info.Creator.Name or nil,
			creatorId = info.Creator and info.Creator.CreatorTargetId or nil,
			creatorType = info.Creator and tostring(info.Creator.CreatorType) or nil,
			priceInRobux = info.PriceInRobux,
			isForSale = info.IsForSale,
			isLimited = info.IsLimited,
			created = info.Created,
			updated = info.Updated,
		}
	end

	--------------------------------------------------------------- script tools

	handlers["scripts.search"] = function(params)
		local query = params.query
		if type(query) ~= "string" or query == "" then
			return { ok = false, error = "query is required" }
		end

		local useRegex = params.regex == true
		local pattern = useRegex and query or query:gsub("[%^%$%(%)%%%.%[%]%*%+%-%?]", "%%%0")
		local limit = math.clamp(tonumber(params.limit) or 40, 1, 500)
		local contextChars = math.clamp(tonumber(params.contextChars) or 120, 20, 400)
		local maxScripts = math.clamp(tonumber(params.maxScripts) or 150, 1, 800)

		local kinds = params.kinds
		if type(kinds) ~= "table" or #kinds == 0 then
			kinds = { "loaded", "modules", "scripts" }
		end

		local candidates = collectScripts(kinds)
		local matches = jsonArray({})
		local searched, skipped, truncated = 0, 0, false
		local startedAt = nowSeconds()

		for _, script in ipairs(candidates) do
			if #matches >= limit then
				truncated = true
				break
			end
			if searched >= maxScripts then
				truncated = true
				break
			end

			local source = decompiledSource(script)
			if source then
				searched = searched + 1
				local from = 1
				while #matches < limit do
					local startAt, endAt = string.find(source, pattern, from, not useRegex)
					if not startAt then
						break
					end
					local _, newlineCount = string.gsub(source:sub(1, startAt), "\n", "")
					local snippetStart = math.max(1, startAt - contextChars)
					local snippetEnd = math.min(#source, endAt + contextChars)
					table.insert(matches, {
						script = script.Name,
						path = safePath(script),
						className = script.ClassName,
						line = newlineCount + 1,
						snippet = (snippetStart > 1 and "..." or "")
							.. source:sub(snippetStart, snippetEnd)
							.. (snippetEnd < #source and "..." or ""),
					})
					from = endAt + 1
					if endAt < startAt then
						from = startAt + 1
					end
				end
			else
				skipped = skipped + 1
			end
		end

		return {
			ok = true,
			query = query,
			matches = matches,
			matchCount = #matches,
			scriptsSearched = searched,
			scriptsUnreadable = skipped,
			scriptsConsidered = #candidates,
			truncated = truncated,
			tookMs = math.floor((nowSeconds() - startedAt) * 1000),
		}
	end

	handlers["scripts.upvalues"] = function(params)
		local script, resolveError = resolvePath(params.path)
		if not script then
			return { ok = false, error = resolveError }
		end
		if type(getscriptclosure) ~= "function" then
			return { ok = false, error = "getscriptclosure is unavailable in this executor" }
		end

		local okClosure, closure = pcall(getscriptclosure, script)
		if not okClosure or type(closure) ~= "function" then
			return { ok = false, error = "could not obtain a closure for " .. tostring(params.path) }
		end
		if type(debug) ~= "table" or type(debug.getupvalue) ~= "function" then
			return { ok = false, error = "debug.getupvalue is unavailable" }
		end

		local limit = math.clamp(tonumber(params.limit) or 30, 1, 200)
		local maxPreview = math.clamp(tonumber(params.maxPreview) or 400, 40, 4000)
		local out = jsonArray({})

		for index = 1, limit do
			local okName, name, value = pcall(debug.getupvalue, closure, index)
			if not okName or name == nil then
				break
			end
			local encoded = serialize(value, 0, {})
			local asText = jsonEncode(encoded == nil and jsonNull or encoded)
			local truncated = #asText > maxPreview
			table.insert(out, {
				index = index,
				name = tostring(name),
				type = typeof(value),
				value = truncated and (asText:sub(1, maxPreview) .. "...") or asText,
				truncated = truncated,
			})
		end

		return {
			ok = true,
			path = safePath(script),
			className = script.ClassName,
			count = #out,
			upvalues = out,
		}
	end

	handlers["gc.objects"] = function(params)
		local objectType = params.type or "table"
		if objectType ~= "table" and objectType ~= "function" then
			return { ok = false, error = 'type must be "table" or "function"' }
		end

		local limit = math.clamp(tonumber(params.limit) or 20, 1, 200)
		local maxPreview = math.clamp(tonumber(params.maxPreview) or 400, 40, 4000)
		local out = jsonArray({})

		local function preview(value)
			local text
			if typeof(value) == "function" then
				text = tostring(value)
			else
				local encoded = serialize(value, 0, {})
				text = jsonEncode(encoded == nil and jsonNull or encoded)
			end
			return #text > maxPreview and (text:sub(1, maxPreview) .. "...") or text
		end

		if type(filtergc) == "function" and type(params.filter) == "table" then
			local options = {}
			for key, value in pairs(params.filter) do
				options[key] = value
			end
			local okFilter, filtered = pcall(filtergc, objectType, options)
			if okFilter and type(filtered) == "table" then
				for index = 1, math.min(#filtered, limit) do
					table.insert(out, { index = index, type = typeof(filtered[index]), value = preview(filtered[index]) })
				end
				return {
					ok = true,
					source = "filtergc",
					objectType = objectType,
					total = #filtered,
					returned = #out,
					objects = out,
				}
			end
		end

		if type(getgc) ~= "function" then
			return { ok = false, error = "getgc is unavailable in this executor" }
		end
		local okGc, objects = pcall(getgc, params.includeTables == true)
		if not okGc or type(objects) ~= "table" then
			return { ok = false, error = "getgc failed" }
		end

		local total = 0
		for _, item in ipairs(objects) do
			if typeof(item) == objectType then
				total = total + 1
				if #out < limit then
					table.insert(out, { index = total, type = typeof(item), value = preview(item) })
				end
			end
		end

		return {
			ok = true,
			source = "getgc",
			objectType = objectType,
			total = total,
			returned = #out,
			objects = out,
		}
	end

	------------------------------------------------------------- file system

	handlers["fs"] = function(params)
		local action = params.action
		local path = params.path

		if action == "list" then
			if type(listfiles) ~= "function" then
				return { ok = false, error = "listfiles is unavailable in this executor" }
			end
			local okList, files = pcall(listfiles, path or "")
			if not okList or type(files) ~= "table" then
				return { ok = false, error = "could not list " .. tostring(path) }
			end
			local entries = jsonArray({})
			for _, entry in ipairs(files) do
				local isDir = type(isfolder) == "function" and select(2, pcall(isfolder, entry)) or false
				table.insert(entries, { name = entry, path = entry, isFolder = isDir == true })
			end
			return { ok = true, path = path or "", entries = entries, count = #entries }
		elseif action == "read" then
			if type(readfile) ~= "function" then
				return { ok = false, error = "readfile is unavailable in this executor" }
			end
			local okRead, content = pcall(readfile, path)
			if not okRead then
				return { ok = false, error = tostring(content) }
			end
			local maxBytes = math.clamp(tonumber(params.maxBytes) or 100000, 100, 2000000)
			return {
				ok = true,
				path = path,
				size = #content,
				content = content:sub(1, maxBytes),
				truncated = #content > maxBytes,
			}
		elseif action == "write" then
			if type(writefile) ~= "function" then
				return { ok = false, error = "writefile is unavailable in this executor" }
			end
			if type(params.content) ~= "string" then
				return { ok = false, error = "content must be a string" }
			end
			local okWrite, writeError = pcall(writefile, path, params.content)
			if not okWrite then
				return { ok = false, error = tostring(writeError) }
			end
			return { ok = true, path = path, bytesWritten = #params.content }
		elseif action == "mkdir" then
			if type(makefolder) ~= "function" then
				return { ok = false, error = "makefolder is unavailable in this executor" }
			end
			local okMake, makeError = pcall(makefolder, path)
			if not okMake then
				return { ok = false, error = tostring(makeError) }
			end
			return { ok = true, path = path }
		elseif action == "exists" then
			local isFile = type(isfile) == "function" and select(2, pcall(isfile, path)) == true
			local isDir = type(isfolder) == "function" and select(2, pcall(isfolder, path)) == true
			return { ok = true, path = path, exists = isFile or isDir, isFile = isFile, isFolder = isDir }
		elseif action == "delete" then
			local fn = (type(isfolder) == "function" and select(2, pcall(isfolder, path)) == true) and delfolder or delfile
			if type(fn) ~= "function" then
				return { ok = false, error = "delfile/delfolder are unavailable in this executor" }
			end
			local okDelete, deleteError = pcall(fn, path)
			if not okDelete then
				return { ok = false, error = tostring(deleteError) }
			end
			return { ok = true, path = path, deleted = true }
		end

		return { ok = false, error = 'action must be one of: list, read, write, mkdir, exists, delete' }
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
