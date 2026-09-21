#!/usr/bin/env node
/**
 * End-to-end smoke test for the relay.
 *
 *   node scripts/smoke.mjs [baseUrl]
 *
 * Starts its own server on :3999 unless a base URL is given, then walks the
 * whole path: account creation -> loader fetch -> agent sync loop -> MCP tool
 * call -> console capture -> rate limiting -> key rotation.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const serverDir = path.join(root, "server");
const explicitBase = process.argv[2];
const port = 3999;
const base = explicitBase ?? `http://127.0.0.1:${port}`;

let failures = 0;
let server = null;
let tmpDir = null;

async function reachable() {
  try {
    const res = await fetch(`${base}/healthz`);
    return res.ok;
  } catch {
    return false;
  }
}

function shutdown() {
  try {
    server?.kill("SIGKILL");
  } catch {
    /* already gone */
  }
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
}

process.on("exit", shutdown);
function check(name, condition, extra = "") {
  const status = condition ? "PASS" : "FAIL";
  if (!condition) failures += 1;
  console.log(`${status}  ${name}${extra ? ` :: ${extra}` : ""}`);
}

async function json(path, init) {
  const res = await fetch(`${base}${path}`, init);
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body, headers: res.headers };
}

function mcpRequest(token, method, params, id) {
  return {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: id ?? 1, method, params }),
  };
}

if (!(await reachable())) {
  const entry = path.join(serverDir, "dist", "index.js");
  if (!fs.existsSync(entry)) {
    console.error("server is not built: run `npm --prefix server run build` first");
    process.exit(1);
  }
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rcm-smoke-"));
  server = spawn(process.execPath, [entry], {
    cwd: serverDir,
    env: {
      ...process.env,
      PORT: String(port),
      PUBLIC_URL: base,
      DATABASE_PATH: path.join(tmpDir, "bridge.db"),
      LOG_LEVEL: "warn",
      AGENT_POLL_TIMEOUT_MS: "2500",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", (chunk) => process.stderr.write(`[server] ${chunk}`));
  server.stderr.on("data", (chunk) => process.stderr.write(`[server] ${chunk}`));

  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline && !(await reachable())) {
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  if (!(await reachable())) {
    console.error("server never became healthy");
    process.exit(1);
  }
}

const meta = await json("/api/meta");
check("GET /api/meta", meta.status === 200 && meta.body.version, JSON.stringify(meta.body.publicUrl));

const created = await json("/api/accounts", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({}),
});
check("POST /api/accounts", created.status === 201, JSON.stringify(created.body).slice(0, 160));
const accountNumber = created.body.account?.accountNumber;
const connectKey = created.body.credentials?.connectKey;
const mcpToken = created.body.credentials?.mcpToken;
const cookie = (created.headers.get("set-cookie") ?? "").split(";")[0];
check("account number is 16 digits in groups", /^\d{4} \d{4} \d{4} \d{4}$/.test(accountNumber ?? ""), accountNumber);
check("connect key looks like a uuid", /^[0-9a-f-]{36}$/.test(connectKey ?? ""), connectKey);
check("mcp token is prefixed", (mcpToken ?? "").startsWith("rcm_"), mcpToken?.slice(0, 12));
check("session cookie issued", cookie.startsWith("rcm_session="), cookie.slice(0, 20));
check("loadstring returned", (created.body.loader?.loadstring ?? "").includes("/api/loader/"), created.body.loader?.loadstring);

const loader = await fetch(`${base}/api/loader/${connectKey}`);
const loaderSource = await loader.text();
check("GET /api/loader/:key", loader.status === 200 && loaderSource.includes("__RCB_CONFIG__") === false);
check("loader bakes the base url", loaderSource.includes(base), base);
check("loader bakes the connect key", loaderSource.includes(connectKey));
check("loader keeps the agent loop", loaderSource.includes("runLoop") || loaderSource.includes("while running do"));

const badLoader = await fetch(`${base}/api/loader/not-a-real-key`);
check("unknown connect key is rejected", badLoader.status === 404);

const me = await json("/api/me", { headers: { cookie } });
check("GET /api/me with cookie", me.status === 200 && me.body.account.accountNumber === accountNumber);
check("offline status reported", me.body.status?.online === false);

const offlineCall = await json("/mcp", mcpRequest(mcpToken, "tools/call", { name: "roblox_status", arguments: {} }));
check("MCP works with no executor connected", offlineCall.status === 200, JSON.stringify(offlineCall.body).slice(0, 200));

const badAuth = await json("/mcp", mcpRequest("rcm_wrong", "tools/list", {}));
check("MCP rejects a bad token", badAuth.status === 403, String(badAuth.status));

const list = await json("/mcp", mcpRequest(mcpToken, "tools/list", {}));
const tools = (list.body.result?.tools ?? []).map((tool) => tool.name);
check("MCP tools/list", list.status === 200 && tools.length >= 15, `${tools.length} tools`);
check("expected tools present", ["roblox_status", "roblox_run_script", "roblox_decompile_script", "roblox_read_console"].every((t) => tools.includes(t)));

// The dashboard renders a hand-written catalogue; keep it honest.
const catalog = await json("/api/tools");
const catalogNames = (catalog.body.tools ?? []).map((tool) => tool.name).sort();
const mcpNames = [...tools].sort();
check(
  "dashboard tool catalogue matches the MCP server",
  JSON.stringify(catalogNames) === JSON.stringify(mcpNames),
  `catalog=${catalogNames.length} mcp=${mcpNames.length}`,
);

// ---- simulate the Lua agent -------------------------------------------------

let syncCount = 0;
const seen = [];

async function agentSync(payload) {
  const res = await fetch(`${base}/api/agent/sync`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Connect-Key": connectKey },
    body: JSON.stringify(payload),
  });
  return { status: res.status, body: await res.json() };
}

// First sync: report our info and console output.
const first = await agentSync({
  bootId: "boot-1",
  info: {
    executor: "SPDM Arceus X",
    executorVersion: "5.0",
    gameName: "Smoke Test Place",
    placeId: 12345,
    jobId: "job-smoke",
    playerName: "Tester",
    playerUserId: 99,
  },
  results: [],
  console: [{ level: "print", message: "hello from the game" }],
});
check("agent sync accepted", first.status === 200 && first.body.ok === true);

const status = await json("/api/me/status", { headers: { cookie } });
check("session reports online", status.body.online === true, JSON.stringify(status.body.info?.executor));
check("agent info relayed", status.body.info?.gameName === "Smoke Test Place");

// Reject an unknown connect key on sync.
const unauthRes = await fetch(`${base}/api/agent/sync`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-Connect-Key": "nope" },
  body: JSON.stringify({ bootId: "x" }),
});
check("agent sync rejects a bad key", unauthRes.status === 401);

