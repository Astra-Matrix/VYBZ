# Vault

Content-addressed version control for DAW projects and sample libraries.

## Object model

| Object | Meaning |
|---|---|
| **Repository** | Named container with a default branch. Id or slug in URLs. |
| **Blob** | Bytes addressed by SHA-256. Stored once per organization, regardless of how many repositories or commits reference it. |
| **Commit** | A complete tree (`entries: [{path, hash, size}]`), a parent, a message, free-form `meta`, and a content-derived `sha`. |
| **Branch** | A name pointing at a commit sha. Advanced atomically with an expected-head check. |

There is no staging area and no partial commit. Every commit is a full snapshot, which is what a session actually is.

## Workflow

1. **Hash locally.** Walk the folder, skip caches (`.asd`, `Backup/`, `Ableton Project Info/`, `.DS_Store`, …), hash each file.
2. **Ask what is missing.** `POST /blobs/exists` with all hashes.
3. **Upload only the missing bytes.** `POST /blobs` per file, raw body, optional `X-VYBZ-Content-SHA256`.
4. **Commit the tree.** `POST /commits` with every entry. Pass `parent` to require a specific head.
5. **Read.** History, tree, diff, branches.
6. **Restore.** For each entry, mint a signed link and write the file.

The local MCP server does all of this in `vault_commit_folder`, `vault_status`, and `vault_restore`.

## Hashing rules

- `tree_sha = SHA-256(canonical JSON of entries sorted by path)`.
- `sha = SHA-256(canonical JSON {tree, parent, message, created_at, org})`.
- Canonical JSON: sorted keys, no whitespace, UTF-8.

Two commits with the same tree on the same head collapse into `unchanged: true`. Two different commits never share a sha within an organization.

## Concurrency

Branch advancement uses a row lock and an expected-head compare. If another writer moved the head first, the API returns `409 head_moved` with the current head; fetch, re-check, and retry. The commit row created for the failed attempt is removed.

## Deduplication and cost

Storage is billed on unique bytes per organization. A sample library shared by every project costs its size once. Bounces and stems that change every session cost their delta.

## Metadata

`meta` is free-form JSON on the commit. Recommended keys: `daw`, `daw_version`, `bpm`, `key`, `sample_rate`, `plugins[]`, `author`. The console and agents surface these in history.

## Console

`/console/vault` lists the organization's repositories and creates new ones. A repository page shows branches, the commit history of the selected branch with file counts, sizes, and commit metadata, the complete file list at any commit with per-file downloads, and the changes each commit made against its parent. Branches can be created from any commit. In browsers that support directory access (Chrome and Edge), **Restore to folder** writes a commit's files into a folder on the machine, creating subfolders as needed. Everything the console shows comes from the same `/vault` routes the API and MCP tools use.

## What Vault is not

- Not a merge tool. Binary session files cannot be merged; branches exist so alternatives can coexist and be diffed by file.
- Not a public host. Blob links are signed and expire in 15 minutes.
- Not a DAW plugin. Capture is folder-based; a DAW-side capture source is on the roadmap.

## Limits

- 500 MB per blob request; larger files should be split by the client or delivered by chunked upload (roadmap).
- 20,000 entries per commit. 5,000 hashes per `exists` call.

Last updated: 2026-09-07
