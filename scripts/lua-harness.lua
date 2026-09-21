--[[
    Roblox Client MCP :: Lua agent harness
    ---------------------------------------------------------------------------
    Runs the *generated* agent script with a hand-rolled Roblox environment so
    the agent can be tested without an executor. HTTP is performed with curl.

    usage: lua scripts/lua-harness.lua <baseUrl> <connectKey> <agentFile>
]]

local baseUrl = assert(arg[1], "base url required")
local connectKey = assert(arg[2], "connect key required")
local agentFile = assert(arg[3], "agent file required")

------------------------------------------------------------------- robox stubs

local connections = {}

local function makeSignal(name)
	local handlers = {}
	return {
		name = name,
		Connect = function(_self, fn)
			table.insert(handlers, fn)
			return { Disconnect = function() end }
		end,
		Fire = function(_self, ...)
			for _, fn in ipairs(handlers) do
				fn(...)
			end
		end,
	}
end

local InstanceMeta = {}
InstanceMeta.__index = function(self, key)
	local props = rawget(self, "__props")
	if props and props[key] ~= nil then
		return props[key]
	end
	local children = rawget(self, "__children")
	if children then
		for _, child in ipairs(children) do
			if child.Name == key then
				return child
			end
		end
	end
	local method = InstanceMeta[key]
	return method
end

local function makeInstance(className, name, props)
	local instance = setmetatable({
		__rbxtype = "Instance",
		__children = {},
		__props = props or {},
		__class = className,
	}, InstanceMeta)
	instance.__props.Name = name
	instance.__props.ClassName = className
	return instance
end

function InstanceMeta:GetChildren()
	return table.clone and table.clone(rawget(self, "__children")) or rawget(self, "__children")
end

function InstanceMeta:GetDescendants()
	local out = {}
	local function walk(node)
		for _, child in ipairs(rawget(node, "__children")) do
			table.insert(out, child)
			walk(child)
		end
	end
	walk(self)
	return out
end

function InstanceMeta:FindFirstChild(name)
	for _, child in ipairs(rawget(self, "__children")) do
		if child.Name == name then
			return child
		end
	end
	return nil
end

function InstanceMeta:FindFirstChildOfClass(className)
	for _, child in ipairs(rawget(self, "__children")) do
		if child.ClassName == className then
			return child
		end
	end
	return nil
end

function InstanceMeta:GetFullName()
	local parts = {}
	local current = self
	while current do
		table.insert(parts, 1, current.Name)
		current = current.Parent
	end
	return table.concat(parts, ".")
end

function InstanceMeta:GetAttributes()
	local out = {}
	for key, value in pairs(rawget(self, "__props").Attributes or {}) do
		out[key] = value
	end
	return out
end

local function addChild(parent, child)
	child.Parent = parent
	table.insert(rawget(parent, "__children"), child)
	return child
end

-------------------------------------------------------------------- game model

local game = makeInstance("DataModel", "Game", {})

local Workspace = addChild(game, makeInstance("Workspace", "Workspace", {}))
addChild(Workspace, makeInstance("Part", "Baseplate", {
	Position = { X = 0, Y = 0, Z = 0 },
	Anchored = true,
}))

local LocalPlayer = makeInstance("Player", "Tester", {
	DisplayName = "Tester",
	UserId = 99,
	AccountAge = 1234,
})

local Players = addChild(game, makeInstance("Players", "Players", {
	MaxPlayers = 12,
	LocalPlayer = LocalPlayer,
}))
addChild(Players, LocalPlayer)

local character = addChild(Workspace, makeInstance("Model", "Tester", {}))
addChild(character, makeInstance("Humanoid", "Humanoid", { Health = 100, MaxHealth = 100 }))
addChild(character, makeInstance("Part", "HumanoidRootPart", {
	Position = { X = 1, Y = 5, Z = 2 },
}))
LocalPlayer.Character = character

