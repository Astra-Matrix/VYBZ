# Quickstart

Five minutes from sign-up to an attributed leak.

## 1. Create a key

1. Sign in at [vybz.cloud/signin](https://vybz.cloud/signin) and name your organization.
2. **Console → API keys → New key.** Pick scopes. For this walkthrough enable all six.
3. Copy the key. It is shown once.

```bash
export VYBZ_API_KEY="vybz_live_…"
export BASE="https://vybz.cloud/v1"
```

## 2. Confirm the key

```bash
curl $BASE/me -H "Authorization: Bearer $VYBZ_API_KEY"
```

## 3. Register an original

```bash
curl -X POST $BASE/provenance/assets \
  -H "Authorization: Bearer $VYBZ_API_KEY" \
  -H "Content-Type: audio/wav" \
  -H "X-VYBZ-Title: Midnight Drive (Master)" \
  --data-binary @midnight-drive.wav
```

Save the `id` from the response as `ASSET`.

## 4. Issue a copy to a partner

```bash
curl -X POST $BASE/provenance/assets/$ASSET/issue \
  -H "Authorization: Bearer $VYBZ_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"recipient":"supervisor@studio.example","license":"preview"}' \
  -o for-supervisor.wav -D -
```

The headers carry `X-VYBZ-Issuance-Id`, `X-VYBZ-Watermark-Id`, and `X-VYBZ-C2PA`.

## 5. Attribute a leak

Take any copy that escaped, in whatever format it turned up, and ask. If you do not know which asset it came from, verify identifies it and attributes in one call:

```bash
curl -X POST "$BASE/provenance/verify?attribute=true" \
  -H "Authorization: Bearer $VYBZ_API_KEY" \
  --data-binary @found-on-the-internet.mp3
```

When you already know the asset:

```bash
curl -X POST $BASE/provenance/assets/$ASSET/detect \
  -H "Authorization: Bearer $VYBZ_API_KEY" \
  --data-binary @found-on-the-internet.mp3
```

```json
{
  "attributed": { "recipient": "supervisor@studio.example", "score": 0.41, "exact": false },
  "confidence": "high",
  "candidates": 1
}
```

## 6. Snapshot a project folder with an agent

Add the MCP server to Claude Desktop, Claude Code, or Cursor (see [Agents](./AGENTS.md)) and ask:

> Create a Vault repo called "Midnight Drive" and commit D:/Projects/Midnight Drive Project with the message "first snapshot".

The agent calls `vault_create_repo` then `vault_commit_folder`. Only bytes the organization does not already have are uploaded.

## 7. Watch it in the console

**Console → Audit log** shows each call with its request id, latency, and the agent that made it. **Overview** verifies the ledger chain.

Next: [API reference](./API.md) · [Provenance internals](./PROVENANCE.md) · [Vault workflow](./VAULT.md)

Last updated: 2026-09-07
