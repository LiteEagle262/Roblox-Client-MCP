import type { IncomingMessage, Server } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import { log } from "../logger.js";
import { hub } from "../relay/hub.js";
import { getAccountById, getSessionByToken } from "../store.js";
import { SESSION_COOKIE } from "./middleware.js";

function parseCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) {
      return decodeURIComponent(part.slice(index + 1).trim());
    }
  }
  return undefined;
}

/**
 * Live feed for the dashboard: session state, console lines and command
 * activity, scoped to the authenticated account.
 */
export function attachDashboardSocket(server: Server): void {
  const wss = new WebSocketServer({ noServer: true });
  const clients = new Map<string, Set<WebSocket>>();

  server.on("upgrade", (req: IncomingMessage, socket, head) => {
    const url = new URL(req.url ?? "/", "http://placeholder");
    if (url.pathname !== "/ws/dashboard") {
      socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }

    const token = parseCookie(req.headers.cookie, SESSION_COOKIE);
    const session = token ? getSessionByToken(token) : undefined;
    const account = session ? getAccountById(session.account_id) : undefined;
    if (!account || account.disabled) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      const accountId = account.id;
      let bucket = clients.get(accountId);
      if (!bucket) {
        bucket = new Set();
        clients.set(accountId, bucket);
      }
      bucket.add(ws);

      ws.send(
        JSON.stringify({
          type: "hello",
          status: hub.snapshot(accountId),
          console: hub.consoleEntries(accountId, { limit: 200 }),
        }),
      );

      ws.on("close", () => {
        bucket?.delete(ws);
        if (bucket && bucket.size === 0) clients.delete(accountId);
      });
      ws.on("error", () => {
        bucket?.delete(ws);
      });
      ws.on("message", (raw) => {
        if (raw.toString() === "ping") ws.send("pong");
      });
    });
  });

  const unsubscribe = hub.subscribe((event) => {
    const bucket = clients.get(event.accountId);
    if (!bucket || bucket.size === 0) return;
    const payload = JSON.stringify(event);
    for (const ws of bucket) {
      if (ws.readyState === WebSocket.OPEN) ws.send(payload);
    }
  });

  wss.on("close", () => unsubscribe());

  const heartbeat = setInterval(() => {
    for (const bucket of clients.values()) {
      for (const ws of bucket) {
        if (ws.readyState === WebSocket.OPEN) ws.ping();
      }
    }
  }, 30_000);
  heartbeat.unref();

  server.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
    wss.close();
  });

  log.debug("dashboard websocket attached");
}