local LogService = addChild(game, makeInstance("LogService", "LogService", {}))
LogService.MessageOut = makeSignal("MessageOut")

local MarketplaceService = addChild(game, makeInstance("MarketplaceService", "MarketplaceService", {}))
MarketplaceService.GetProductInfo = function(_self, placeId)
	return { Name = "Harness Place (" .. tostring(placeId) .. ")" }
end

local StarterGui = addChild(game, makeInstance("StarterGui", "StarterGui", {}))
StarterGui.SetCore = function(_self, key, value)
	if key == "SendNotification" then
		print("[harness] notification: " .. tostring(value.Text))
	end
end

local RunService = addChild(game, makeInstance("RunService", "RunService", {}))
RunService.IsStudio = function()
	return false
end

local services = {
	Players = Players,
	Workspace = Workspace,
	LogService = LogService,
	MarketplaceService = MarketplaceService,
	StarterGui = StarterGui,
	RunService = RunService,
}

game.GetService = function(_self, name)
	local service = services[name]
	if not service then
		service = makeInstance("Instance", name, {})
		service.Parent = game
		services[name] = service
		table.insert(rawget(game, "__children"), service)
	end
	return service
end

game.PlaceId = 123456
game.GameId = 654321
game.JobId = "harness-job"
game.CreatorId = 1
game.CreatorType = { Name = "User" }

Players.GetPlayers = function()
	return { LocalPlayer }
end
Players.PlayerRemoving = makeSignal("PlayerRemoving")

----------------------------------------------------------------- lua globals

local register = {}

-- The sandbox the agent runs in. Globals written by the agent land here, and
-- anything we do not stub falls through to the real Lua globals.
local environment = setmetatable({}, {
	__index = function(_self, key)
		local value = register[key]
		if value ~= nil then
			return value
		end
		return _G[key]
	end,
	__newindex = function(_self, key, value)
		register[key] = value
	end,
})

register._G = environment
register.getgenv = function()
	return environment
end
register.unpack = table.unpack or unpack

register.game = game

register.typeof = function(value)
	local kind = type(value)
	if kind ~= "table" then
		return kind
	end
	local meta = getmetatable(value)
	if meta and meta.__index == InstanceMeta then
		return "Instance"
	end
	return kind
end

register.getrawmetatable = getmetatable
register.setreadonly = function() end
register.newcclosure = function(fn)
	return fn
end
register.checkcaller = function()
	return false
end
register.getnamecallmethod = function()
	return nil
end
register.isconnectionenabled = function()
	return true
end
register.getconnections = function()
	return {}
end
register.getsignalarguments = function()
	return {}
end
register.getscripthash = function()
	return "hash"
end
register.decompile = function()
	return "print('decompiled')"
end
register.getscriptbytecode = function()
	return "\0\1\2"
end
register.getrunningscripts = function()
	return {}
end
register.getloadedmodules = function()
	return {}
end
register.getmodules = function()
	return {}
end
register.getscripts = function()
	return {}
end
register.IdentifyExecutor = function()
	return "Harness Executor", "1.0-harness"
end

register.warn = function(...)
	local parts = {}
	for index = 1, select("#", ...) do
		parts[index] = tostring(select(index, ...))
	end
	io.stderr:write("[warn] " .. table.concat(parts, " ") .. "\n")
end

-- Route prints through LogService the way a real executor does.
local rawPrint = print
register.print = function(...)
	local parts = {}
	for index = 1, select("#", ...) do
		parts[index] = tostring(select(index, ...))
	end
	local message = table.concat(parts, "\t")
	rawPrint("[console] " .. message)
	LogService.MessageOut:Fire(message, register.Enum.MessageType.MessageOutput)
end

register.task = {
	wait = function(seconds)
		os.execute(string.format("sleep %.2f", math.min(tonumber(seconds) or 0, 0.5)))
	end,
	defer = function(fn)
		fn()
	end,
}

