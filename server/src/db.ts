import Database from "better-sqlite3";
import { config } from "./config.js";
import { log } from "./logger.js";

export const db = new Database(config.databasePath);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 5000");

db.exec(`
  CREATE TABLE IF NOT EXISTS accounts (
    id             TEXT PRIMARY KEY,
    account_number TEXT NOT NULL UNIQUE,
    label          TEXT,
    created_at     INTEGER NOT NULL,
    last_login_at  INTEGER,
    disabled       INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS credentials (
    account_id  TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
    connect_key TEXT NOT NULL UNIQUE,
    mcp_token   TEXT NOT NULL UNIQUE,
    created_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id           TEXT PRIMARY KEY,
    account_id   TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    token_hash   TEXT NOT NULL UNIQUE,
    created_at   INTEGER NOT NULL,
    expires_at   INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    ip           TEXT,
    user_agent   TEXT
  );

  CREATE TABLE IF NOT EXISTS rate_limits (
    bucket   TEXT PRIMARY KEY,
    count    INTEGER NOT NULL,
    reset_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id TEXT,
    event      TEXT NOT NULL,
    detail     TEXT,
    ip         TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_account   ON sessions(account_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_expires   ON sessions(expires_at);
  CREATE INDEX IF NOT EXISTS idx_audit_account      ON audit_log(account_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_rate_limits_reset  ON rate_limits(reset_at);
`);

export function audit(event: string, opts: { accountId?: string | null; detail?: string; ip?: string } = {}): void {
  try {
    db.prepare(
      `INSERT INTO audit_log (account_id, event, detail, ip, created_at) VALUES (?, ?, ?, ?, ?)`,
    ).run(opts.accountId ?? null, event, opts.detail ?? null, opts.ip ?? null, Date.now());
  } catch (err) {
    log.warn("audit write failed", { event, error: (err as Error).message });
  }
}

/** Housekeeping so the tiny tables never grow unbounded. */
export function prune(): void {
  const now = Date.now();
  db.prepare(`DELETE FROM sessions WHERE expires_at < ?`).run(now);
  db.prepare(`DELETE FROM rate_limits WHERE reset_at < ?`).run(now - 60_000);
  db.prepare(`DELETE FROM audit_log WHERE created_at < ?`).run(now - 30 * 24 * 60 * 60 * 1000);
}

export function closeDb(): void {
  try {
    db.close();
  } catch {
    /* already closed */
  }
}
