import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

function env(name: string, fallback: string): string {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const trimmed = raw.trim();
  return trimmed === "" && fallback !== "" ? fallback : trimmed;
}

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase());
}

function normalizeOrigin(value: string): string {
  return value.replace(/\/+$/, "");
}

const databasePath = env("DATABASE_PATH", "./data/bridge.db");
const databaseDir = path.dirname(path.resolve(databasePath));
try {
  fs.mkdirSync(databaseDir, { recursive: true });
} catch {
  // Read-only filesystems will fail later with a clearer error from SQLite.
}

export const config = {
  port: int("PORT", 3000),
  publicUrl: normalizeOrigin(env("PUBLIC_URL", `http://localhost:${int("PORT", 3000)}`)),
  databasePath,
  trustProxy: bool("TRUST_PROXY", false),

  accountCreationEnabled: bool("ACCOUNT_CREATION_ENABLED", true),
  maxAccounts: int("MAX_ACCOUNTS", 0),
  sessionTtlDays: int("SESSION_TTL_DAYS", 30),

  rateLimit: {
    accountPerHour: int("RATE_LIMIT_ACCOUNT_PER_HOUR", 3),
    accountPerDay: int("RATE_LIMIT_ACCOUNT_PER_DAY", 10),
    loginPer15Min: int("RATE_LIMIT_LOGIN_PER_15MIN", 20),
    relayPerMin: int("RATE_LIMIT_RELAY_PER_MIN", 1200),
  },

  agentPollTimeoutMs: int("AGENT_POLL_TIMEOUT_MS", 25_000),
  commandTimeoutMs: int("COMMAND_TIMEOUT_MS", 45_000),
  consoleBufferSize: int("CONSOLE_BUFFER_SIZE", 1000),
  agentStaleSeconds: int("AGENT_STALE_SECONDS", 45),

  bootstrapSecret: env("BOOTSTRAP_SECRET", ""),

  /** Static assets built from the web workspace. */
  webRoot: path.resolve(process.env.WEB_ROOT ?? path.join(process.cwd(), "public")),

  version: "1.0.0",
  serverName: "roblox-client-mcp",
} as const;

/**
 * A stable, opaque secret used for signing. Generated on first boot and stored
 * beside the database so sessions survive restarts without extra configuration.
 */
function loadOrCreateSecret(): string {
  const fromEnv = process.env.SESSION_SECRET;
  if (fromEnv && fromEnv.length >= 16) return fromEnv;

  const secretPath = path.join(databaseDir, ".session-secret");
  try {
    const existing = fs.readFileSync(secretPath, "utf8").trim();
    if (existing.length >= 16) return existing;
  } catch {
    // fall through and create one
  }

  const generated = crypto.randomBytes(32).toString("hex");
  try {
    fs.writeFileSync(secretPath, generated, { mode: 0o600 });
  } catch {
    // Non-fatal: secret is still stable for this process lifetime.
  }
  return generated;
}

export const sessionSecret = loadOrCreateSecret();
