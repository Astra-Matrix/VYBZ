#!/usr/bin/env node
/**
 * VYBZ MCP server — local (stdio) transport.
 *
 *   VYBZ_API_KEY=vybz_live_…  npx @vybz/mcp-server
 *   Optional: VYBZ_API_BASE (default https://vybz.cloud/v1)
 *             VYBZ_ROOTS   (path-list; filesystem tools are confined to these folders)
 *
 * Claude Desktop / Claude Code / Cursor configuration:
 *   { "mcpServers": { "vybz": { "command": "npx", "args": ["-y", "@vybz/mcp-server"],
 *                                "env": { "VYBZ_API_KEY": "vybz_live_…" } } } }
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { delimiter } from "node:path";
import { VybzClient } from "./client.js";
import { registerTools } from "./tools.js";

const apiKey = process.env.VYBZ_API_KEY ?? "";
if (!apiKey) {
  process.stderr.write("VYBZ_API_KEY is not set. Create a key in the VYBZ Console (https://vybz.cloud/console).\n");
  process.exit(2);
}

const client = new VybzClient({ apiKey, base: process.env.VYBZ_API_BASE, userAgent: "vybz-mcp-local/1.0" });
const roots = (process.env.VYBZ_ROOTS ?? "").split(delimiter).map((s) => s.trim()).filter(Boolean);

const server = new McpServer(
  { name: "vybz", version: "1.0.0" },
  {
    instructions:
      "VYBZ gives you two capabilities for audio businesses. Provenance: register originals, issue per-recipient watermarked copies, verify files, and attribute leaks. Vault: content-addressed version control for DAW projects (commit folders, restore, diff). All actions are scoped to the organization behind the API key and are audited. Prefer vault_commit_folder for snapshots and provenance_detect when asked who leaked a file.",
  },
);
registerTools(server, client, { filesystem: true, roots });

const transport = new StdioServerTransport();
await server.connect(transport);
