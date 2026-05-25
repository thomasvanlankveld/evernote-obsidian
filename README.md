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

`run`, `check`, `index`, `guid-backfill`, `correlate`, `links`, and `rewrite` all take **`--vault-dir <path>`** as the **root directory to scan** for Markdown. The tool walks that tree recursively (skipping `.git` and `node_modules`); paths in `link-map.json` and wikilinks are **relative to that root**. **`--vault`** is an equivalent alias.

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

`run` chains **snapshot → correlate → unescape-links → rewrite → fix-resources** (link repair plus importer `_resources` embed paths). Use **`--dry-run`** explicitly if you like (it is the default when neither **`--out-dir`** nor **`--in-place`** is set). Re-run with **`--snapshot`** and/or **`--map`** to skip steps when intermediate files already exist. With **`--map`** only (no **`--snapshot`** / **`--db`**), **`run`** skips snapshot and correlate and still runs **`unescape-links`** → **`rewrite`** → **`fix-resources`** (omit unescape via **`--skip-unescape-links`**).

In a terminal, `run` prints a short human-readable step summary (✓/✗ per step and pass/fail). For scripts, use **`--json`** to get one JSON object on stdout with all step summaries, or **`--json-steps`** for the legacy per-step JSON blobs. Non-TTY stdout (pipes, CI) defaults to **`--json`**.

## Workflow

**Typical:** one **`run`** invocation (above).

**Step-by-step** (inspect or rerun individual artifacts):

1. **`snapshot`** — read GUID + title from evernote-backup → `evernote-notes.json`
2. **`guid-backfill`** *(optional)* — write missing **`evernote-guid:`** frontmatter from the snapshot (see below)
3. **`correlate`** — match snapshot rows to vault files → `link-map.json`
4. **`unescape-links`** — fix importer-escaped external `[text](url)` links (`--dry-run` first)
5. **`rewrite`** — replace Evernote note URLs with Obsidian wikilinks using the link map
6. **`fix-resources`** — fix importer `Evernote/Writings/_resources/…` embed wikilinks → `_resources/…`

Steps 4–6 use the same output modes: **`--dry-run`** (default), **`--out-dir`**, or **`--in-place`** (optional **`--backup`**).

Optional: **`check`** (compare Evernote vs vault note counts before correlate), **`index`** (preflight title/GUID uniqueness), **`links`** (report remaining Evernote URLs without writing).

**`run`** prints the same Evernote-vs-vault count preflight on stderr when **`--db`** or **`--snapshot`** is available (hints only; exit **1** only for vault index collisions). You can also run **`check`** standalone before your first **`run`**, after moving the vault folder, or when **`correlate`** reports many unmatched notes — it does not build a link map; use **`correlate`** for that.

## Commands

- **`evernote-obsidian run --vault-dir <path> [--db <path>] [--snapshot <path>] [--map <path>] [--out <path>] [--map-out <path>] [--overrides <path>] [--report <path>] [--no-report-md] [--verbose] [--max-notes <n>] [--json | --json-steps] [-q] [--progress] [--skip-unescape-links] [--dry-run | --out-dir <path> | --in-place [--backup]]`** — Convenience wrapper (not a separate pipeline stage): chains **`snapshot`** → **`correlate`** → **`unescape-links`** → **`rewrite`** → **`fix-resources`** in one process. Requires explicit **`--vault-dir`** (or **`--vault`**). Provide **`--db`** or **`--snapshot`** to build or reuse Evernote metadata (or **`--map`** alone to rerun only the repair chain). Omit **`--db`** when reusing **`--snapshot`** and/or **`--map`**. When **`--db`** or **`--snapshot`** is set, prints Evernote vs vault count preflight on stderr first (same hints as **`check`**; stops early on vault index collisions). **`--out`** sets the snapshot JSON path when generating a snapshot (default `./out/evernote-notes.json`); **`--map-out`** sets the link map path (default `./out/link-map.json`). Pass **`--snapshot`** / **`--map`** to skip those steps; **`--skip-unescape-links`** omits the unescape step. Human summary on stdout in a TTY; **`--json`** for one machine-readable summary; **`--json-steps`** for legacy per-step stdout JSON. Correlate failure output matches **`correlate`** (**`--report`**, **`--no-report-md`**, **`--verbose`**).

