import { db } from "./db.js";

export interface RateLimitResult {
  ok: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
}

const upsert = db.prepare(`
  INSERT INTO rate_limits (bucket, count, reset_at) VALUES (?, 1, ?)
  ON CONFLICT(bucket) DO UPDATE SET count = count + 1
`);

const read = db.prepare(`SELECT count, reset_at FROM rate_limits WHERE bucket = ?`);

const bump = db.transaction((key: string, resetAt: number) => {
  upsert.run(key, resetAt);
  return read.get(key) as { count: number; reset_at: number };
});

/**
 * Fixed-window per-IP limiter. Cheap, atomic, and good enough for abuse
 * control on a self-hosted relay.
 */
export function consume(bucket: string, limit: number, windowMs: number): RateLimitResult {
  if (limit <= 0) {
    return { ok: true, limit: 0, remaining: Number.MAX_SAFE_INTEGER, retryAfterSeconds: 0 };
  }

  const now = Date.now();
  const windowIndex = Math.floor(now / windowMs);
  const key = `${bucket}:${windowIndex}`;
  const resetAt = (windowIndex + 1) * windowMs;

  const { count } = bump(key, resetAt);
  const retryAfterSeconds = Math.max(1, Math.ceil((resetAt - now) / 1000));

  return {
    ok: count <= limit,
    limit,
    remaining: Math.max(0, limit - count),
    retryAfterSeconds,
  };
}

export function clientIp(req: { ip?: string; headers: Record<string, unknown> }): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    const first = forwarded.split(",")[0];
    if (first) return first.trim();
  }
  return req.ip ?? "unknown";
}
