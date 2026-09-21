import crypto from "node:crypto";
import { config, sessionSecret } from "./config.js";
import { db } from "./db.js";

export interface Account {
  id: string;
  account_number: string;
  label: string | null;
  created_at: number;
  last_login_at: number | null;
  disabled: number;
}

export interface Credentials {
  account_id: string;
  connect_key: string;
  mcp_token: string;
  created_at: number;
}

export interface Session {
  id: string;
  account_id: string;
  expires_at: number;
  created_at: number;
  last_seen_at: number;
}

function randomHex(bytes: number): string {
  return crypto.randomBytes(bytes).toString("hex");
}

/** UUID v4, used for the key baked into a loadstring. */
export function randomConnectKey(): string {
  return crypto.randomUUID();
}

/** A URL-safe, unguessable identifier. */
export function randomId(bytes = 16): string {
  return randomHex(bytes);
}

/**
 * Mullvad-style account number: 16 digits, displayed in groups of four.
 * Stored canonicalised (digits only) so formatting is purely cosmetic.
 */
function generateAccountNumber(): string {
  for (let attempt = 0; attempt < 25; attempt += 1) {
    let digits = "";
    for (let i = 0; i < 16; i += 1) {
      digits += crypto.randomInt(0, 10).toString();
    }
    const existing = db
      .prepare(`SELECT 1 FROM accounts WHERE account_number = ?`)
      .get(digits);
    if (!existing) return digits;
  }
  throw new Error("could not allocate a unique account number");
}

export function formatAccountNumber(raw: string): string {
  return raw.replace(/(\d{4})(?=\d)/g, "$1 ");
}

export function normalizeAccountNumber(input: string): string {
  return input.replace(/\D+/g, "");
}

export function countAccounts(): number {
  const row = db.prepare(`SELECT COUNT(*) AS n FROM accounts`).get() as { n: number };
  return row.n;
}

export interface CreatedAccount {
  account: Account;
  credentials: Credentials;
}

export function createAccount(): CreatedAccount {
  const now = Date.now();
  const id = randomId(16);
  const accountNumber = generateAccountNumber();
  const credentials: Credentials = {
    account_id: id,
    connect_key: randomConnectKey(),
    mcp_token: `rcm_${randomHex(24)}`,
    created_at: now,
  };

  const insert = db.transaction(() => {
    db.prepare(
      `INSERT INTO accounts (id, account_number, label, created_at) VALUES (?, ?, NULL, ?)`,
    ).run(id, accountNumber, now);
    db.prepare(
      `INSERT INTO credentials (account_id, connect_key, mcp_token, created_at) VALUES (?, ?, ?, ?)`,
    ).run(credentials.account_id, credentials.connect_key, credentials.mcp_token, now);
  });
  insert();

  const account = getAccountById(id);
  if (!account) throw new Error("account insert reported success but row is missing");
  return { account, credentials };
}

export function getAccountById(id: string): Account | undefined {
  return db.prepare(`SELECT * FROM accounts WHERE id = ?`).get(id) as Account | undefined;
}

export function getAccountByNumber(accountNumber: string): Account | undefined {
  return db
    .prepare(`SELECT * FROM accounts WHERE account_number = ?`)
    .get(normalizeAccountNumber(accountNumber)) as Account | undefined;
}

export function getCredentials(accountId: string): Credentials | undefined {
  return db
    .prepare(`SELECT * FROM credentials WHERE account_id = ?`)
    .get(accountId) as Credentials | undefined;
}

export function getAccountByConnectKey(connectKey: string): Account | undefined {
  return db
    .prepare(
      `SELECT a.* FROM accounts a
       JOIN credentials c ON c.account_id = a.id
       WHERE c.connect_key = ?`,
    )
    .get(connectKey) as Account | undefined;
}

export function getAccountByMcpToken(token: string): Account | undefined {
  return db
    .prepare(
      `SELECT a.* FROM accounts a
       JOIN credentials c ON c.account_id = a.id
       WHERE c.mcp_token = ?`,
    )
    .get(token) as Account | undefined;
}

export function rotateConnectKey(accountId: string): string {
  const key = randomConnectKey();
  db.prepare(`UPDATE credentials SET connect_key = ? WHERE account_id = ?`).run(key, accountId);
  return key;
}

export function rotateMcpToken(accountId: string): string {
  const token = `rcm_${randomHex(24)}`;
  db.prepare(`UPDATE credentials SET mcp_token = ? WHERE account_id = ?`).run(token, accountId);
  return token;
}

export function setAccountLabel(accountId: string, label: string | null): void {
  db.prepare(`UPDATE accounts SET label = ? WHERE id = ?`).run(label, accountId);
}

export function touchLogin(accountId: string): void {
  db.prepare(`UPDATE accounts SET last_login_at = ? WHERE id = ?`).run(Date.now(), accountId);
}

export function deleteAccount(accountId: string): void {
  db.prepare(`DELETE FROM accounts WHERE id = ?`).run(accountId);
}

/* -------------------------------------------------------------------------- */
/* Sessions                                                                    */
/* -------------------------------------------------------------------------- */

function hashToken(token: string): string {
  return crypto.createHmac("sha256", sessionSecret).update(token).digest("hex");
}

export interface IssuedSession {
  token: string;
  session: Session;
}

export function createSession(
  accountId: string,
  meta: { ip?: string; userAgent?: string } = {},
): IssuedSession {
  const now = Date.now();
  const token = randomId(32);
  const id = randomId(12);
  const expiresAt = now + config.sessionTtlDays * 24 * 60 * 60 * 1000;

  db.prepare(
    `INSERT INTO sessions (id, account_id, token_hash, created_at, expires_at, last_seen_at, ip, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, accountId, hashToken(token), now, expiresAt, now, meta.ip ?? null, meta.userAgent ?? null);

  return {
    token,
    session: { id, account_id: accountId, created_at: now, expires_at: expiresAt, last_seen_at: now },
  };
}

export function getSessionByToken(token: string): Session | undefined {
  if (!token) return undefined;
  const row = db
    .prepare(`SELECT * FROM sessions WHERE token_hash = ?`)
    .get(hashToken(token)) as Session | undefined;
  if (!row) return undefined;
  if (row.expires_at < Date.now()) {
    db.prepare(`DELETE FROM sessions WHERE id = ?`).run(row.id);
    return undefined;
  }
  return row;
}

export function touchSession(sessionId: string): void {
  db.prepare(`UPDATE sessions SET last_seen_at = ? WHERE id = ?`).run(Date.now(), sessionId);
}

export function destroySession(token: string): void {
  db.prepare(`DELETE FROM sessions WHERE token_hash = ?`).run(hashToken(token));
}

export function destroyAllSessions(accountId: string): void {
  db.prepare(`DELETE FROM sessions WHERE account_id = ?`).run(accountId);
}
