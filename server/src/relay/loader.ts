import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";
import { formatAccountNumber } from "../store.js";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const AGENT_CANDIDATES = [
  path.join(moduleDir, "agent.lua"),
  path.join(moduleDir, "relay", "agent.lua"),
  path.join(process.cwd(), "src", "relay", "agent.lua"),
];

function readAgentSource(): string {
  for (const candidate of AGENT_CANDIDATES) {
    if (fs.existsSync(candidate)) return fs.readFileSync(candidate, "utf8");
  }
  throw new Error(
    `could not locate agent.lua. Looked in:\n  ${AGENT_CANDIDATES.join("\n  ")}\n` +
      `Run "npm run build" so the Lua asset is copied into dist/.`,
  );
}

const agentSource = readAgentSource();

/** JSON string syntax is a valid subset of Lua's for the values we emit. */
function luaString(value: string): string {
  return JSON.stringify(value);
}

export interface LuaConfig {
  connectKey: string;
  accountNumber?: string;
  executorName?: string;
}

function buildConfigTable(input: LuaConfig): string {
  const entries: string[] = [
    `  protocol = 1,`,
    `  baseUrl = ${luaString(config.publicUrl)},`,
    `  publicUrl = ${luaString(config.publicUrl)},`,
    `  connectKey = ${luaString(input.connectKey)},`,
    `  accountNumber = ${luaString(input.accountNumber ? formatAccountNumber(input.accountNumber) : "")},`,
    `  executorName = ${luaString(input.executorName ?? "SPDM / Arceus X")},`,
    `  serverName = ${luaString(config.serverName)},`,
    `  pollTimeout = ${config.agentPollTimeoutMs},`,
    `  commandTimeout = ${config.commandTimeoutMs},`,
  ];
  return `{\n${entries.join("\n")}\n}`;
}

/**
 * The Lua source served at /api/loader/:connectKey. It is the agent with a
 * per-account CONFIG table baked in, wrapped in a small boot prologue so the
 * user gets immediate feedback.
 */
export function buildLoader(input: LuaConfig): string {
  const banner = `
--[[ ==========================================================================
     Roblox Client MCP - generated ${new Date().toISOString()}
     Account: ${input.accountNumber ? formatAccountNumber(input.accountNumber) : "(unbound)"}
     Server:  ${config.publicUrl}
     Rotating your connect key invalidates this loadstring.
     ========================================================================== ]]
`;

  if (!agentSource.includes("__RCB_CONFIG__")) {
    throw new Error("agent.lua is missing the __RCB_CONFIG__ placeholder");
  }

  return banner + agentSource.replace("__RCB_CONFIG__", buildConfigTable(input));
}

export function loaderUrl(connectKey: string): string {
  return `${config.publicUrl}/api/loader/${connectKey}`;
}

/** Exactly what the dashboard shows the user, ready to paste into the executor. */
export function loadstring(connectKey: string): string {
  return `loadstring(game:HttpGet("${loaderUrl(connectKey)}"))()`;
}
