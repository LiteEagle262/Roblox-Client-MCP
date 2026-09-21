# Roblox Client MCP

A hosted relay that lets an AI drive a live Roblox client.

You create an account, get a loadstring, paste it into an executor, and point your MCP
client at an endpoint. The AI can then read the console, walk the instance tree, list and
decompile scripts, watch remote traffic, and run Luau — in the game that is actually open.

```
   ┌───────────────┐                                  ┌────────────────────┐
   │   Your AI     │   MCP over HTTP (bearer token)   │                    │
   │  Claude /     │ ───────────────────────────────▶ │   This server      │
   │  Cursor /     │ ◀─────────────────────────────── │   relay + MCP      │
   │  any MCP host │            tool results          │   + SQLite         │
   └───────────────┘                                  │   + web dashboard  │
                                                      │                    │
   ┌───────────────┐   POST /api/agent/sync           │                    │
   │  Arceus X     │ ───────────────────────────────▶ │                    │
   │  (Lua agent)  │ ◀─────────────────────────────── │                    │
   └───────────────┘        queued commands           └────────────────────┘
```

Executors have no outbound WebSocket, so the Lua agent uses HTTP long-polling: it posts its
console output and command results, and the same response carries back whatever the AI asked
for. That works through NAT and on mobile networks.

---

## Quick start (Docker)

```bash
git clone https://github.com/LiteEagle262/Roblox-Client-MCP.git
cd Roblox-Client-MCP
cp .env.example .env
# edit .env and set PUBLIC_URL to the origin users will actually hit
docker compose up -d
```

Open the site, click **Get an account number**, and save the 16-digit number it shows you.
It is the only credential — there is no email and no password recovery.

### Deploying on Dokploy

1. Create an application, source = this Git repo, build type = **Dockerfile**.
2. Add a volume mounted at `/data`. That single path holds the SQLite database and the
   signing secret; without it you lose every account on redeploy.
3. Set the environment variables you care about, at minimum:

   | Variable | Value |
   | --- | --- |
   | `PUBLIC_URL` | `https://your-domain.example` (no trailing slash) |
   | `TRUST_PROXY` | `true` |
   | `DATABASE_PATH` | `/data/bridge.db` |

4. Add the domain in Dokploy and point it at container port `3000`. Traefik terminates TLS;
   the container itself speaks plain HTTP.
5. Deploy. The health check hits `/healthz`.

Notes that save time later:

- `PUBLIC_URL` is baked into every generated loadstring. Change it and every existing
  loadstring points at the old host. Set it once, correctly.
- There is no external service to configure: no Redis, no Postgres, no object storage.
- Start with `ACCOUNT_CREATION_ENABLED=true` and flip it to `false` if you want a private
  instance — existing accounts keep working.

---

## The dashboard

| Panel | What it does |
| --- | --- |
| **Overview** | Live executor status (game, player, uptime, queued commands), a stream of the commands your AI has sent, and both connection blocks |
| **Connect an executor** | The loadstring to paste, the connect key, and a rotate button |
| **Connect your AI** | The MCP endpoint, the bearer token, a ready-to-paste client config, and a `curl` you can run to prove it works |
| **Console** | Live console output with level filters, text search, pause and auto-scroll |
| **Tools** | Every tool the AI can call, grouped and searchable |
| **Settings** | Account label, recent activity, session reset, account deletion |

Status and console updates arrive over a WebSocket (`/ws/dashboard`), scoped to your session.

---

## Tools exposed over MCP

| Tool | Group | What it does |
| --- | --- | --- |
| `roblox_status` | Session | Is an executor attached, and what game is it in |
| `roblox_run_script` | Code | Run arbitrary Luau; returns values and console output |
| `roblox_eval` | Code | Evaluate one expression |
| `roblox_read_console` | Console | Read buffered prints, warnings and errors |
| `roblox_clear_console` | Console | Discard the console buffer |
| `roblox_get_game_info` | Game | Place name, place id, job id, creator, player counts |
| `roblox_list_players` | Game | Players with health and world position |
| `roblox_notify` | Game | Show a toast on the user's screen |
| `roblox_dump_workspace` | Explorer | Nested view of the instance tree |
| `roblox_get_instance` | Explorer | Class, children, attributes, properties |
| `roblox_find_instances` | Explorer | Scan for instances by name and/or class |
| `roblox_set_property` | Explorer | Write a property, with Roblox value coercion |
| `roblox_call_method` | Explorer | Invoke a method on an instance |
| `roblox_list_scripts` | Scripts | DataModel, loaded, running or module scripts |
| `roblox_decompile_script` | Scripts | Recover readable Luau from a script instance |
| `roblox_remote_spy` | Remotes | Hook namecall to log remote traffic |
| `roblox_fire_remote` | Remotes | Invoke a remote from the client |
| `roblox_inspect_signal` | Remotes | List connections on an event, with the owning script |
| `roblox_http_request` | Network | HTTP through the executor's HTTP layer |

Roblox value types are exchanged as tagged objects, so the AI can read and write them:

```json
{ "__type": "Vector3", "x": 0, "y": 50, "z": 0 }
{ "__type": "Color3", "r": 1, "g": 0.2, "b": 0.2 }
{ "__type": "CFrame", "position": { "x": 0, "y": 5, "z": 0 } }
{ "__type": "UDim2", "x": { "scale": 0, "offset": 100 }, "y": { "scale": 1, "offset": 0 } }
{ "__type": "EnumItem", "enum": "Enum.HumanoidStateType", "name": "Jumping" }
{ "__type": "Instance", "path": "game.Workspace.Baseplate" }
```

