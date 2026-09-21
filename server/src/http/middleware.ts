import type { NextFunction, Request, Response } from "express";
import { config } from "../config.js";
import { consume, clientIp } from "../rateLimit.js";
import { getSessionByToken, getAccountById, touchSession, type Account } from "../store.js";

export const SESSION_COOKIE = "rcm_session";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      account?: Account;
      sessionId?: string;
    }
  }
}

function readCookie(req: Request, name: string): string | undefined {
  const cookies = (req as Request & { cookies?: Record<string, string> }).cookies;
  return cookies?.[name];
}

export function sessionCookieOptions(): {
  httpOnly: boolean;
  sameSite: "lax";
  secure: boolean;
  path: string;
  maxAge: number;
} {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: config.publicUrl.startsWith("https://"),
    path: "/",
    maxAge: config.sessionTtlDays * 24 * 60 * 60 * 1000,
  };
}

/** Attaches `req.account` when a valid session cookie is present. */
export function attachSession(req: Request, _res: Response, next: NextFunction): void {
  const token = readCookie(req, SESSION_COOKIE);
  if (token) {
    const session = getSessionByToken(token);
    if (session) {
      const account = getAccountById(session.account_id);
      if (account && !account.disabled) {
        req.account = account;
        req.sessionId = session.id;
        touchSession(session.id);
      }
    }
  }
  next();
}

export function requireSession(req: Request, res: Response, next: NextFunction): void {
  if (!req.account) {
    res.status(401).json({ error: "not_authenticated", message: "Sign in first." });
    return;
  }
  next();
}

/**
 * Rejects cross-origin state-changing requests. The dashboard is same-origin,
 * so anything else is either a mistake or an attack.
 */
export function requireSameOrigin(req: Request, res: Response, next: NextFunction): void {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
    next();
    return;
  }
  const origin = req.headers.origin;
  if (!origin) {
    next();
    return;
  }
  const host = req.headers.host;
  try {
    const originHost = new URL(origin).host;
    if (originHost === host) {
      next();
      return;
    }
  } catch {
    /* fall through to rejection */
  }
  res.status(403).json({ error: "bad_origin", message: "Cross-origin request rejected." });
}

export interface LimitSpec {
  bucket: string;
  limit: number;
  windowMs: number;
}

/** Returns middleware enforcing a fixed-window per-IP limit. */
export function rateLimit(spec: LimitSpec) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const ip = clientIp(req as unknown as { ip?: string; headers: Record<string, unknown> });
    const result = consume(`${spec.bucket}:${ip}`, spec.limit, spec.windowMs);
    res.setHeader("X-RateLimit-Limit", String(result.limit));
    res.setHeader("X-RateLimit-Remaining", String(result.remaining));
    if (!result.ok) {
      res.setHeader("Retry-After", String(result.retryAfterSeconds));
      res.status(429).json({
        error: "rate_limited",
        message: `Too many requests. Try again in ${result.retryAfterSeconds}s.`,
        retryAfterSeconds: result.retryAfterSeconds,
      });
      return;
    }
    next();
  };
}

export function requestIp(req: Request): string {
  return clientIp(req as unknown as { ip?: string; headers: Record<string, unknown> });
}

export function userAgent(req: Request): string {
  return String(req.headers["user-agent"] ?? "").slice(0, 400);
}
