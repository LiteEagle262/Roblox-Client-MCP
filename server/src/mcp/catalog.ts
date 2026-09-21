/**
 * UI-facing catalogue of the MCP tools. The long-form descriptions the model
 * sees live next to each registration in `server.ts`; these are the short
 * versions the dashboard renders.
 *
 * `scripts/smoke.mjs` asserts this list stays in sync with what the MCP server
 * actually registers, so drift fails the test suite rather than the docs.
 */
export interface ToolCatalogEntry {
  name: string;
  title: string;
  group: string;
  description: string;
}

export const TOOL_CATALOG: ToolCatalogEntry[] = [
  {
    name: "roblox_status",
    title: "Connection status",
    group: "Session",
    description: "Is an executor attached, and what game is it in. Call this first.",
  },
  {
    name: "roblox_run_script",
    title: "Run a Luau script",
    group: "Code",
    description: "Execute arbitrary Luau in the client and get its return values and console output.",
  },
  {
    name: "roblox_eval",
    title: "Evaluate an expression",
    group: "Code",
    description: "Evaluate a single Luau expression and get the value back.",
  },
  {
    name: "roblox_read_console",
    title: "Read the console",
    group: "Console",
    description: "Read buffered prints, warnings and errors from the game's console.",
  },
  {
    name: "roblox_clear_console",
    title: "Clear the console",
    group: "Console",
    description: "Discard everything currently buffered in the relay's console view.",
  },
  {
    name: "roblox_get_game_info",
    title: "Game information",
    group: "Game",
    description: "Place name, place id, job id, creator and player counts.",
  },
  {
    name: "roblox_list_players",
    title: "List players",
    group: "Game",
    description: "Every player in the server with health and world position.",
  },
  {
    name: "roblox_notify",
    title: "Show a notification",
    group: "Game",
    description: "Display a toast on the user's screen to report progress or findings.",
  },
  {
    name: "roblox_dump_workspace",
    title: "Dump the instance tree",
    group: "Explorer",
    description: "Nested view of the game hierarchy, for orienting before touching parts.",
  },
  {
    name: "roblox_get_instance",
    title: "Inspect an instance",
    group: "Explorer",
    description: "Read one instance's class, children, attributes and properties.",
  },
  {
    name: "roblox_find_instances",
    title: "Search instances",
    group: "Explorer",
    description: "Scan the DataModel for instances matching a name and/or class name.",
  },
  {
    name: "roblox_set_property",
    title: "Set a property",
    group: "Explorer",
    description: "Write a property on an instance, with coercion for Roblox value types.",
  },
  {
    name: "roblox_call_method",
    title: "Call a method",
    group: "Explorer",
    description: "Invoke a method on an instance, such as Destroy or TakeDamage.",
  },
  {
    name: "roblox_list_scripts",
    title: "List scripts",
    group: "Scripts",
    description: "Enumerate DataModel, loaded, running or module scripts.",
  },
  {
    name: "roblox_decompile_script",
    title: "Decompile a script",
    group: "Scripts",
    description: "Recover readable Luau source from a script instance.",
  },
  {
    name: "roblox_remote_spy",
    title: "Spy on remotes",
    group: "Remotes",
    description: "Hook namecall to log RemoteEvent and RemoteFunction traffic.",
  },
  {
    name: "roblox_fire_remote",
    title: "Fire a remote",
    group: "Remotes",
    description: "Invoke a remote from the client. Sends real traffic to the game server.",
  },
  {
    name: "roblox_inspect_signal",
    title: "Inspect signal connections",
    group: "Remotes",
    description: "List everything connected to an event, including the owning script.",
  },
  {
    name: "roblox_http_request",
    title: "HTTP from the client",
    group: "Network",
    description: "Send an HTTP request through the executor's HTTP layer.",
  },
  {
    name: "roblox_get_local_player",
    title: "Inspect the local player",
    group: "Player",
    description: "Position, health, walk speed, camera, team and leaderstats for the user's own character.",
  },
  {
    name: "roblox_get_player",
    title: "Inspect any player",
    group: "Player",
    description: "One player's character, health, position, team, leaderstats and tools.",
  },
  {
    name: "roblox_teleport_to",
    title: "Teleport the local character",
    group: "Player",
    description: "Move the user's character to a player, an instance, or coordinates.",
  },
  {
    name: "roblox_list_remotes",
    title: "List every remote",
    group: "Remotes",
    description: "Find all RemoteEvents, RemoteFunctions and Bindables with their paths.",
  },
  {
    name: "roblox_hook_remote",
    title: "Hook one remote",
    group: "Remotes",
    description: "Log or block traffic on a specific remote, and read back what it received.",
  },
  {
    name: "roblox_fire_signal",
    title: "Fire a signal",
    group: "Remotes",
    description: "Fire an event on an instance as if the game had.",
  },
  {
    name: "roblox_search_scripts",
    title: "Grep inside scripts",
    group: "Scripts",
    description: "Search decompiled sources for a string and get script, line and context. Finds where a remote is used.",
  },
  {
    name: "roblox_get_upvalues",
    title: "Read a script's upvalues",
    group: "Scripts",
    description: "Dump the captured variables of a script's closure, exposing its hidden state.",
  },
  {
    name: "roblox_get_gc_objects",
    title: "Search the garbage collector",
    group: "Scripts",
    description: "Find live tables or functions by name, hash or constant via filtergc.",
  },
  {
    name: "roblox_wait_for_instance",
    title: "Wait for something to exist",
    group: "Explorer",
    description: "Block until an instance path resolves, instead of guessing with sleeps.",
  },
  {
    name: "roblox_get_asset_info",
    title: "Look up an asset",
    group: "Game",
    description: "Marketplace name, creator and price for an asset id found in a script.",
  },
  {
    name: "roblox_file",
    title: "Executor file system",
    group: "Network",
    description: "Read, write, list or delete files in the executor's workspace.",
  },
];
