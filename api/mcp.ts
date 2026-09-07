/**
 * Hosted MCP endpoint — https://vybz.cloud/api/mcp
 *
 * Remote Model Context Protocol server over Streamable HTTP (stateless). Any
 * MCP-capable agent connects with the organization's API key:
 *
 *   Authorization: Bearer vybz_live_…
 *
 * The key is forwarded, per request, to the VYBZ API; nothing is stored here.
 * Filesystem tools are disabled in hosted mode; use URLs or base64 payloads,
 * or run `npx @vybz/mcp-server` locally for folder workflows.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { VybzClient } from "../packages/mcp-server/src/client.js";
import { registerTools } from "../packages/mcp-server/src/tools.js";

const API_BASE = process.env.VYBZ_API_BASE ?? "https://vybz.cloud/v1";

function extractKey(req: IncomingMessage): string | null {
  const auth = String(req.headers.authorization ?? "");
  const m = /^Bearer\s+(vybz_(?:live|test)_[a-f0-9]{48})$/i.exec(auth.trim());
  if (m) return m[1];
  const x = String(req.headers["x-api-key"] ?? "");
  return /^vybz_(?:live|test)_[a-f0-9]{48}$/i.test(x) ? x : null;
}

function sendJson(res: ServerResponse, status: number, body: unknown, extra: Record<string, string> = {}) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extra });
  res.end(JSON.stringify(body));
}

export default async function handler(req: IncomingMessage & { body?: unknown }, res: ServerResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "authorization, x-api-key, content-type, accept, mcp-session-id, mcp-protocol-version");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Expose-Headers", "mcp-session-id, mcp-protocol-version");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const key = extractKey(req);
  if (!key) {
    sendJson(
      res,
      401,
      { error: { code: "unauthenticated", message: "Connect with `Authorization: Bearer vybz_live_…`. Create a key at https://vybz.cloud/console." } },
      { "WWW-Authenticate": 'Bearer realm="vybz-mcp"' },
    );
    return;
  }

  if (req.method !== "POST") {
    // Stateless server: no SSE resumption stream, no sessions to delete.
    sendJson(res, 405, { error: { code: "method_not_allowed", message: "This endpoint accepts POST (Streamable HTTP, stateless)." } });
    return;
  }

  // The organization's audit log records the user agent of every call. Carry
  // the connecting agent's own identity through so an operator can tell
  // Claude Code from Cursor from a custom client in the log.
  const via = String(req.headers["user-agent"] ?? "").replace(/[^\x20-\x7e]/g, "").slice(0, 160).trim();
  const client = new VybzClient({ apiKey: key, base: API_BASE, userAgent: via ? `vybz-mcp-hosted/1.1 (${via})` : "vybz-mcp-hosted/1.1" });
  const server = new McpServer(
    { name: "vybz", version: "1.1.0" },
    {
      instructions:
        "VYBZ hosted MCP. Provenance: register originals, issue watermarked copies, verify files, attribute leaks. Vault: content-addressed version control for DAW projects. Provide files as HTTPS URLs or base64; for local folders run `npx @vybz/mcp-server`.",
    },
  );
  registerTools(server, client, { filesystem: false });

  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
}
