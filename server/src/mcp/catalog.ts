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
];
