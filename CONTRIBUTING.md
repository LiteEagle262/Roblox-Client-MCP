# Contributing

Useful contributions, in rough order of value:

1. **Executor compatibility.** The agent probes for functions with `pcall` and degrades
   gracefully, but it has only been exercised against Arceus X / SPDM plus a stubbed harness.
   Reports from other executors — with the error text and which tool failed — are genuinely
   useful.
2. **New MCP tools.** Keep them narrow. One tool, one job, a description that tells the model
   when to use it.
3. **Bug fixes** with a failing test that would have caught the bug.

## Ground rules

- No new runtime dependencies in `server/` unless there is a good reason. The whole thing is
  meant to be one container and one SQLite file.
- Do not add anything that phones home. This is self-hosted software.
- The Lua agent must stay dependency-free: one file, no `require`, no bundled modules.
- Keep the tool catalogue in `server/src/mcp/catalog.ts` in sync with `server/src/mcp/server.ts`.
  `npm run test:smoke` fails if they drift.

## Layout

```
server/src/
  config.ts          env parsing and defaults
  db.ts              schema, migrations, audit log
  store.ts           accounts, credentials, sessions
  rateLimit.ts       fixed-window per-IP limiter
  relay/hub.ts       the broker: command queue, console buffer, session state
  relay/agent.lua    the executor agent (one file, served verbatim)
  relay/loader.ts    injects per-account config into agent.lua
  mcp/server.ts      tool definitions and handlers
  mcp/transport.ts   stateless Streamable HTTP
  http/              express routes, middleware, dashboard websocket
web/src/
  pages/             Landing, Login, Dashboard
  components/ui/     shadcn primitives
  components/dashboard/
  lib/               api client, socket hook, router
scripts/
  smoke.mjs          end-to-end server test
  lua-agent-test.mjs runs the generated agent against a live relay
  lua-harness.lua    stubbed Roblox environment for the above
```

## Before opening a PR

```bash
npm run typecheck
npm run build
npm test
```

All three must pass. If `npm run test:lua` reports `SKIP`, install a Lua interpreter
(`brew install lua`, `apt install lua5.4`) so you are actually testing the agent.

## Style

- Match the surrounding code. No comments that restate the code; comments explain *why*.
- Prefer explicit over clever in `agent.lua`. It runs in environments you cannot debug.
- Anything user-visible should say what went wrong and what to do next.

## Commit messages

Short imperative subject, then a body only if the change is not obvious. `fix: agent stops
polling when the relay returns 401` beats `fixed bug`.

## License

By contributing you agree your work is licensed under the MIT License.