// Now call a tool through MCP and have the agent answer it.
const pending = json(
  "/mcp",
  mcpRequest(mcpToken, "tools/call", {
    name: "roblox_run_script",
    arguments: { code: "return 6 * 7" },
  }, 2),
);

// Poll like the agent would, and answer whatever shows up.
const deadline = Date.now() + 8000;
let answered = 0;
while (Date.now() < deadline && answered === 0) {
  const sync = await agentSync({ bootId: "boot-1", results: seen.splice(0), console: [] });
  syncCount += 1;
  for (const command of sync.body.commands ?? []) {
    if (command.method === "exec") {
      seen.push({ id: command.id, ok: true, result: { ok: true, values: [42], returned: 1 } });
      answered += 1;
    }
  }
}

// Deliver the result on the next loop, exactly like the real agent does.
if (seen.length > 0) {
  const flush = await agentSync({ bootId: "boot-1", results: seen.splice(0), console: [] });
  check("agent flush accepted", flush.status === 200);
}

const callResult = await pending;
const callText = callResult.body.result?.content?.[0]?.text ?? JSON.stringify(callResult.body);
check("MCP tool call round-tripped through the agent", callText.includes("42"), callText.slice(0, 160));
check("agent handled a command", answered === 1);

// Deliver a result so the console shows up.
await agentSync({ bootId: "boot-1", results: [], console: [{ level: "warn", message: "a game warning" }] });
const consoleRes = await json("/api/me/console", { headers: { cookie } });
const messages = (consoleRes.body.entries ?? []).map((entry) => entry.message);
check("console buffer captured prints", messages.includes("hello from the game"), messages.join(" | "));
check("console buffer captured warnings", messages.includes("a game warning"));

// Rate limiting on account creation.
const attempts = [];
for (let i = 0; i < 5; i += 1) {
  attempts.push((await json("/api/accounts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  })).status);
}
check("account creation is rate limited", attempts.includes(429), `statuses: ${attempts.join(",")}`);

// Login with the account number.
const login = await json("/api/auth/login", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ accountNumber }),
});
check("login with account number", login.status === 200, String(login.status));

const wrongLogin = await json("/api/auth/login", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ accountNumber: "0000 0000 0000 0000" }),
});
check("login rejects a bad account number", wrongLogin.status === 401);

const rotated = await json("/api/me/rotate/connect-key", { method: "POST", headers: { cookie } });
check("connect key rotates", rotated.status === 200 && rotated.body.connectKey !== connectKey);
const oldLoader = await fetch(`${base}/api/loader/${connectKey}`);
check("old connect key stops working", oldLoader.status === 404);

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`} (agent syncs: ${syncCount})`);
shutdown();
process.exit(failures === 0 ? 0 : 1);