register.Enum = {
	MessageType = {
		MessageOutput = { Name = "MessageOutput", EnumType = { Name = "MessageType" } },
		MessageWarning = { Name = "MessageWarning", EnumType = { Name = "MessageType" } },
		MessageError = { Name = "MessageError", EnumType = { Name = "MessageType" } },
		MessageInfo = { Name = "MessageInfo", EnumType = { Name = "MessageType" } },
	},
}

-- Vector / color stubs. Only enough to prove serialization round-trips.
local function vector3(x, y, z)
	return setmetatable({ X = x, Y = y, Z = z, __rbxtype = "Vector3" }, { __index = {} })
end
register.Vector3 = { new = vector3 }
register.Vector2 = { new = function(x, y)
	return { X = x, Y = y, __rbxtype = "Vector2" }
end }
register.CFrame = { new = function(x, y, z)
	return { X = x, Y = y, Z = z, __rbxtype = "CFrame" }
end }
register.Color3 = { new = function(r, g, b)
	return { R = r, G = g, B = b, __rbxtype = "Color3" }
end }
register.BrickColor = { new = function(name)
	return { Name = tostring(name), Number = 1, __rbxtype = "BrickColor" }
end }
register.UDim2 = { new = function(xs, xo, ys, yo)
	return { X = { Scale = xs, Offset = xo }, Y = { Scale = ys, Offset = yo }, __rbxtype = "UDim2" }
end }
register.UDim = { new = function(scale, offset)
	return { Scale = scale, Offset = offset, __rbxtype = "UDim" }
end }

if not table.pack then
	table.pack = function(...)
		return { n = select("#", ...), ... }
	end
end
if not math.clamp then
	math.clamp = function(value, low, high)
		return math.max(low, math.min(high, value))
	end
end
if not table.clone then
	table.clone = function(source)
		local copy = {}
		for key, value in pairs(source) do
			copy[key] = value
		end
		return copy
	end
end

----------------------------------------------------------------- http via curl

local function curlPost(url, body)
	local bodyFile = os.tmpname()
	local outFile = os.tmpname()

	local handle = assert(io.open(bodyFile, "wb"))
	handle:write(body)
	handle:close()

	local command = string.format(
		"curl -s -o '%s' -w '%%{http_code}' -X POST -H Content-Type:application/json -H X-Connect-Key:%s --data-binary @'%s' '%s'",
		outFile,
		connectKey,
		bodyFile,
		url
	)

	local pipe = assert(io.popen(command, "r"))
	local status = pipe:read("*a")
	pipe:close()

	local responseHandle = io.open(outFile, "rb")
	local responseBody = responseHandle and responseHandle:read("*a") or ""
	if responseHandle then
		responseHandle:close()
	end

	os.remove(bodyFile)
	os.remove(outFile)

	return { StatusCode = tonumber(status) or 0, Body = responseBody }
end

local deliveredExit = false
register.request = function(options)
	local url = options.Url
	local body = options.Body or ""

	if deliveredExit then
		-- Told the agent the session is gone so it breaks its loop.
		return { StatusCode = 401, Body = "" }
	end
	if string.find(body, "__HARNESS_EXIT__", 1, true) then
		deliveredExit = true
	end

	return curlPost(url, body)
end

register.http_request = register.request

--------------------------------------------------------------- load the agent

if setfenv then
	register.loadstring = function(source, chunkname)
		local fn, err = loadstring(source, chunkname)
		if fn then
			setfenv(fn, environment)
		end
		return fn, err
	end
else
	register.loadstring = function(source, chunkname)
		return load(source, chunkname, "t", environment)
	end
end

local chunk
if setfenv then
	chunk = assert(loadfile(agentFile))
	setfenv(chunk, environment)
else
	chunk = assert(loadfile(agentFile, "t", environment))
end

print("[harness] starting agent against " .. baseUrl)
chunk()
print("[harness] agent finished")
