# @vybz/mcp-server

Model Context Protocol server for the [VYBZ API](https://vybz.cloud): Provenance (forensic watermarking, Content Credentials, verification, leak attribution) and Vault (content-addressed version control for DAW projects).

```bash
VYBZ_API_KEY=vybz_live_… npx -y @vybz/mcp-server
```

Claude Desktop:

```json
{ "mcpServers": { "vybz": { "command": "npx", "args": ["-y", "@vybz/mcp-server"], "env": { "VYBZ_API_KEY": "vybz_live_…", "VYBZ_ROOTS": "D:/Projects" } } } }
```

Prefer no install? Use the hosted endpoint `https://vybz.cloud/api/mcp` with the same bearer key.

Environment: `VYBZ_API_KEY` (required), `VYBZ_API_BASE` (default `https://vybz.cloud/v1`), `VYBZ_ROOTS` (confine filesystem tools).

Full tool list and guidance: https://vybz.cloud/docs/agents

Typed client:

```ts
import { VybzClient } from "@vybz/mcp-server/client";
```

MIT © Andrew Laustrup (VYBZ)
