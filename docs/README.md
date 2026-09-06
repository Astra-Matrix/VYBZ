# VYBZ documentation

VYBZ is audio infrastructure for businesses. Two products, one API key, one console, one MCP server.

| Product | What it does | Who buys it |
|---|---|---|
| **Provenance** | Registers audio originals, issues per-recipient forensically watermarked copies with C2PA Content Credentials, verifies any file, and attributes leaks to the recipient who received them. | Sample libraries, sync and licensing houses, labels, distributors, AI music companies, post houses. |
| **Vault** | Content-addressed version control for DAW projects and sample libraries: commit whole folders, deduplicate across the organization, branch, diff, restore. | Studios, production teams, schools, catalog owners. |

Everything is reachable three ways: the **Console** for people, the **REST API** for systems, and **MCP** for AI agents.

## Start here

- [Quickstart](./QUICKSTART.md) — key to first call in five minutes.
- [Product](./PRODUCT.md) — what we sell, to whom, and why it wins.
- [Provenance](./PROVENANCE.md) — how the watermark, credentials, and attribution work.
- [Vault](./VAULT.md) — the object model and the folder workflow.
- [API reference](./API.md) — every route, header, and error.
- [Agents and MCP](./AGENTS.md) — connect Claude, Cursor, or any MCP client.
- [Security](./SECURITY.md) — keys, scopes, isolation, audit, data handling.

## Engineering

- [Architecture](./ARCHITECTURE.md) — services, data model, request path.
- [Operations](./OPERATIONS.md) — deploy, secrets, environments, runbooks.
- [Roadmap](./ROADMAP.md) — what is next and what is deliberately not.
- [Brand](./BRAND.md) — voice, visual system, and copy rules.
- [Documentation policy](./DOCUMENTATION_POLICY.md) — what counts as official.

Machine-readable: [`/v1/openapi.json`](https://vybz.cloud/v1/openapi.json) · [`/llms.txt`](https://vybz.cloud/llms.txt)

Last updated: 2026-09-05