---

## Connecting an MCP client

Grab the endpoint and token from **Connect your AI**, then:

**Generic / Claude Desktop / Cursor**

```json
{
  "mcpServers": {
    "roblox": {
      "type": "http",
      "url": "https://your-domain.example/mcp",
      "headers": { "Authorization": "Bearer rcm_your_token_here" }
    }
  }
}
```

**Verify it by hand**

```bash
curl -s https://your-domain.example/mcp \
  -H "Authorization: Bearer rcm_your_token_here" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

The endpoint is stateless, so every request is independent and any replica can serve it.

---

## Executor requirements

The agent is written against the generic executor surface, and Arceus X / SPDM is the
tested target ([function reference](https://spdmteam.com/docs)).

| Required | Why |
| --- | --- |
| `loadstring` | Runs the code the AI asks for |
| `game:HttpGet` | Fetches the agent itself |
| `request` / `syn.request` / `http_request` | Talks to the relay |

Everything else is probed with `pcall` and degrades gracefully:

| Used when available | Enables |
| --- | --- |
| `decompile`, `getscriptbytecode` | `roblox_decompile_script` |
| `getscripts`, `getloadedmodules`, `getrunningscripts` | `roblox_list_scripts` |
| `getrawmetatable`, `newcclosure`, `checkcaller` | `roblox_remote_spy` |
| `getconnections`, `isconnectionenabled`, `getsignalarguments` | `roblox_inspect_signal` |
| `getscripthash`, `IdentifyExecutor` | Extra detail in results |

If a function is missing, the tool returns a clear error instead of failing the whole
session. The agent also stops cleanly when the server revokes its key, so a rotated key does
not leave a zombie poll loop running in the game.

---

## Configuration

Every variable has a working default except `PUBLIC_URL`.

| Variable | Default | Notes |
| --- | --- | --- |
| `PUBLIC_URL` | `http://localhost:3000` | Baked into loadstrings. Set this correctly. |
| `PORT` | `3000` | |
| `DATABASE_PATH` | `./data/bridge.db` | Put it on a volume. |
| `TRUST_PROXY` | `false` | Set `true` behind Traefik/Dokploy so rate limits see real client IPs. |
| `ACCOUNT_CREATION_ENABLED` | `true` | `false` makes the instance invite-only. |
| `MAX_ACCOUNTS` | `0` | Hard cap. `0` = unlimited. |
| `BOOTSTRAP_SECRET` | empty | If set, registration requires `?bootstrap=<value>`. |
| `SESSION_TTL_DAYS` | `30` | Dashboard session lifetime. |
| `RATE_LIMIT_ACCOUNT_PER_HOUR` | `3` | Per IP. |
| `RATE_LIMIT_ACCOUNT_PER_DAY` | `10` | Per IP. |
| `RATE_LIMIT_LOGIN_PER_15MIN` | `20` | Per IP. |
| `RATE_LIMIT_RELAY_PER_MIN` | `1200` | Per IP, on the agent sync endpoint. |
| `AGENT_POLL_TIMEOUT_MS` | `25000` | How long an idle poll parks. Lower = snappier shutdown, more requests. |
| `COMMAND_TIMEOUT_MS` | `45000` | How long the AI waits for the executor. |
| `CONSOLE_BUFFER_SIZE` | `1000` | Console lines kept per session. |
| `AGENT_STALE_SECONDS` | `45` | Silence before a session is marked offline. |
| `SESSION_SECRET` | auto | Generated beside the database on first boot. Set it to run multiple replicas. |
| `LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error`. |

---

## Local development

```bash
npm run install:all

# terminal 1 - API on :3000
npm run dev:server

# terminal 2 - dashboard on :5173, proxying /api, /mcp and /ws to :3000
npm run dev:web
```

Production-shaped build:

```bash
npm run build:local   # builds web, builds server, copies web/dist into server/public
npm start
```

### Tests

```bash
npm test
```

- `npm run test:smoke` boots a throwaway server on :3999 and exercises account creation,
  the loader, the agent sync loop, an MCP `tools/call` that round-trips through a simulated
  executor, console capture, rate limiting and key rotation. It also asserts that the
  dashboard's tool catalogue matches what the MCP server registers.
- `npm run test:lua` runs the **generated** agent under a stubbed Roblox environment in a real
  Lua interpreter, with a real HTTP loop against the relay, proving the agent itself works
  without an executor. It skips cleanly if no `lua` binary is present.

---

## Security

This is a tool for driving a game client you control. Read
[SECURITY.md](./SECURITY.md) before exposing an instance to the public internet. The short
version:

- The **account number** is a password. 16 digits is roughly 53 bits, and login is rate
  limited, but treat it like a secret.
- The **connect key** is in the loadstring URL. Anyone who sees the URL can attach a session
  to your account. Rotate it if it leaks.
- The **MCP token** grants full control of the attached client to whoever holds it. Do not
  put it in a public config.
- Anyone with a valid MCP token can run arbitrary Luau in the connected client. There is no
  tool-level permission system. Run a private instance if that matters to you.
- All three secrets are rotatable independently from the dashboard.

---

## Legal

Arceus X is a third-party Roblox executor. Using executors can violate Roblox's Terms of
Service and may get an account banned. This project is not affiliated with, endorsed by, or
supported by Roblox Corporation or SPDM Team. You are responsible for what you run.

## License

MIT — see [LICENSE](./LICENSE). Do whatever you want with it.