- **`evernote-obsidian check --vault-dir <path> [--snapshot <path> | --db <path>] [--max-notes <n>] [--json]`** — Preflight: count Markdown under **`--vault-dir`** vs Evernote notes in **`--snapshot`** or a quick read of **`--db`** (no correlate, no link map). If **`--snapshot`** / **`--db`** are omitted, uses **`./out/evernote-notes.json`** when that file exists. Human-readable counts on a TTY; hints on stderr; **`--json`** for scripts. Exit **1** only when the vault index has title or **`evernote-guid:`** collisions (same blockers as **`index`** / **`correlate`**); count mismatches are hints only (exit **0**).

- **`evernote-obsidian index [--vault-dir <path>]`** — Walk **`--vault-dir`** (default `./data`) and report whether normalized titles (full Obsidian Importer `sanitizeFileName` rules, including `badLinkRe`) and frontmatter **`evernote-guid:`** values are unique enough for correlation.
- **`evernote-obsidian snapshot --db <path-to.db> [--out <path>] [--max-notes <n>]`** — Read note **GUID** and **title** from an [evernote-backup](https://github.com/vzhd1701/evernote-backup) SQLite database and write the same JSON snapshot shape as before (`./out/evernote-notes.json` by default; `/out/` is gitignored). Optional **`--max-notes`** caps how many rows are written (notes are ordered by title).

- **`evernote-obsidian correlate --snapshot <path> [--vault-dir <path>] [--overrides <path>] [--out <path>] [--map-out <path>] [--report <path>] [--no-report-md] [--verbose]`** — Join snapshot rows to Markdown under **`--vault-dir`**: match by frontmatter **`evernote-guid:`** when present (line-based YAML subset, same style as `title:`), else **normalized title** with full Importer `sanitizeFileName` rules (same as `index`, including `badLinkRe` for `#` and brackets). Writes **`./out/link-map.json`** by default (GUID → path relative to **`--vault-dir`**). **`--map-out`** is an alias for **`--out`**. Optional **`--overrides`** points at JSON `{ "version": 1, "byGuid": { "<guid>": "<path.md>" } }` for Evernote title collisions or intentional remapping. On failure, stderr is a compact summary; full detail goes to **`./out/correlate-report.json`** (and a human-readable **`./out/correlate-report.md`** beside it unless **`--no-report-md`** or a custom **`--report`** path — if **`--report`** ends in `.json`, the Markdown path replaces that extension with `.md`; otherwise `.md` is appended, e.g. `custom.txt` → `custom.txt.md`). **`--verbose`** restores full JSON on stderr.

- **`evernote-obsidian guid-backfill --snapshot <path> [--vault-dir <path>] [--overrides <path>] [--dry-run | --in-place] [--report <path>] [--verbose]`** — After Obsidian import, many notes lack **`evernote-guid:`** in frontmatter. This command correlates the snapshot to vault paths (same rules as **`correlate`**), then for each match inserts a lowercase **`evernote-guid:`** line when missing. Existing matching GUIDs are skipped; a different existing GUID is reported as a **conflict** and never overwritten. **`--dry-run`** is the default (lists paths in the JSON summary); **`--in-place`** writes via atomic replace (same pattern as **`rewrite --in-place`**). Not part of **`run`** — run it explicitly once after import if you want stable GUID-based correlation. Commit or back up the vault first; every touched note is a real file change in Obsidian/git.

- **`evernote-obsidian links [--vault-dir <path>] [--out <path>] [--skip-other-evernote-hosts]`** — Scan Markdown under **`--vault-dir`** for **`evernote://…`** and **`https://www.evernote.com/shard/…`** note URLs (plus other `*.evernote.com` links for reporting). Default is JSON on stdout; **`--out`** writes a report file.

- **`evernote-obsidian unescape-links [--vault-dir <path>] [--only <vault-relative-path>] [--dry-run | --out-dir <path> | --in-place [--backup]]`** — Fix Evernote-importer output where external markdown links were wrongly escaped as **`\[text\](url)`** instead of **`[text](url)`**. Only **http(s)**, **mailto**, **ftp**, or other **`://`** URLs are touched (not wikilinks). Skips fenced and inline code spans (same rules as **`links`** / **`rewrite`**). Repeat **`--only`** to limit to vault-relative path prefixes. With no output mode flag, **`--dry-run`** is implied. Included in **`run`** before **`rewrite`** unless you pass **`--skip-unescape-links`** on **`run`**.

- **`evernote-obsidian rewrite --map <path> [--vault-dir <path>] [--dry-run | --out-dir <path> | --in-place [--backup]]`** — Replace Evernote **note** URLs with **`[[path|alias]]`** wikilinks (paths relative to **`--vault-dir`**) using **`link-map.json`** from `correlate`. With no output mode flag, **`--dry-run`** is implied: counts changes without writing. **`--out-dir`** writes a mirror of the tree under **`--vault-dir`** containing only files that changed. **`--in-place`** overwrites those Markdown files via a same-directory temp file and atomic **`rename`**; add **`--backup`** to write **`<file>.evernote-obsidian.bak`** (pre-rewrite content) before each replace.

- **`evernote-obsidian fix-resources [--vault-dir <path>] [--dry-run | --out-dir <path> | --in-place [--backup]]`** — Rewrite importer embed wikilinks that use the wrong prefix **`Evernote/Writings/_resources/…`** to vault-relative **`_resources/…`** (e.g. **`![[Evernote/Writings/_resources/photo.png]]`** → **`![[_resources/photo.png]]`**). Does not use **`link-map.json`**; run after **`correlate`** (and usually after **`rewrite`** when using **`run`**). Same **`--dry-run`** / **`--out-dir`** / **`--in-place`** behavior as **`rewrite`**. With **`--out-dir`**, reads from the mirrored tree when present (under **`run`**, **`rewrite`** already sees **`unescape-links`** output in the same **`--out-dir`**; for manual step-by-step runs, a prior **`unescape-links --out-dir`** or **`rewrite --out-dir`** in that directory suffices).

Create the database with upstream’s **`evernote-backup init-db`** / **`sync`** (their README covers OAuth and Yinxiang). Then point **`--db`** at that file (often `en_backup.db`).

**Implementation note:** Node’s built-in **`node:sqlite`** is used in **read-only** mode. As of Node 24 it may log an experimental-feature warning; the reader only runs plain SQL (`guid`, `title` from the `notes` table).

## Known limitations

- **Correlation keys:** `correlate` prefers vault frontmatter **`evernote-guid:`** (lowercase UUID scalar) when present, then falls back to **normalized title** (filename stem or frontmatter `title:`). Title-only matching mirrors **Obsidian Importer `sanitizeFileName`** (slashes, illegal filename chars, control chars, and **`badLinkRe`** `[ ] # | ^`, then NFC, lowercase, and whitespace collapse) so Evernote DB titles align with importer filename stems when GUIDs are missing. See the EDD Phase 2 notes for details. When Importer or the host OS **shortens a filename**, correlate may match a vault stem that is a **unique strict prefix** of the snapshot normalized title (minimum stem length 12; two qualifying files → failure). Successful prefix matches are listed in **`link-map.json`** as `truncatedTitleMatches` and written to **`correlate-report.json`** for audit. Ambiguous duplicate GUIDs in the vault, GUID/title disagreements, duplicate Evernote titles without resolvable GUIDs, or **truncated-prefix collisions** fail with a JSON report (no silent wrong links). Use **`byGuid` overrides** for intentional remapping or stems that still do not match.
- **Correlate failures:** On exit **1**, stderr shows a short hint, next steps, and (in a TTY) a line pointing at the Markdown report. Use **`./out/correlate-report.md`** for tabular unmatched notes, title collisions, and a checklist; use **`./out/correlate-report.json`** for scripts and **`--verbose`** (or **`--report-stdout`**) if you need the full JSON on stderr. Override the JSON path with **`--report <path>`** (Markdown path: replace a `.json` extension with `.md`, or append `.md` otherwise, unless **`--no-report-md`**). **`run`** accepts the same flags.
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
