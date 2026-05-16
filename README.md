# Evernote link repair for Obsidian

Personal tooling to **fix broken internal links** in Markdown **after** Obsidian’s official **Import from Evernote** flow ([help](https://obsidian.md/help/import/evernote), [Importer plugin](https://obsidian.md/help/plugins/importer), [obsidian-importer](https://github.com/obsidianmd/obsidian-importer)). It does not export or import notes—that step is upstream.

## Why this exists

The expected starting point is output from that importer: export `.enex` from Evernote, then import per [Import from Evernote](https://obsidian.md/help/import/evernote). Content usually lands correctly, but note-to-note links often stay as `evernote:///…` URLs because the export does not carry enough stable identifiers for the importer to rewrite them—see [obsidian-importer#306](https://github.com/obsidianmd/obsidian-importer/issues/306). For many notes, fixing links by hand is not practical.

This CLI uses **metadata from a local Evernote backup** ([evernote-backup](https://github.com/vzhd1701/evernote-backup)) to map those URLs (and note GUIDs) to the Markdown files the importer created, then rewrites links in bulk.

## Prerequisites

- [nvm](https://github.com/nvm-sh/nvm) (or another Node version manager you prefer)
- Node **24** (see `.nvmrc`)
- **Imported notes** from Obsidian’s Evernote import ([help](https://obsidian.md/help/import/evernote) · [plugin](https://obsidian.md/help/plugins/importer) · [GitHub](https://github.com/obsidianmd/obsidian-importer)) — still containing broken `evernote://…` (or shard) links where internal links were not converted
- A folder of those `.md` files to pass as **`--vault`** (see below — a full Obsidian vault is **not** required)
- A synced **[evernote-backup](https://github.com/vzhd1701/evernote-backup)** SQLite database for GUID ↔ title metadata

### What to pass as `--vault`

`index`, `correlate`, `links`, and `rewrite` all take **`--vault <path>`** as the **root directory to scan** for Markdown. The tool walks that tree recursively (skipping `.git` and `node_modules`); paths in `link-map.json` and wikilinks are **relative to that root**.

You can point at:

- Your whole Obsidian vault, or
- **A single folder** of imported notes (e.g. only the tree the importer wrote), as long as the `.md` files you care about live under that path.

You do **not** need a `.obsidian` config folder or the rest of the vault—only the Markdown tree you want to analyze or rewrite.

## Workflow

Typical order (each step is a separate CLI invocation; see [#30](https://github.com/thomasvanlankveld/evernote-obsidian/issues/30) for a possible single `run` command later):

1. **`snapshot`** — read GUID + title from evernote-backup → `evernote-notes.json`
2. **`correlate`** — match snapshot rows to vault files → `link-map.json`
3. **`rewrite`** — replace Evernote note URLs with Obsidian wikilinks (`--dry-run` first, then `--out-dir` or `--in-place`)

Optional: **`index`** (preflight title uniqueness), **`links`** (report remaining Evernote URLs without writing).

## Commands (implemented so far)

After `npm install` and `npm run build`, the **`evernote-obsidian`** CLI is available (the npm package name matches the tool; see `package.json` `bin`).

- **`evernote-obsidian index [--vault <path>]`** — Walk **`--vault`** (default `./data`) and report whether normalized titles are unique enough for correlation.
- **`evernote-obsidian snapshot --db <path-to.db> [--out <path>] [--max-notes <n>]`** — Read note **GUID** and **title** from an [evernote-backup](https://github.com/vzhd1701/evernote-backup) SQLite database and write the same JSON snapshot shape as before (`./out/evernote-notes.json` by default; `/out/` is gitignored). Optional **`--max-notes`** caps how many rows are written (notes are ordered by title).

- **`evernote-obsidian correlate --snapshot <path> [--vault <path>] [--overrides <path>] [--out <path>]`** — Join snapshot rows to Markdown under **`--vault`** using the same **normalized title** rules as `index`, and write **`./out/link-map.json`** by default (GUID → path relative to **`--vault`**). Optional **`--overrides`** points at JSON `{ "version": 1, "byGuid": { "<guid>": "<path.md>" } }` for Evernote title collisions or intentional remapping.

- **`evernote-obsidian links [--vault <path>] [--out <path>] [--skip-other-evernote-hosts]`** — Scan Markdown under **`--vault`** for **`evernote://…`** and **`https://www.evernote.com/shard/…`** note URLs (plus other `*.evernote.com` links for reporting). Default is JSON on stdout; **`--out`** writes a report file.

- **`evernote-obsidian rewrite --map <path> [--vault <path>] [--dry-run | --out-dir <path> | --in-place [--backup]]`** — Replace Evernote **note** URLs with **`[[path|alias]]`** wikilinks (paths relative to **`--vault`**) using **`link-map.json`** from `correlate`. With no output mode flag, **`--dry-run`** is implied: counts changes without writing. **`--out-dir`** writes a mirror of the tree under **`--vault`** containing only files that changed. **`--in-place`** overwrites those Markdown files; add **`--backup`** to write **`<file>.evernote-obsidian.bak`** before each overwrite.

Create the database with upstream’s **`evernote-backup init-db`** / **`sync`** (their README covers OAuth and Yinxiang). Then point **`--db`** at that file (often `en_backup.db`).

**Implementation note:** Node’s built-in **`node:sqlite`** is used in **read-only** mode. As of Node 24 it may log an experimental-feature warning; the reader only runs plain SQL (`guid`, `title` from the `notes` table).

## Known limitations

- **Title-only correlation (v1):** `correlate` matches Evernote snapshot rows to vault files by **normalized title** (filename or frontmatter `title:`). If the [Importer](https://github.com/obsidianmd/obsidian-importer) changed a title, you renamed files, or two notes collide after normalization, correlation fails or needs manual **`byGuid` overrides**. Future: GUID in frontmatter ([#29](https://github.com/thomasvanlankveld/evernote-obsidian/issues/29)).
- **Link hosts:** `links` / `rewrite` target **`evernote://…`** and **`https://www.evernote.com/shard/…`** note URLs (plus other `*.evernote.com` for reporting). **Regional products** (e.g. Yinxiang / 印象笔记 on non-`evernote.com` domains) are **out of scope** unless URLs in your Markdown use the shapes above. evernote-backup can still sync Yinxiang metadata into the SQLite DB for `snapshot`.
- **Not a full YAML parser:** Frontmatter support is a line-based subset (`title:` only today). See the EDD for details.

## Evernote snapshot: limits

These boundaries are intentional for an early, personal tool.

- **Source:** Only databases produced by **[evernote-backup](https://github.com/vzhd1701/evernote-backup)** with the expected **`notes`** table are supported. Other SQLite exports are rejected with a clear error.
- **Rows included:** Non-trashed notes (`is_active` not `0`) with non-empty `guid` and `title`. Rows still missing `is_active` (pending sync in the backup tool) are treated as active.
- **`updated` field:** Evernote’s update time is stored inside Python-pickled blobs in that database, which this CLI does not decode. Snapshot JSON uses the sentinel timestamp **`1970-01-01T00:00:00.000Z`** for every row; later pipeline phases that only need **title ↔ GUID** correlation are unaffected.

## Restoring `data/` on a new machine

`data/` is not in git. Copy a folder of imported `.md` files into `data/` locally, symlink your importer output or Obsidian vault tree there, or pass **`--vault`** to any path on disk.

## Security

- Never commit a backup **`.db`** file, GitHub tokens, or `.enex` exports that contain private notes unless this repo is strictly private and you accept the risk.
- **`link-map.json`**, broken-link reports, and **`*.evernote-obsidian.bak`** files can embed **absolute paths** to your vault or home directory. Treat them like secrets if paths are sensitive, and scrub before sharing logs or opening issues upstream.
- **`rewrite --in-place`** changes your real Markdown; prefer **`--dry-run`** first, then **`--out-dir`** on a copy, and only use **`--in-place --backup`** when you are satisfied with the diff. OAuth tokens for **evernote-backup** live outside this repo; follow upstream guidance on where those credentials are stored.

## Contributing

Local build commands and **optional** Git / GitHub notes (no prescribed credential layout in git): [CONTRIBUTING.md](CONTRIBUTING.md).

## Context

- [Import from Evernote – Obsidian Help](https://obsidian.md/help/import/evernote)
- [Importer – Obsidian Help](https://obsidian.md/help/plugins/importer)
- [obsidianmd/obsidian-importer](https://github.com/obsidianmd/obsidian-importer)
- [[Evernote] Links for Evernote notes are not converted · Issue #306 · obsidianmd/obsidian-importer](https://github.com/obsidianmd/obsidian-importer/issues/306)
