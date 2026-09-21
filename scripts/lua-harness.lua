--[[
    Roblox Client MCP :: Lua agent harness
    ---------------------------------------------------------------------------
    Runs the *generated* agent script against a hand-rolled Roblox environment so
    the agent can be exercised without an executor. HTTP is done with curl, so
    the agent talks to a real relay.

    usage: lua scripts/lua-harness.lua <baseUrl> <connectKey> <agentFile>
]]

local baseUrl = assert(arg[1], "base url required")
local connectKey = assert(arg[2], "connect key required")
local agentFile = assert(arg[3], "agent file required")

-------------------------------------------------------------------- primitives

local function makeSignal(name)
	local handlers = {}
	local signal = {
		name = name,
		Connect = function(_self, fn)
			table.insert(handlers, fn)
			return { Disconnect = function() end }
		end,
		Once = function(_self, fn)
			table.insert(handlers, fn)
		end,
		Fire = function(_self, ...)
			for _, fn in ipairs(handlers) do
				fn(...)
			end
		end,
		GetConnections = function()
			return #handlers
		end,
	}
	return signal
end

local Vector3Meta = {}
Vector3Meta.__index = Vector3Meta
Vector3Meta.__add = function(a, b)
	return setmetatable({ X = a.X + b.X, Y = a.Y + b.Y, Z = a.Z + b.Z, __rbxtype = "Vector3" }, Vector3Meta)
end
Vector3Meta.__sub = function(a, b)
	return setmetatable({ X = a.X - b.X, Y = a.Y - b.Y, Z = a.Z - b.Z, __rbxtype = "Vector3" }, Vector3Meta)
end
Vector3Meta.__tostring = function(v)
	return string.format("Vector3(%g, %g, %g)", v.X, v.Y, v.Z)
end

local function vector3(x, y, z)
	return setmetatable({ X = x or 0, Y = y or 0, Z = z or 0, __rbxtype = "Vector3" }, Vector3Meta)
end

local function makeCFrame(x, y, z)
	-- Accepts (x, y, z) or a single Vector3, the two shapes the agent uses.
	local px, py, pz = x, y, z
	if type(x) == "table" and x.X ~= nil then
		px, py, pz = x.X, x.Y, x.Z
	end
	px, py, pz = px or 0, py or 0, pz or 0
	return {
		X = px,
		Y = py,
		Z = pz,
		Position = vector3(px, py, pz),
		__rbxtype = "CFrame",
	}
end

local InstanceMeta = {}
InstanceMeta.__index = function(self, key)
	local props = rawget(self, "__props")
	local value = props and props[key]
	if value ~= nil then
		return value
	end
	local children = rawget(self, "__children")
	if children then
		for _, child in ipairs(children) do
			if child.Name == key then
				return child
			end
		end
	end
	return InstanceMeta[key]
end

local function makeInstance(className, name, props)
	local instance = setmetatable({
		__children = {},
		__props = props or {},
	}, InstanceMeta)
	instance.__props.Name = name
	instance.__props.ClassName = className
	return instance
end

function InstanceMeta:GetChildren()
	local out = {}
	for index, child in ipairs(rawget(self, "__children")) do
		out[index] = child
	end
	return out
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

function InstanceMeta:FindFirstChildWhichIsA(className)
	return self:FindFirstChildOfClass(className)
end

function InstanceMeta:IsA(className)
	return rawget(self, "__props").ClassName == className
end

function InstanceMeta:WaitForChild(name)
	return self:FindFirstChild(name)
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

function InstanceMeta:PivotTo(target)
	local root = rawget(self, "PrimaryPart")
	if not root then
		return
	end
	local rootProps = rawget(root, "__props")
	rootProps.CFrame = target
	rootProps.Position = target.Position or target
end

function InstanceMeta:Destroy()
	local parent = self.Parent
	if parent then
		local siblings = rawget(parent, "__children")
		for index, child in ipairs(siblings) do
			if child == self then
				table.remove(siblings, index)
				break
			end
		end
	end
end

local function addChild(parent, child)
	child.Parent = parent
	table.insert(rawget(parent, "__children"), child)
	return child
end

--------------------------------------------------------------------- game model

local game = makeInstance("DataModel", "Game", {})

local Workspace = addChild(game, makeInstance("Workspace", "Workspace", {}))
local baseplate = addChild(Workspace, makeInstance("Part", "Baseplate", {
	Position = vector3(0, 0, 0),
	CFrame = makeCFrame(0, 0, 0),
	Anchored = true,
	Size = vector3(512, 20, 512),
}))
baseplate.Touched = makeSignal("Touched")

