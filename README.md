# Evernote link repair for Obsidian

Personal tooling to **fix broken internal links** in Markdown **after** Obsidian’s official **Import from Evernote** flow ([help](https://obsidian.md/help/import/evernote), [Importer plugin](https://obsidian.md/help/plugins/importer), [obsidian-importer](https://github.com/obsidianmd/obsidian-importer)). It does not export or import notes—that step is upstream.

## Why this exists

The expected starting point is output from that importer: export `.enex` from Evernote, then import per [Import from Evernote](https://obsidian.md/help/import/evernote). Content usually lands correctly, but note-to-note links often stay as `evernote:///…` URLs because the export does not carry enough stable identifiers for the importer to rewrite them—see [obsidian-importer#306](https://github.com/obsidianmd/obsidian-importer/issues/306). For many notes, fixing links by hand is not practical.

This CLI uses **metadata from a local Evernote backup** ([evernote-backup](https://github.com/vzhd1701/evernote-backup)) to map those URLs (and note GUIDs) to the Markdown files the importer created, then rewrites links in bulk.

## Prerequisites

- [nvm](https://github.com/nvm-sh/nvm) (or another Node version manager you prefer)
- Node **24** (see `.nvmrc`)
- Markdown from Obsidian’s **Import from Evernote** ([help](https://obsidian.md/help/import/evernote) · [plugin](https://obsidian.md/help/plugins/importer) · [GitHub](https://github.com/obsidianmd/obsidian-importer)) — usually still with broken `evernote://…` / shard links — on disk as a **folder you pass to `--vault-dir`** (a single importer output tree is enough; a full vault with `.obsidian` is not required; see below)
- A synced **[evernote-backup](https://github.com/vzhd1701/evernote-backup)** SQLite database for GUID ↔ title metadata

### What to pass as `--vault-dir`

`run`, `index`, `correlate`, `links`, and `rewrite` all take **`--vault-dir <path>`** as the **root directory to scan** for Markdown. The tool walks that tree recursively (skipping `.git` and `node_modules`); paths in `link-map.json` and wikilinks are **relative to that root**. **`--vault`** is an equivalent alias.

You can point at:

- Your whole Obsidian vault, or
- **A single folder** of imported notes (e.g. only the tree the importer wrote), as long as the `.md` files you care about live under that path.

You do **not** need a `.obsidian` config folder or the rest of the vault—only the Markdown tree you want to analyze or rewrite.

## Quick start

After `npm install` and `npm run build`, point at your importer output and evernote-backup database:

```bash
# Preview changes (writes ./out/evernote-notes.json and ./out/link-map.json)
evernote-obsidian run --vault-dir /path/to/imported-notes --db /path/to/en_backup.db

# Write a mirrored vault with fixed links
evernote-obsidian run --vault-dir /path/to/imported-notes --db /path/to/en_backup.db --out-dir ./out/rewritten-vault
```

`run` chains **snapshot → correlate → rewrite**. Use **`--dry-run`** explicitly if you like (it is the default when neither **`--out-dir`** nor **`--in-place`** is set). Re-run with **`--snapshot`** and/or **`--map`** to skip steps when intermediate files already exist (map-only runs rewrite only).

Each step prints a JSON summary on stdout (pretty-printed). For scripting, parse brace-balanced JSON objects or use the step commands separately.

## Workflow

**Typical:** one **`run`** invocation (above).

**Step-by-step** (inspect or rerun individual artifacts):

1. **`snapshot`** — read GUID + title from evernote-backup → `evernote-notes.json`
2. **`correlate`** — match snapshot rows to vault files → `link-map.json`
3. **`rewrite`** — replace Evernote note URLs with Obsidian wikilinks (`--dry-run` first, then `--out-dir` or `--in-place`)

Optional: **`index`** (preflight title uniqueness), **`links`** (report remaining Evernote URLs without writing).

## Commands

- **`evernote-obsidian run --vault-dir <path> [--db <path>] [--snapshot <path>] [--map <path>] [--out <path>] [--map-out <path>] [--overrides <path>] [--report <path>] [--verbose] [--max-notes <n>] [--dry-run | --out-dir <path> | --in-place [--backup]]`** — Run the full pipeline. Requires explicit **`--vault-dir`** (or **`--vault`**). **`--db`** is required on a fresh run; omit it when reusing **`--snapshot`** and/or **`--map`**. **`--out`** sets the snapshot JSON path when generating a snapshot (default `./out/evernote-notes.json`); **`--map-out`** sets the link map path (default `./out/link-map.json`). Pass **`--snapshot`** / **`--map`** to skip those steps. Correlate failure output matches **`correlate`** (**`--report`**, **`--verbose`**).

- **`evernote-obsidian index [--vault-dir <path>]`** — Walk **`--vault-dir`** (default `./data`) and report whether normalized titles and frontmatter **`evernote-guid:`** values are unique enough for correlation.
- **`evernote-obsidian snapshot --db <path-to.db> [--out <path>] [--max-notes <n>]`** — Read note **GUID** and **title** from an [evernote-backup](https://github.com/vzhd1701/evernote-backup) SQLite database and write the same JSON snapshot shape as before (`./out/evernote-notes.json` by default; `/out/` is gitignored). Optional **`--max-notes`** caps how many rows are written (notes are ordered by title).

- **`evernote-obsidian correlate --snapshot <path> [--vault-dir <path>] [--overrides <path>] [--out <path>] [--map-out <path>] [--report <path>] [--verbose]`** — Join snapshot rows to Markdown under **`--vault-dir`**: match by frontmatter **`evernote-guid:`** when present (line-based YAML subset, same style as `title:`), else **normalized title** (same rules as `index`). Writes **`./out/link-map.json`** by default (GUID → path relative to **`--vault-dir`**). **`--map-out`** is an alias for **`--out`**. Optional **`--overrides`** points at JSON `{ "version": 1, "byGuid": { "<guid>": "<path.md>" } }` for Evernote title collisions or intentional remapping. On failure, stderr is a compact summary; full detail goes to **`./out/correlate-report.json`** unless **`--report`** is set (**`--verbose`** restores full JSON on stderr).

- **`evernote-obsidian links [--vault-dir <path>] [--out <path>] [--skip-other-evernote-hosts]`** — Scan Markdown under **`--vault-dir`** for **`evernote://…`** and **`https://www.evernote.com/shard/…`** note URLs (plus other `*.evernote.com` links for reporting). Default is JSON on stdout; **`--out`** writes a report file.

- **`evernote-obsidian rewrite --map <path> [--vault-dir <path>] [--dry-run | --out-dir <path> | --in-place [--backup]]`** — Replace Evernote **note** URLs with **`[[path|alias]]`** wikilinks (paths relative to **`--vault-dir`**) using **`link-map.json`** from `correlate`. With no output mode flag, **`--dry-run`** is implied: counts changes without writing. **`--out-dir`** writes a mirror of the tree under **`--vault-dir`** containing only files that changed. **`--in-place`** overwrites those Markdown files via a same-directory temp file and atomic **`rename`**; add **`--backup`** to write **`<file>.evernote-obsidian.bak`** (pre-rewrite content) before each replace.

Create the database with upstream’s **`evernote-backup init-db`** / **`sync`** (their README covers OAuth and Yinxiang). Then point **`--db`** at that file (often `en_backup.db`).

**Implementation note:** Node’s built-in **`node:sqlite`** is used in **read-only** mode. As of Node 24 it may log an experimental-feature warning; the reader only runs plain SQL (`guid`, `title` from the `notes` table).

## Known limitations

- **Correlation keys:** `correlate` prefers vault frontmatter **`evernote-guid:`** (lowercase UUID scalar) when present, then falls back to **normalized title** (filename or frontmatter `title:`). Ambiguous duplicate GUIDs in the vault, GUID/title disagreements, or duplicate Evernote titles without resolvable GUIDs fail with a JSON report (no silent wrong links). Use **`byGuid` overrides** for intentional remapping.
- **Correlate failures:** On exit **1**, stderr shows a short hint and compact JSON counts; the full unmatched list and related arrays are written to **`./out/correlate-report.json`** by default (override with **`--report <path>`**). Pass **`--verbose`** (or **`--report-stdout`**) to also print the full JSON on stderr for scripts that parsed it there before. **`run`** accepts the same flags.
- **Link hosts:** `links` / `rewrite` target **`evernote://…`** and **`https://www.evernote.com/shard/…`** note URLs (plus other `*.evernote.com` for reporting). **Regional products** (e.g. Yinxiang / 印象笔记 on non-`evernote.com` domains) are **out of scope** unless URLs in your Markdown use the shapes above. evernote-backup can still sync Yinxiang metadata into the SQLite DB for `snapshot`.
- **Code spans:** `links` and `rewrite` **ignore** Evernote URLs inside fenced code blocks (`` ``` `` / `~~~`) and inline code (`` `…` ``). Literals kept for documentation or examples are left unchanged; only URLs in normal prose or link syntax are reported and rewritten.
- **Not a full YAML parser:** Frontmatter support is a line-based subset (`title:` and `evernote-guid:` scalars only). See the EDD for details.

## Evernote snapshot: limits

These boundaries are intentional for an early, personal tool.

- **Source:** Only databases produced by **[evernote-backup](https://github.com/vzhd1701/evernote-backup)** with the expected **`notes`** table are supported. Other SQLite exports are rejected with a clear error.
- **Rows included:** Non-trashed notes (`is_active` not `0`) with non-empty `guid` and `title`. Rows still missing `is_active` (pending sync in the backup tool) are treated as active.
- **`updated` field:** Evernote’s update time is stored inside Python-pickled blobs in that database, which this CLI does not decode. Snapshot JSON uses the sentinel timestamp **`1970-01-01T00:00:00.000Z`** for every row; later pipeline phases that only need **title ↔ GUID** correlation are unaffected.

## Restoring `data/` on a new machine

`data/` is not in git. Copy a folder of imported `.md` files into `data/` locally, symlink your importer output or Obsidian vault tree there, or pass **`--vault-dir`** to any path on disk.

## Security

- Never commit a backup **`.db`** file, GitHub tokens, or `.enex` exports that contain private notes unless this repo is strictly private and you accept the risk.
- **`link-map.json`**, broken-link reports, and **`*.evernote-obsidian.bak`** files can embed **absolute paths** to your vault or home directory. Treat them like secrets if paths are sensitive, and scrub before sharing logs or opening issues upstream.
- **`rewrite --in-place`** changes your real Markdown; prefer **`--dry-run`** first, then **`--out-dir`** on a copy, and only use **`--in-place --backup`** when you are satisfied with the diff. In-place writes use a same-directory temp file and **`rename`** so a crash mid-write should not leave a torn note file on a normal local disk; **NFS, some cloud sync mounts, and network folders** may not offer the same guarantees. OAuth tokens for **evernote-backup** live outside this repo; follow upstream guidance on where those credentials are stored.

## Contributing

Local build commands and **optional** Git / GitHub notes (no prescribed credential layout in git): [CONTRIBUTING.md](CONTRIBUTING.md).

## Context

- [Import from Evernote – Obsidian Help](https://obsidian.md/help/import/evernote)
- [Importer – Obsidian Help](https://obsidian.md/help/plugins/importer)
- [obsidianmd/obsidian-importer](https://github.com/obsidianmd/obsidian-importer)
- [[Evernote] Links for Evernote notes are not converted · Issue #306 · obsidianmd/obsidian-importer](https://github.com/obsidianmd/obsidian-importer/issues/306)
