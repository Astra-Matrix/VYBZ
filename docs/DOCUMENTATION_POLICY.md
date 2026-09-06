# Documentation policy

## Official sources

Only two locations are authoritative:

1. `docs/` — product, reference, and engineering documentation.
2. `public/legal/` — customer-facing legal documents.

Everything else is not documentation. That includes code comments, commit messages, chat transcripts, issue threads, and any file that existed before the platform pivot.

## Redaction

All documentation created before **2026-09-05** is redacted. It must not be read for direction, quoted, summarized, restored from git history, or used as a seed for new documents. Files that referenced a masterplan, phases, gates, suites, living profiles, social features, or the former consumer product were removed from the working tree in the pivot commit. If one resurfaces, delete it.

Code comments that cite redacted documents are historical noise. Rewrite them when the code they annotate is touched; do not follow them.

## Writing new documentation

- Put it in `docs/` as a new file or a new section of an existing file.
- End every file with `Last updated: YYYY-MM-DD`.
- Link with relative Markdown links; the site renders them.
- Keep the [Brand](./BRAND.md) voice: precise, calm, short, honest about confidence.
- When the API changes, `docs/API.md`, `supabase/functions/_shared/openapi.ts`, and the gateway change in the same commit. When MCP tools change, `docs/AGENTS.md` changes with them.

## Review

A pull request that changes behavior without changing documentation is incomplete.

Last updated: 2026-09-05