local WorkspaceCamera = makeInstance("Camera", "Camera", { CFrame = makeCFrame(0, 10, 20) })
Workspace.CurrentCamera = WorkspaceCamera

local LocalPlayer = makeInstance("Player", "Tester", {
	DisplayName = "Tester",
	UserId = 99,
	AccountAge = 1234,
	Team = { Name = "Red" },
})

local Players = addChild(game, makeInstance("Players", "Players", { MaxPlayers = 12 }))
addChild(Players, LocalPlayer)
Players.LocalPlayer = LocalPlayer

local leaderstats = addChild(LocalPlayer, makeInstance("Folder", "leaderstats", {}))
addChild(leaderstats, makeInstance("IntValue", "Cash", { Value = 2500 }))
addChild(leaderstats, makeInstance("IntValue", "Level", { Value = 7 }))

local character = addChild(Workspace, makeInstance("Model", "Tester", {}))
local rootPart = addChild(character, makeInstance("Part", "HumanoidRootPart", {
	Position = vector3(1, 5, 2),
	CFrame = makeCFrame(1, 5, 2),
	AssemblyLinearVelocity = vector3(0, 0, 0),
}))
addChild(character, makeInstance("Humanoid", "Humanoid", {
	Health = 100,
	MaxHealth = 100,
	WalkSpeed = 16,
	JumpPower = 50,
	Sit = false,
	GetState = function()
		return { Name = "Running", __rbxtype = "EnumItem", EnumType = { Name = "HumanoidStateType" } }
	end,
}))
character.PrimaryPart = rootPart
LocalPlayer.Character = character

local backpack = addChild(LocalPlayer, makeInstance("Backpack", "Backpack", {}))
addChild(backpack, makeInstance("Tool", "Sword", {}))
addChild(character, makeInstance("Tool", "Shield", {}))

local ReplicatedStorage = addChild(game, makeInstance("ReplicatedStorage", "ReplicatedStorage", {}))
local buyRemote = addChild(ReplicatedStorage, makeInstance("RemoteEvent", "BuyItem", {}))
addChild(ReplicatedStorage, makeInstance("RemoteFunction", "GetData", {}))
addChild(ReplicatedStorage, makeInstance("BindableEvent", "LocalBus", {}))

local shopScript = addChild(ReplicatedStorage, makeInstance("LocalScript", "ShopHandler", {}))
addChild(ReplicatedStorage, makeInstance("ModuleScript", "Config", {}))

local LogService = addChild(game, makeInstance("LogService", "LogService", {}))
LogService.MessageOut = makeSignal("MessageOut")

local MarketplaceService = addChild(game, makeInstance("MarketplaceService", "MarketplaceService", {}))
MarketplaceService.GetProductInfo = function(_self, assetId)
	return {
		Name = "Harness Asset (" .. tostring(assetId) .. ")",
		Description = "a test asset",
		AssetTypeId = 9,
		Creator = { Name = "HarnessDev", CreatorTargetId = 42, CreatorType = { Name = "User" } },
		PriceInRobux = 100,
		IsForSale = true,
		IsLimited = false,
		Created = "2020-01-01",
		Updated = "2021-01-01",
	}
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
	ReplicatedStorage = ReplicatedStorage,
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

-- A closure with real upvalues, so scripts.upvalues has something to read.
local scriptClosure = (function()
	local config = { difficulty = "hard", reward = 500 }
	local callCount = 0
	return function()
		callCount = callCount + 1
		return config, callCount
	end
end)()

-- Executor file system, backed by a table.
local fakeFiles = { ["existing.txt"] = "hello from the executor file system" }

------------------------------------------------------------------ lua globals

local register = {}

-- Sandbox for the agent. Globals it writes land here; anything unstubbed falls
-- through to real Lua globals.
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
	if type(value) ~= "table" then
		return type(value)
	end
	-- Compare the metatable itself: InstanceMeta.__index is a function, so
	-- comparing that to the InstanceMeta table would never match.
	if getmetatable(value) == InstanceMeta then
		return "Instance"
	end
	local marker = rawget(value, "__rbxtype")
	if marker then
		return marker
	end
	return "table"
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
	return {
		{ enabled = true, Connection = "function: 0x1", Function = "function: 0x1", Script = shopScript },
	}
end
register.getsignalarguments = function()
	return { "hit" }
