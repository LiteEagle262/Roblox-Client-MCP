import cookieParser from "cookie-parser";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import fs from "node:fs";
import path from "node:path";
import helmet from "helmet";
import { config } from "../config.js";
import { audit, db } from "../db.js";
import { log } from "../logger.js";
import { handleMcpRequest } from "../mcp/transport.js";
import { TOOL_CATALOG } from "../mcp/catalog.js";
import { hub, type AgentInfo, type LogLevel, type ResultPayload } from "../relay/hub.js";
import { buildLoader, loadstring, loaderUrl } from "../relay/loader.js";
import {
  SESSION_COOKIE,
  attachSession,
  rateLimit,
  requestIp,
  requireSameOrigin,
  requireSession,
  sessionCookieOptions,
  userAgent,
} from "./middleware.js";
import {
  countAccounts,
  createAccount,
  createSession,
  deleteAccount,
  destroySession,
  formatAccountNumber,
  getAccountByConnectKey,
  getAccountByMcpToken,
  getAccountByNumber,
  getCredentials,
  normalizeAccountNumber,
  rotateConnectKey,
  rotateMcpToken,
  setAccountLabel,
  touchLogin,
} from "../store.js";

function asyncRoute(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<void>,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}

export function buildApp(): Express {
  const app = express();

  if (config.trustProxy) app.set("trust proxy", true);
  app.disable("x-powered-by");

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:"],
          fontSrc: ["'self'", "data:"],
          connectSrc: ["'self'", "ws:", "wss:"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'self'"],
        },
      },
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: "same-origin" },
    }),
  );
  app.use(express.json({ limit: "4mb" }));
  app.use(cookieParser());
  app.use(attachSession);

  /* ----------------------------------------------------------------- health */

  app.get("/healthz", (_req, res) => {
    res.json({ ok: true, version: config.version, onlineSessions: hub.onlineCount() });
  });

  /* ------------------------------------------------------------------- meta */

  app.get("/api/meta", (_req, res) => {
    res.json({
      version: config.version,
      publicUrl: config.publicUrl,
      accountCreationEnabled: config.accountCreationEnabled,
      requiresBootstrap: config.bootstrapSecret.length > 0,
      maxAccounts: config.maxAccounts,
      accountCount: countAccounts(),
      onlineSessions: hub.onlineCount(),
      rateLimits: {
        accountPerHour: config.rateLimit.accountPerHour,
        accountPerDay: config.rateLimit.accountPerDay,
      },
    });
  });

  /* --------------------------------------------------------------- accounts */

  app.get("/api/tools", (_req, res) => {
    res.json({ tools: TOOL_CATALOG });
  });

  app.post(
    "/api/accounts",
    requireSameOrigin,
    rateLimit({ bucket: "account:hour", limit: config.rateLimit.accountPerHour, windowMs: 60 * 60 * 1000 }),
    asyncRoute(async (req, res) => {
      if (!config.accountCreationEnabled) {
        res.status(403).json({
          error: "creation_disabled",
          message: "Account creation is disabled on this instance.",
        });
        return;
      }

      const ip = requestIp(req);
      let passedDailyLimit = false;
      rateLimit({
        bucket: "account:day",
        limit: config.rateLimit.accountPerDay,
        windowMs: 24 * 60 * 60 * 1000,
      })(req, res, () => {
        passedDailyLimit = true;
      });
      if (!passedDailyLimit) return;

      if (config.bootstrapSecret) {
        const supplied =
          String(req.query.bootstrap ?? "") || String(req.headers["x-bootstrap-secret"] ?? "");
        if (supplied !== config.bootstrapSecret) {
          res.status(403).json({
            error: "bootstrap_required",
            message: "This instance requires an invite code.",
          });
          return;
        }
      }

      if (config.maxAccounts > 0 && countAccounts() >= config.maxAccounts) {
        res.status(507).json({
          error: "account_limit_reached",
          message: "This instance has reached its account limit.",
        });
        return;
      }

      const { account, credentials } = createAccount();
      const issued = createSession(account.id, { ip, userAgent: userAgent(req) });
      audit("account.created", { accountId: account.id, ip, detail: "self-service registration" });
      touchLogin(account.id);

      log.info("account created", { accountId: account.id, ip });

      res.cookie(SESSION_COOKIE, issued.token, sessionCookieOptions());
      res.status(201).json({
        account: publicAccount(account),
        credentials: {
          connectKey: credentials.connect_key,
          mcpToken: credentials.mcp_token,
        },
        loader: {
          url: loaderUrl(credentials.connect_key),
          loadstring: loadstring(credentials.connect_key),
        },
      });
    }),
  );

  app.post(
    "/api/auth/login",
    requireSameOrigin,
    rateLimit({ bucket: "login", limit: config.rateLimit.loginPer15Min, windowMs: 15 * 60 * 1000 }),
    (req, res) => {
      const raw = String((req.body as { accountNumber?: unknown })?.accountNumber ?? "");
      const digits = normalizeAccountNumber(raw);

      if (digits.length !== 16) {
        res.status(400).json({
          error: "invalid_account_number",
          message: "An account number is 16 digits.",
        });
        return;
      }

      const account = getAccountByNumber(digits);
      if (!account || account.disabled) {
        audit("auth.failed", { detail: `ip=${requestIp(req)}`, ip: requestIp(req) });
        res.status(401).json({ error: "invalid_credentials", message: "No account with that number." });
        return;
      }

      const issued = createSession(account.id, { ip: requestIp(req), userAgent: userAgent(req) });
      touchLogin(account.id);
      audit("auth.login", { accountId: account.id, ip: requestIp(req) });

      res.cookie(SESSION_COOKIE, issued.token, sessionCookieOptions());
      res.json({ account: publicAccount(account) });
    },
  );

  app.post("/api/auth/logout", requireSameOrigin, (req, res) => {
    const token = (req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE];
    if (token) destroySession(token);
    res.clearCookie(SESSION_COOKIE, { path: "/" });
    res.json({ ok: true });
  });

  app.get("/api/auth/session", (req, res) => {
    if (!req.account) {
      res.json({ authenticated: false });
      return;
    }
    res.json({ authenticated: true, account: publicAccount(req.account) });
  });

  /* --------------------------------------------------------------------- me */

  app.get("/api/me", requireSession, (req, res) => {
    const account = req.account!;
    const credentials = getCredentials(account.id);
    if (!credentials) {
      res.status(500).json({ error: "missing_credentials", message: "Account has no credentials." });
      return;
    }
    res.json({
      account: publicAccount(account),
      credentials: {
        connectKey: credentials.connect_key,
        mcpToken: credentials.mcp_token,
      },
      loader: {
        url: loaderUrl(credentials.connect_key),
        loadstring: loadstring(credentials.connect_key),
      },
      mcp: {
        url: `${config.publicUrl}/mcp`,
        token: credentials.mcp_token,
      },
      status: hub.snapshot(account.id),
    });
  });

  app.patch("/api/me", requireSameOrigin, requireSession, (req, res) => {
    const account = req.account!;
    const rawLabel = (req.body as { label?: unknown })?.label;
    const label = rawLabel === null ? null : String(rawLabel ?? "").trim().slice(0, 60);
    setAccountLabel(account.id, label && label.length > 0 ? label : null);
    audit("account.updated", { accountId: account.id, ip: requestIp(req) });
    res.json({ ok: true, label });
  });

  app.post("/api/me/rotate/connect-key", requireSameOrigin, requireSession, (req, res) => {
    const account = req.account!;
    const connectKey = rotateConnectKey(account.id);
    hub.reset(account.id);
    audit("connect_key.rotated", { accountId: account.id, ip: requestIp(req) });
    res.json({
      connectKey,
      loader: { url: loaderUrl(connectKey), loadstring: loadstring(connectKey) },
    });
  });

  app.post("/api/me/rotate/mcp-token", requireSameOrigin, requireSession, (req, res) => {
    const account = req.account!;
    const mcpToken = rotateMcpToken(account.id);
    audit("mcp_token.rotated", { accountId: account.id, ip: requestIp(req) });
    res.json({ mcpToken, mcpUrl: `${config.publicUrl}/mcp` });
  });

  app.delete("/api/me", requireSameOrigin, requireSession, (req, res) => {
    const account = req.account!;
    const confirmation = normalizeAccountNumber(String((req.body as { confirm?: unknown })?.confirm ?? ""));
    if (confirmation !== account.account_number) {
      res.status(400).json({
        error: "confirmation_mismatch",
        message: "Type your full account number to delete it.",
      });
      return;
    }
    hub.reset(account.id);
    deleteAccount(account.id);
    audit("account.deleted", { ip: requestIp(req), detail: "self-service deletion" });
    res.clearCookie(SESSION_COOKIE, { path: "/" });
    res.json({ ok: true });
  });

  /* ---------------------------------------------------------------- session */

  app.get("/api/me/status", requireSession, (req, res) => {
    res.json(hub.snapshot(req.account!.id));
  });

  app.get("/api/me/console", requireSession, (req, res) => {
    const since = Number.parseInt(String(req.query.since ?? "0"), 10) || 0;
    const limit = Math.min(Math.max(Number.parseInt(String(req.query.limit ?? "200"), 10) || 200, 1), 1000);
    const entries = hub.consoleEntries(req.account!.id, { since, limit });
    res.json({
      entries,
      latestSeq: entries.at(-1)?.seq ?? since,
    });
  });

  app.delete("/api/me/console", requireSameOrigin, requireSession, (req, res) => {
    hub.clearConsole(req.account!.id);
    res.json({ ok: true });
  });

  app.post("/api/me/reset", requireSameOrigin, requireSession, (req, res) => {
    hub.reset(req.account!.id);
    audit("session.reset", { accountId: req.account!.id, ip: requestIp(req) });
    res.json({ ok: true });
  });

  app.get("/api/me/activity", requireSession, (req, res) => {
    const rows = db
      .prepare(
        `SELECT event, detail, ip, created_at FROM audit_log
         WHERE account_id = ? ORDER BY created_at DESC LIMIT 50`,
      )
      .all(req.account!.id) as Array<{ event: string; detail: string | null; ip: string | null; created_at: number }>;
    res.json({ events: rows });
  });

  /* ------------------------------------------------------------ lua agent API */

  app.get("/api/loader/:connectKey", (req, res) => {
    const account = getAccountByConnectKey(String(req.params.connectKey));
    if (!account || account.disabled) {
      res.status(404).type("text/plain").send("-- Roblox Client MCP: unknown or revoked connect key");
      return;
    }
    const source = buildLoader({
      connectKey: String(req.params.connectKey),
      accountNumber: account.account_number,
    });
    res.type("text/plain; charset=utf-8").setHeader("Cache-Control", "no-store").send(source);
  });

  app.post(
    "/api/agent/sync",
    rateLimit({ bucket: "agent:sync", limit: config.rateLimit.relayPerMin, windowMs: 60 * 1000 }),
    asyncRoute(async (req, res) => {
      const body = (req.body ?? {}) as {
        bootId?: unknown;
        info?: unknown;
        results?: unknown;
        console?: unknown;
      };
      const connectKey =
        String(req.headers["x-connect-key"] ?? "") ||
        String((req.query.key as string | undefined) ?? "") ||
        String((req.body as { key?: unknown })?.key ?? "");

      const account = getAccountByConnectKey(connectKey);
      if (!account || account.disabled) {
        res.status(401).json({ error: "invalid_connect_key" });
        return;
      }

      const response = await hub.sync(account.id, connectKey, {
        bootId: String(body.bootId ?? "unknown"),
        info: (body.info ?? undefined) as Partial<AgentInfo> | undefined,
        results: toArray<ResultPayload>(body.results),
        console: toArray<{ level?: LogLevel; message: string }>(body.console),
      });
      res.setHeader("Cache-Control", "no-store");
      res.json(response);
    }),
  );

  /* --------------------------------------------------------------------- mcp */

  const mcpAuth = (req: Request, res: Response, next: NextFunction): void => {
    const header = String(req.headers.authorization ?? "");
    const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
    if (!token) {
      res
        .status(401)
        .setHeader("WWW-Authenticate", 'Bearer realm="roblox-client-mcp"')
        .json({ error: "missing_token", message: "Send Authorization: Bearer <mcp token>." });
      return;
    }
    const account = getAccountByMcpToken(token);
    if (!account || account.disabled) {
      res.status(403).json({ error: "invalid_token", message: "Unknown MCP token." });
      return;
    }
    req.account = account;
    next();
  };

  app.post(
    "/mcp",
    mcpAuth,
    asyncRoute(async (req, res) => {
      await handleMcpRequest(req.account!, req, res);
    }),
  );

  app.get("/mcp", mcpAuth, (_req, res) => {
    res.status(405).json({
      error: "method_not_allowed",
      message: "This MCP endpoint is stateless. Use POST for JSON-RPC requests.",
    });
  });

  /* ------------------------------------------------------------------- web UI */

  const indexHtml = path.join(config.webRoot, "index.html");
  if (fs.existsSync(indexHtml)) {
    app.use(express.static(config.webRoot, { index: false, maxAge: "1h" }));
    app.get(/^\/(?!api\/|mcp$|healthz$|ws$).*/, (_req, res) => {
      res.sendFile(indexHtml);
    });
  } else {
    app.get("/", (_req, res) => {
      res
        .status(200)
        .type("text/plain")
        .send(
          "Roblox Client MCP API is running, but the web UI was not built.\n" +
            "Run `npm run build` in the web workspace, or use the Docker image.\n",
        );
    });
  }

  /* -------------------------------------------------------------------- errors */

  app.use((req, res) => {
    res.status(404).json({ error: "not_found", message: `No route for ${req.method} ${req.path}` });
  });

  app.use((error: Error, req: Request, res: Response, _next: NextFunction) => {
    log.error("unhandled request error", { path: req.path, error: error.message });
    if (res.headersSent) return;
    res.status(500).json({ error: "internal_error", message: "Something went wrong." });
  });

  return app;
}

function publicAccount(account: {
  account_number: string;
  label: string | null;
  created_at: number;
  last_login_at: number | null;
}): { accountNumber: string; label: string | null; createdAt: number; lastLoginAt: number | null } {
  return {
    accountNumber: formatAccountNumber(account.account_number),
    label: account.label,
    createdAt: account.created_at,
    lastLoginAt: account.last_login_at,
  };
}

/** Lua has no way to distinguish `{}` from `[]`, so tolerate both. */
function toArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, T>);
  }
  return [];
}
