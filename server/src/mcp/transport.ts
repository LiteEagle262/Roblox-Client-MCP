import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Request, Response } from "express";
import { log } from "../logger.js";
import type { Account } from "../store.js";
import { createMcpServer } from "./server.js";

/**
 * One MCP session per HTTP request (stateless mode). The account determines
 * which executor session the tools talk to.
 */
export async function handleMcpRequest(account: Account, req: Request, res: Response): Promise<void> {
  const server = createMcpServer(account);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  res.on("close", () => {
    void transport.close();
    void server.close();
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    log.error("mcp request failed", { accountId: account.id, error: (error as Error).message });
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "internal server error" },
        id: null,
      });
    }
  }
}