end
register.firesignal = function(signal, ...)
	if type(signal) == "table" and type(signal.Fire) == "function" then
		signal:Fire(...)
		return
	end
	error("not a signal")
end
register.getscripthash = function(script)
	return "hash-" .. tostring(script.Name)
end
register.decompile = function(script)
	local name = script and script.Name or "?"
	return table.concat({
		"-- decompiled " .. name,
		'local ReplicatedStorage = game:GetService("ReplicatedStorage")',
		'local BuyItem = ReplicatedStorage:WaitForChild("BuyItem")',
		'BuyItem:FireServer("sword", 100)',
		'print("MAGIC_SEARCH_TOKEN in ' .. name .. '")',
	}, "\n")
end
register.getscriptbytecode = function()
	return "\0\1\2\3"
end
register.getscriptclosure = function(script)
	if script == shopScript then
		return scriptClosure
	end
	return nil
end
register.getscripts = function()
	return { shopScript }
end
register.getmodules = function()
	return { ReplicatedStorage.Config }
end
register.getloadedmodules = function()
	return { shopScript }
end
register.getrunningscripts = function()
	return { shopScript }
end
register.IdentifyExecutor = function()
	return "Harness Executor", "1.0-harness"
end

-- GC objects for gc.objects
local gcTable = { marker = "gc-table-marker" }
local gcFunction = function() end
register.getgc = function()
	return { gcTable, gcFunction, shopScript }
end
register.filtergc = function(objectType, options)
	local out = {}
	for _, item in ipairs({ gcTable, gcFunction }) do
		if register.typeof(item) == objectType then
			table.insert(out, item)
		end
	end
	return out
end

-- File system
register.readfile = function(path)
	if fakeFiles[path] == nil then
		error("could not find file: " .. tostring(path))
	end
	return fakeFiles[path]
end
register.writefile = function(path, content)
	fakeFiles[path] = content
end
register.listfiles = function()
	local out = {}
	for path in pairs(fakeFiles) do
		table.insert(out, path)
	end
	table.sort(out)
	return out
end
register.isfile = function(path)
	return fakeFiles[path] ~= nil
end
register.isfolder = function()
	return false
end
register.makefolder = function() end
register.delfile = function(path)
	fakeFiles[path] = nil
end
register.delfolder = function() end

register.warn = function(...)
	local parts = {}
	for index = 1, select("#", ...) do
		parts[index] = tostring(select(index, ...))
	end
	io.stderr:write("[warn] " .. table.concat(parts, " ") .. "\n")
end

-- Prints go through LogService, the way a real executor surfaces them.
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

-- Roblox's os.clock() keeps advancing across a yield. Real Lua's measures CPU
-- time, which would freeze during a sleep-based task.wait and make any deadline
-- loop spin forever. A virtual clock keeps the harness faithful.
local clockBase = os.clock()
local virtualElapsed = 0

register.os = setmetatable({}, {
	__index = function(_self, key)
		if key == "clock" then
			return function()
				return clockBase + virtualElapsed
			end
		end
		return os[key]
	end,
})

register.task = {
	wait = function(seconds)
		local duration = math.min(tonumber(seconds) or 0, 0.5)
		virtualElapsed = virtualElapsed + duration
		os.execute(string.format("sleep %.2f", duration))
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

register.Vector3 = { new = vector3 }
register.Vector2 = {
	new = function(x, y)
		return { X = x, Y = y, __rbxtype = "Vector2" }
	end,
}
register.CFrame = { new = makeCFrame }
register.Color3 = {
	new = function(r, g, b)
		return { R = r, G = g, B = b, __rbxtype = "Color3" }
	end,
}
register.BrickColor = {
	new = function(name)
		return { Name = tostring(name), Number = 1, __rbxtype = "BrickColor" }
	end,
}
register.UDim2 = {
	new = function(xs, xo, ys, yo)
		return { X = { Scale = xs, Offset = xo }, Y = { Scale = ys, Offset = yo }, __rbxtype = "UDim2" }
	end,
}
register.UDim = {
	new = function(scale, offset)
		return { Scale = scale, Offset = offset, __rbxtype = "UDim" }
	end,
}

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
	local body = options.Body or ""

	if deliveredExit then
		-- Told the agent the session is gone so it breaks its loop.
		return { StatusCode = 401, Body = "" }
	end
	if string.find(body, "__HARNESS_EXIT__", 1, true) then
		deliveredExit = true
	end

	return curlPost(options.Url, body)
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
