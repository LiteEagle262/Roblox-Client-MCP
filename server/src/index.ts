import http from "node:http";
import { config } from "./config.js";
import { closeDb, prune } from "./db.js";
import { buildApp } from "./http/app.js";
import { attachDashboardSocket } from "./http/ws.js";
import { log } from "./logger.js";
import { hub } from "./relay/hub.js";

const app = buildApp();
const server = http.createServer(app);
attachDashboardSocket(server);

const housekeeping = setInterval(() => {
  try {
    prune();
  } catch (error) {
    log.warn("prune failed", { error: (error as Error).message });
  }
}, 15 * 60 * 1000);
housekeeping.unref();

server.listen(config.port, () => {
  log.info("roblox-client-mcp listening", {
    port: config.port,
    publicUrl: config.publicUrl,
    database: config.databasePath,
    accountCreation: config.accountCreationEnabled,
  });

  if (!config.publicUrl.startsWith("http")) {
    log.warn("PUBLIC_URL looks wrong; generated loadstrings will be broken", {
      publicUrl: config.publicUrl,
    });
  }
});

server.on("error", (error) => {
  log.error("server error", { error: error.message });
  process.exitCode = 1;
});

let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info("shutting down", { signal, onlineSessions: hub.onlineCount() });

  const failInFlight = setTimeout(() => {
    log.warn("forcing exit after shutdown timeout");
    closeDb();
    process.exit(0);
  }, 10_000);
  failInFlight.unref();

  server.close(() => {
    clearTimeout(failInFlight);
    closeDb();
    log.info("bye");
    process.exit(0);
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

process.on("unhandledRejection", (reason) => {
  log.error("unhandled rejection", { reason: String(reason) });
});
