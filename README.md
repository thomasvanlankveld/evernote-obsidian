# Evernote → Obsidian migration

Personal tooling to move notes from Evernote into Obsidian when the stock import path leaves **internal links broken**.

## Why this exists

The usual flow is: export `.enex` from Evernote, import with Obsidian’s [Importer](https://obsidian.md/help/import/evernote). That works for content, but note-to-note links often stay as `evernote:///…` URLs because the export does not carry enough stable identifiers for importers to rewrite them—see [obsidian-importer#306](https://github.com/obsidianmd/obsidian-importer/issues/306). For a large vault with many internal links, fixing that by hand is not practical.

A complementary approach is to use **metadata from a local Evernote backup** ([evernote-backup](https://github.com/vzhd1701/evernote-backup)) to build a mapping from those URLs or note identities to the Markdown files Obsidian actually created, then rewrite links in bulk. This repo is a place to grow that kind of automation.

## Prerequisites

- [nvm](https://github.com/nvm-sh/nvm) (or another Node version manager you prefer)
- Node **24** (see `.nvmrc`)

## Commands (implemented so far)

After `npm install` and `npm run build`, the **`evernote-obsidian`** CLI is available (the npm package name matches the tool; see `package.json` `bin`).

- **`evernote-obsidian index [--vault <path>]`** — Walk the vault (default `./data`) and report whether normalized titles are unique enough for correlation.
- **`evernote-obsidian snapshot --db <path-to.db> [--out <path>] [--max-notes <n>]`** — Read note **GUID** and **title** from an [evernote-backup](https://github.com/vzhd1701/evernote-backup) SQLite database and write the same JSON snapshot shape as before (`./out/evernote-notes.json` by default; `/out/` is gitignored). Optional **`--max-notes`** caps how many rows are written (notes are ordered by title).

- **`evernote-obsidian correlate --snapshot <path> [--vault <path>] [--overrides <path>] [--out <path>]`** — Join snapshot rows to vault Markdown files using the same **normalized title** rules as `index`, and write **`./out/link-map.json`** by default (GUID → vault-relative path). Optional **`--overrides`** points at JSON `{ "version": 1, "byGuid": { "<guid>": "<path.md>" } }` for Evernote title collisions or intentional remapping.

- **`evernote-obsidian links [--vault <path>] [--out <path>] [--skip-other-evernote-hosts]`** — Scan Markdown for **`evernote://…`** and **`https://www.evernote.com/shard/…`** note URLs (plus other `*.evernote.com` links for reporting). Default is JSON on stdout; **`--out`** writes a report file.

- **`evernote-obsidian rewrite --map <path> [--vault <path>] [--dry-run | --out-dir <path> | --in-place [--backup]]`** — Replace Evernote **note** URLs with **`[[vault-relative-path|alias]]`** wikilinks using **`link-map.json`** from `correlate`. With no output mode flag, **`--dry-run`** is implied: counts changes without writing. **`--out-dir`** writes a mirror of the vault tree containing only files that changed. **`--in-place`** overwrites vault Markdown; add **`--backup`** to write **`<file>.evernote-obsidian.bak`** before each overwrite.

Create the database with upstream’s **`evernote-backup init-db`** / **`sync`** (their README covers OAuth and Yinxiang). Then point **`--db`** at that file (often `en_backup.db`).

**Implementation note:** Node’s built-in **`node:sqlite`** is used in **read-only** mode. As of Node 24 it may log an experimental-feature warning; the reader only runs plain SQL (`guid`, `title` from the `notes` table).

## Evernote snapshot: limits

These boundaries are intentional for an early, personal migration tool.

- **Source:** Only databases produced by **[evernote-backup](https://github.com/vzhd1701/evernote-backup)** with the expected **`notes`** table are supported. Other SQLite exports are rejected with a clear error.
- **Rows included:** Non-trashed notes (`is_active` not `0`) with non-empty `guid` and `title`. Rows still missing `is_active` (pending sync in the backup tool) are treated as active.
- **`updated` field:** Evernote’s update time is stored inside Python-pickled blobs in that database, which this CLI does not decode. Snapshot JSON uses the sentinel timestamp **`1970-01-01T00:00:00.000Z`** for every row; later pipeline phases that only need **title ↔ GUID** correlation are unaffected.

## Restoring `data/` on a new machine

`data/` is not in git. Copy your vault snapshot or re-import from Evernote into `data/` locally, or symlink it to your real Obsidian vault folder if that fits your workflow.

## Security

- Never commit a backup **`.db`** file, GitHub tokens, or `.enex` exports that contain private notes unless this repo is strictly private and you accept the risk.
- **`link-map.json`**, broken-link reports, and **`*.evernote-obsidian.bak`** files can embed **absolute paths** to your vault or home directory. Treat them like secrets if paths are sensitive, and scrub before sharing logs or opening issues upstream.
- **`rewrite --in-place`** changes your real Markdown; prefer **`--dry-run`** first, then **`--out-dir`** on a copy, and only use **`--in-place --backup`** when you are satisfied with the diff. OAuth tokens for **evernote-backup** live outside this repo; follow upstream guidance on where those credentials are stored.

## Contributing

Local build commands and **optional** Git / GitHub notes (no prescribed credential layout in git): [CONTRIBUTING.md](CONTRIBUTING.md).

## Context

- [Import from Evernote – Obsidian Help](https://obsidian.md/help/import/evernote)
- [[Evernote] Links for Evernote notes are not converted · Issue #306 · obsidianmd/obsidian-importer](https://github.com/obsidianmd/obsidian-importer/issues/306)
