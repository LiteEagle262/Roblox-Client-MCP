#!/usr/bin/env node
/**
 * Drives the Lua agent harness against a live relay to prove the executor side
 * really works: status, code execution, console capture, players, and shutdown.
 *
 *   node scripts/lua-agent-test.mjs
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const luaBin = process.env.LUA_BIN ?? "lua";

if (spawnSync(luaBin, ["-e", "print(1)"]).status !== 0) {
  console.log(`SKIP  no Lua interpreter found (set LUA_BIN to point at one, tried "${luaBin}")`);
  process.exit(0);
}
const serverDir = path.join(root, "server");
const port = 3997;
const base = `http://127.0.0.1:${port}`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rcm-lua-"));

let failures = 0;
function check(name, condition, extra = "") {
  if (!condition) failures += 1;
  console.log(`${condition ? "PASS" : "FAIL"}  ${name}${extra ? ` :: ${extra}` : ""}`);
}

function cleanup() {
  try {
    process.kill(server.pid, "SIGKILL");
  } catch {
    /* already gone */
  }
  fs.rmSync(tmp, { recursive: true, force: true });
}

// ---------------------------------------------------------------- boot server

const server = spawn(process.execPath, [path.join(serverDir, "dist", "index.js")], {
  cwd: serverDir,
  env: {
    ...process.env,
    PORT: String(port),
    PUBLIC_URL: base,
    DATABASE_PATH: path.join(tmp, "bridge.db"),
    LOG_LEVEL: "warn",
    ACCOUNT_CREATION_ENABLED: "true",
    // Short poll window keeps the harness responsive and exercises the knob.
    AGENT_POLL_TIMEOUT_MS: "2500",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
server.stdout.on("data", (chunk) => process.stderr.write(`[server] ${chunk}`));
server.stderr.on("data", (chunk) => process.stderr.write(`[server] ${chunk}`));

process.on("exit", cleanup);
process.on("SIGINT", () => {
  cleanup();
  process.exit(1);
});

async function waitForHealth(timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${base}/healthz`);
      if (res.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return false;
}

if (!(await waitForHealth())) {
  console.error("server never became healthy");
  cleanup();
  process.exit(1);
}

// -------------------------------------------------------------- create account

const created = await (
  await fetch(`${base}/api/accounts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  })
).json();
const connectKey = created.credentials.connectKey;
const mcpToken = created.credentials.mcpToken;

// ------------------------------------------------------------- fetch the agent

const loaderRes = await fetch(`${base}/api/loader/${connectKey}`);
const agentSource = await loaderRes.text();
const agentFile = path.join(tmp, "agent.lua");
fs.writeFileSync(agentFile, agentSource);

// ------------------------------------------------------------- start the agent

const harness = path.join(root, "scripts", "lua-harness.lua");
const agent = spawn(luaBin, [harness, base, connectKey, agentFile], { stdio: ["ignore", "pipe", "pipe"] });

let agentOutput = "";
agent.stdout.on("data", (chunk) => {
  agentOutput += chunk.toString();
});
agent.stderr.on("data", (chunk) => {
  agentOutput += chunk.toString();
});

const agentExited = new Promise((resolve) => agent.on("exit", resolve));

async function waitForOnline(timeoutMs = 15000) {
  // No session cookie handy here, so probe the relay through MCP.
  const deadline2 = Date.now() + timeoutMs;
  while (Date.now() < deadline2) {
    const res = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${mcpToken}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "roblox_status", arguments: {} },
      }),
    });
    const body = await res.json();
    const text = body.result?.content?.[0]?.text ?? "";
    if (text.includes('"connected": true')) return true;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return false;
}

check("lua agent came online", await waitForOnline(), agentOutput.split("\n").slice(-3).join(" / ").slice(0, 200));

let mcpId = 10;
async function callTool(name, args) {
  mcpId += 1;
  const res = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${mcpToken}`,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: mcpId,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
  const body = await res.json();
  const text = body.result?.content?.[0]?.text ?? JSON.stringify(body);
  return { isError: Boolean(body.result?.isError), text };
}

// -------------------------------------------------- exercise the real agent

const status = await callTool("roblox_status", {});
check(
  "roblox_status reports the harness executor",
  status.text.includes("Harness Executor") && status.text.includes("Harness Place"),
  status.text.replace(/\s+/g, " ").slice(0, 200),
);

const exec = await callTool("roblox_run_script", { code: "return 6 * 7" });
check("roblox_run_script returns 42 from the executor", exec.text.includes("42"), exec.text.replace(/\s+/g, " ").slice(0, 160));

const players = await callTool("roblox_list_players", {});
check(
  "roblox_list_players sees the local player",
  players.text.includes('"Tester"') && players.text.includes('"isLocalPlayer": true'),
  players.text.replace(/\s+/g, " ").slice(0, 200),
);

const gameInfo = await callTool("roblox_get_game_info", {});
check("roblox_get_game_info reads the place", gameInfo.text.includes('"placeId": 123456'), gameInfo.text.slice(0, 160));

const jsValues = await callTool("roblox_eval", { expression: "1 + 1" });
check("roblox_eval returns a value", jsValues.text.includes("2"), jsValues.text.replace(/\s+/g, " ").slice(0, 120));

// Console capture, including nasty characters.
const tricky = 'print("quote:\\" backslash:\\\\ slash:/ tab:\\t unicode:é emoji:🚀")';
await callTool("roblox_run_script", { code: tricky });
const consoleRes = await callTool("roblox_read_console", { limit: 200 });
const expected = 'quote:" backslash:\\ slash:/ tab:\t unicode:é emoji:🚀';
const consoleJson = JSON.parse(consoleRes.text);
const messages = consoleJson.entries.map((entry) => entry.message);
check(
  "console round-trips quotes, backslashes and unicode",
  messages.includes(expected),
  JSON.stringify(messages.at(-1)),
);
check(
  "console entries carry their log level",
  consoleJson.entries.every((entry) => ["print", "warn", "error", "info", "game"].includes(entry.level)),
  consoleJson.entries.map((entry) => entry.level).join(","),
);

const errScript = await callTool("roblox_run_script", { code: "error('boom from the harness')" });
check("script errors are reported, not swallowed", errScript.isError && errScript.text.includes("boom from the harness"), errScript.text.slice(0, 140));

// -------------------------------------------------------------- shut it down

await callTool("roblox_eval", { expression: '"__HARNESS_EXIT__"' });
const exitCode = await Promise.race([
  agentExited,
  new Promise((resolve) => setTimeout(() => resolve("timeout"), 25000)),
]);
check("agent exits cleanly when the relay revokes the session", exitCode === 0 || exitCode === null, String(exitCode));
check("agent logged the shutdown", agentOutput.includes("relay rejected this session"), agentOutput.split("\n").slice(-4).join(" / ").slice(0, 200));

cleanup();
console.log(`\n${failures === 0 ? "ALL LUA AGENT CHECKS PASSED" : `${failures} LUA AGENT CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
