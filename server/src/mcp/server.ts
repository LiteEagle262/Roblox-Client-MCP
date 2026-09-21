import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { config } from "../config.js";
import { log } from "../logger.js";
import { hub, RelayError } from "../relay/hub.js";
import type { Account } from "../store.js";

const MAX_TEXT = 60_000;

function text(value: string): { content: Array<{ type: "text"; text: string }> } {
  const safe = typeof value === "string" ? value : String(value);
  return { content: [{ type: "text", text: safe.slice(0, MAX_TEXT) }] };
}

function json(value: unknown): { content: Array<{ type: "text"; text: string }> } {
  const encoded = JSON.stringify(value, null, 2);
  return text(encoded === undefined ? "null" : encoded);
}

function failure(message: string): {
  content: Array<{ type: "text"; text: string }>;
  isError: true;
} {
  return { content: [{ type: "text", text: message }], isError: true };
}

const INSTANCE_PATH_DOC =
  "Instance path. Accepts `game.Workspace.Baseplate`, `game:GetService(\"Players\").LocalPlayer`, " +
  "or `game.Workspace.Model.Part`. Use `roblox_dump_workspace` or `roblox_find_instances` to discover paths.";

export function createMcpServer(account: Account): McpServer {
  const server = new McpServer(
    { name: config.serverName, version: config.version },
    {
      instructions: [
        "You are connected to a live Roblox client through the Roblox Client MCP relay.",
        "",
        "How this works: a Lua agent is running inside a Roblox executor on the user's machine.",
        "Your tool calls are relayed to it, executed in the game, and the results come back.",
        "",
        "Start every session with `roblox_status`. If it reports no executor, tell the user to run",
        "their loadstring in Arceus X.",
        "",
        "Practical notes:",
        "- `roblox_run_script` runs real Luau. Anything the executor supports works: `getgc`,",
        "  `getconnections`, `decompile`, `hookfunction`, `require`, and the whole game API.",
        "- Assign the values you care about to `return`, e.g. `return game.Players.LocalPlayer.Name`.",
        "- Console output is captured asynchronously; `roblox_read_console` gets anything you missed.",
        "- Paths are stable strings like `game.Workspace.Foo.Bar`. Prefer exploring first, then acting.",
        "- Destructive actions (kicking, firing remotes, setting properties) hit a real user's game.",
        "  Say what you are about to do before doing it.",
      ].join("\n"),
    },
  );

  async function call(
    method: string,
    params: unknown,
    opts: { timeoutMs?: number } = {},
  ): Promise<{ ok: true; value: unknown } | { ok: false; message: string }> {
    try {
      const value = await hub.call(account.id, method, params, opts);
      return { ok: true, value };
    } catch (error) {
      if (error instanceof RelayError) {
        const hint =
          error.code === "no_executor"
            ? " Ask the user to run their loadstring in the executor and try again."
            : error.code === "timeout"
              ? " The executor did not answer in time. It may be busy, frozen, or on a loading screen."
              : "";
        return { ok: false, message: `${error.message}${hint}` };
      }
      log.error("relay call failed", { method, error: (error as Error).message });
      return { ok: false, message: (error as Error).message };
    }
  }

  const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  /* ------------------------------------------------------------------ status */

  server.registerTool(
    "roblox_status",
    {
      title: "Roblox connection status",
      description:
        "Check whether a Roblox executor is connected for this account and get the executor name, " +
        "game, place id, and player. Call this first.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      const snapshot = hub.snapshot(account.id);
      if (!snapshot.online) {
        return json({
          connected: false,
          message:
            "No executor is connected. Ask the user to run the loadstring from their dashboard inside Arceus X.",
          lastSeenAt: snapshot.lastSeenAt,
        });
      }
      return json({
        connected: true,
        lastSeenAt: snapshot.lastSeenAt,
        connectedAt: snapshot.connectedAt,
        queuedCommands: snapshot.queued,
        commandsInFlight: snapshot.inflight,
        executions: snapshot.executions,
        failures: snapshot.errors,
        executor: snapshot.info,
      });
    },
  );

  /* ------------------------------------------------------------ code running */

  server.registerTool(
    "roblox_run_script",
    {
      title: "Run a Luau script in the game",
      description:
        "Execute arbitrary Luau in the connected Roblox client and get back its return values plus any " +
        "console output it produced. Use `return` to hand values back. This is the most powerful tool: " +
        "everything the executor exposes is available.",
      inputSchema: {
        code: z
          .string()
          .describe(
            "Luau source. Use `return <value>` to send data back, e.g. `return #game.Workspace:GetChildren()`.",
          ),
        timeout_ms: z
          .number()
          .int()
          .min(500)
          .max(120_000)
          .optional()
          .describe("How long to wait for the executor to finish. Defaults to the server setting."),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    async ({ code, timeout_ms }) => {
      const since = hub.consoleEntries(account.id).at(-1)?.seq ?? 0;
      const result = await call("exec", { code }, { timeoutMs: timeout_ms ?? undefined });
      if (!result.ok) return failure(result.message);

      await delay(500);
      const consoleOutput = hub
        .consoleEntries(account.id, { since, limit: 200 })
        .map((entry) => `[${entry.level}] ${entry.message}`);

      return json({ executorResult: result.value, console: consoleOutput });
    },
  );

  server.registerTool(
    "roblox_eval",
    {
      title: "Evaluate a Luau expression",
      description:
        "Evaluate a single Luau expression and get the value back. Shorthand for `roblox_run_script` with `return <expression>`.",
      inputSchema: {
        expression: z
          .string()
          .describe('A Luau expression, e.g. `game.Players.LocalPlayer.Character.Humanoid.Health`.'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ expression }) => {
      const result = await call("eval", { expression });
      if (!result.ok) return failure(result.message);
      return json(result.value);
    },
  );

  /* ---------------------------------------------------------------- console */

  server.registerTool(
    "roblox_read_console",
    {
      title: "Read console output",
      description:
        "Read buffered output from the game's console (prints, warnings, errors and LogService messages). " +
        "Useful for reading what a script printed, or watching for errors after an action.",
      inputSchema: {
        limit: z.number().int().min(1).max(1000).optional().describe("Max lines to return. Default 200."),
        since_seq: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("Only return entries after this sequence number, for incremental reads."),
        level: z
          .enum(["print", "warn", "error", "info", "game"])
          .optional()
          .describe("Only return entries at this level."),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ limit, since_seq, level }) => {
      let entries = hub.consoleEntries(account.id, { since: since_seq ?? 0, limit: limit ?? 200 });
      if (level) entries = entries.filter((entry) => entry.level === level);
      if (entries.length === 0) return text("(console is empty)");
      return json({
        latestSeq: entries.at(-1)?.seq ?? 0,
        entries: entries.map((entry) => ({
          seq: entry.seq,
          level: entry.level,
          message: entry.message,
        })),
      });
    },
  );

  server.registerTool(
    "roblox_clear_console",
    {
      title: "Clear the console buffer",
      description: "Discard everything currently buffered in the relay's console view.",
      inputSchema: {},
      annotations: { readOnlyHint: false, idempotentHint: true },
    },
    async () => {
      hub.clearConsole(account.id);
      return text("Console buffer cleared.");
    },
  );

  /* -------------------------------------------------------------------- game */

  server.registerTool(
    "roblox_get_game_info",
    {
      title: "Get game information",
      description: "Place name, place id, job id, creator, player counts and whether this is Studio.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      const result = await call("game.info", {});
      return result.ok ? json(result.value) : failure(result.message);
    },
  );

  server.registerTool(
    "roblox_list_players",
    {
      title: "List players",
      description: "Every player in the server with name, user id, health and world position.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      const result = await call("players.list", {});
      return result.ok ? json(result.value) : failure(result.message);
    },
  );

  server.registerTool(
    "roblox_notify",
    {
      title: "Show a notification in-game",
      description:
        "Display a toast notification on the user's screen. Handy for confirming an action or flagging something you found.",
      inputSchema: {
        text: z.string().describe("Body text of the notification."),
        title: z.string().optional().describe("Title. Defaults to the relay name."),
        duration: z.number().min(1).max(30).optional().describe("Seconds on screen. Default 5."),
      },
      annotations: { readOnlyHint: false },
    },
    async ({ text: body, title, duration }) => {
      const result = await call("gui.hint", { text: body, title, duration });
      return result.ok ? text("Notification shown.") : failure(result.message);
    },
  );

  /* --------------------------------------------------------------- explorer */

  server.registerTool(
    "roblox_dump_workspace",
    {
      title: "Dump the instance tree",
      description:
        "Get a nested view of the game hierarchy. Use it to orient yourself before touching specific parts.",
      inputSchema: {
        path: z.string().optional().describe(`Root to start from. Defaults to \`game.Workspace\`. ${INSTANCE_PATH_DOC}`),
        depth: z.number().int().min(0).max(6).optional().describe("Levels to descend. Default 2."),
        max_children: z
          .number()
          .int()
          .min(1)
          .max(500)
          .optional()
          .describe("Cap children per node. Default 40."),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ path, depth, max_children }) => {
      const result = await call("workspace.tree", {
        path,
        depth,
        maxChildren: max_children,
      });
      if (!result.ok) return failure(result.message);
      return json(result.value);
    },
  );

  server.registerTool(
    "roblox_get_instance",
    {
      title: "Inspect an instance",
      description:
        "Read one instance's class, children, attributes and (optionally) specific properties.",
      inputSchema: {
        path: z.string().describe(INSTANCE_PATH_DOC),
        properties: z
          .array(z.string())
          .optional()
          .describe(
            "Specific property names to read. Omit for a sane default set, or pass [] for none.",
          ),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ path, properties }) => {
      const result = await call("instance.get", {
        path,
        properties: properties && properties.length > 0 ? properties : undefined,
      });
      if (!result.ok) return failure(result.message);
      return json(result.value);
    },
  );

  server.registerTool(
    "roblox_find_instances",
    {
      title: "Search for instances",
      description:
        "Scan the whole DataModel for instances matching a name and/or class. Case-insensitive substring match.",
      inputSchema: {
        name: z.string().optional().describe("Substring to match against instance names."),
        class_name: z
          .string()
          .optional()
          .describe("Substring to match against ClassName, e.g. `RemoteEvent` or `Part`."),
        limit: z.number().int().min(1).max(2000).optional().describe("Max results. Default 100."),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ name, class_name, limit }) => {
      const result = await call("instance.find", {
        name,
        className: class_name,
        limit,
      });
      if (!result.ok) return failure(result.message);
      return json(result.value);
    },
  );

  server.registerTool(
    "roblox_set_property",
    {
      title: "Set an instance property",
      description:
        "Write a property on an instance. Values are coerced for Roblox types: use " +
        '`{"__type":"Vector3","x":0,"y":10,"z":0}`, `{"__type":"Color3","r":1,"g":0,"b":0}`, ' +
        '`{"__type":"CFrame","position":{"x":0,"y":0,"z":0}}`, `{"__type":"UDim2",...}`, or ' +
        '`{"__type":"EnumItem","enum":"Enum.HumanoidStateType","name":"Jumping"}`.',
      inputSchema: {
        path: z.string().describe(INSTANCE_PATH_DOC),
        property: z.string().describe("Property name, e.g. `WalkSpeed` or `Text`."),
        value: z.unknown().describe("New value. Primitives pass through; Roblox types use the tagged form."),
      },
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async ({ path, property, value }) => {
      const result = await call("instance.set", { path, property, value });
      return result.ok ? json(result.value) : failure(result.message);
    },
  );

  server.registerTool(
    "roblox_call_method",
    {
      title: "Call a method on an instance",
      description:
        "Invoke a method with arguments, e.g. `{path: 'game.Workspace.Part', method: 'Destroy'}` or " +
        "`Humanoid:TakeDamage(50)`.",
      inputSchema: {
        path: z.string().describe(INSTANCE_PATH_DOC),
        method: z.string().describe("Method name, e.g. `Destroy`, `TakeDamage`, `Clone`."),
        args: z.array(z.unknown()).optional().describe("Positional arguments, in tagged form for Roblox types."),
      },
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async ({ path, method, args }) => {
      const result = await call("instance.call", { path, method, args: args ?? [] });
      return result.ok ? json(result.value) : failure(result.message);
    },
  );

  /* ------------------------------------------------------------------ scripts */

  server.registerTool(
    "roblox_list_scripts",
    {
      title: "List scripts in the game",
      description:
        "Enumerate scripts known to the client. `scripts` is everything in the DataModel, `loaded` is " +
        "what the client actually loaded (best for reverse engineering), `running` is currently executing, " +
        "`modules` is ModuleScripts.",
      inputSchema: {
        kind: z
          .enum(["scripts", "loaded", "running", "modules"])
          .optional()
          .describe("Which set to list. Default `scripts`."),
        filter: z.string().optional().describe("Case-insensitive substring match on script name."),
        limit: z.number().int().min(1).max(2000).optional().describe("Max results. Default 200."),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ kind, filter, limit }) => {
      const result = await call("scripts.list", { kind, filter, limit });
      return result.ok ? json(result.value) : failure(result.message);
    },
  );

  server.registerTool(
    "roblox_decompile_script",
    {
      title: "Decompile a script",
      description:
        "Recover readable Luau source from a script instance. Use `roblox_list_scripts` first to find the path. " +
        "This is how you learn what a game's client code actually does.",
      inputSchema: {
        path: z.string().describe('Path from `roblox_list_scripts`, e.g. `game.Players.LocalPlayer.PlayerScripts.SomeScript`.'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ path }) => {
      const result = await call("scripts.decompile", { path });
      return result.ok ? json(result.value) : failure(result.message);
    },
  );

  /* ------------------------------------------------------------------ remotes */

  server.registerTool(
    "roblox_remote_spy",
    {
      title: "Spy on remote traffic",
      description:
        "Hook the client's namecall metamethod to log RemoteEvent/RemoteFunction traffic. Start it, let the " +
        "game run, then dump. This reveals exactly which remotes the game uses and what arguments it sends.",
      inputSchema: {
        action: z
          .enum(["start", "stop", "dump", "clear"])
          .optional()
          .describe("`start` begins capturing, `dump` returns what was captured, `stop` disables, `clear` empties. Default `dump`."),
      },
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async ({ action }) => {
      const result = await call("remotes.spy", { action: action ?? "dump" });
      return result.ok ? json(result.value) : failure(result.message);
    },
  );

  server.registerTool(
    "roblox_fire_remote",
    {
      title: "Fire a remote",
      description:
        "Invoke a RemoteEvent/RemoteFunction from the client. Destructive: this sends real traffic to the game " +
        "server. Confirm with the user before using it.",
      inputSchema: {
        path: z.string().describe("Path to the remote instance."),
        method: z
          .enum(["FireServer", "InvokeServer"])
          .optional()
          .describe("Which side to call. Default `FireServer`."),
        args: z.array(z.unknown()).optional().describe("Arguments, tagged form for Roblox types."),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    async ({ path, method, args }) => {
      const result = await call("remotes.fire", { path, method, args: args ?? [] });
      return result.ok ? json(result.value) : failure(result.message);
    },
  );

  server.registerTool(
    "roblox_inspect_signal",
    {
      title: "Inspect signal connections",
      description:
        "List everything connected to an event on an instance, including the owning script. Useful for finding " +
        "where behaviour is wired up, e.g. `{path: 'game.Workspace.TouchPart', signal: 'Touched'}`.",
      inputSchema: {
        path: z.string().describe(INSTANCE_PATH_DOC),
        signal: z.string().describe("Event name, e.g. `Touched`, `OnServerEvent`, `Changed`, `PlayerAdded`."),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ path, signal }) => {
      const result = await call("signal.connections", { path, signal });
      return result.ok ? json(result.value) : failure(result.message);
    },
  );

  /* -------------------------------------------------------------------- misc */

  server.registerTool(
    "roblox_http_request",
    {
      title: "Make an HTTP request from the client",
      description:
        "Send an HTTP request through the executor's HTTP layer. Use it to pull external data into the game " +
        "(webhooks, APIs, a script you want to load) without the game's own restrictions.",
      inputSchema: {
        url: z.string().describe("Absolute URL."),
        method: z.string().optional().describe("HTTP method. Default GET."),
        body: z.string().optional().describe("Request body."),
        headers: z.record(z.string()).optional().describe("Request headers."),
      },
      annotations: { readOnlyHint: false, openWorldHint: true },
    },
    async ({ url, method, body, headers }) => {
      const result = await call("http.request", { url, method, body, headers });
      return result.ok ? json(result.value) : failure(result.message);
    },
  );

  return server;
}
