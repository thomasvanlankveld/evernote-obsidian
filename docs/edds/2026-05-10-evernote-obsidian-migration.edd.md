# EDD: Evernote → Obsidian link repair

**Status:** Draft  
**Last updated:** 2026-05-17 (vault `evernote-guid:` frontmatter; correlate GUID-first matching)

## EDD phase completion (before you push / open a PR)

When implementation for a phase is done on your branch: run **`npm test`** (and **`npm run build`** / **`npm run lint`** if you touched code), then in **this EDD** tick that phase’s checkbox(es) and bump **Last updated** if the plan changed. Keep EDD edits in the **same branch** as the code so reviewers see intent and execution together. Agents: canonical checklist in [AGENTS.md](./AGENTS.md) in this folder.

## 1. Context

Exporting Evernote to `.enex` and importing with Obsidian’s Importer preserves content but often leaves **internal links** as **`evernote://…`** URLs or **`https://www.evernote.com/shard/…`** web links. Importers lack stable crosswalk from those URLs to the Markdown files actually created ([obsidian-importer#306](https://github.com/obsidianmd/obsidian-importer/issues/306)).

This project adds automation: **correlate Evernote note identity → vault file**, then **rewrite links** in bulk.

## 2. Goals

- Build a **repeatable CLI-oriented pipeline** (Node ≥24, per repo).
- Support **dry-run** and **safe defaults** (no silent data loss).
- Keep **secrets and personal notes out of git** (backup databases, `.env`, vault under `data/` or configurable path).

## 3. Non-goals (initially)

- Replacing Obsidian Importer or parsing full ENML for a full re-import.
- Perfect resolution of every edge case without human **override** input.
- GUI or Obsidian plugin (CLI / scripts only unless explicitly expanded later).

## 4. High-level architecture

```text
[Vault .md files] ──► scan ──► broken evernote links
                                    │
[Evernote metadata] ──► index ──────┼──► correlate ──► link map
(gitignored JSON snapshot)          │                      │
                                    └──────────────────────┼──► rewrite (dry-run / out-dir / in-place+backup)
```

## 5. Implementation phases

### Phase 1 — Scaffold

- [x] **TypeScript**, compile to **`dist/`**, **Node ESM**; `src/`, CLI entry (`package.json` `bin` or `node dist/cli.js`); optional `tsx` for local dev.
- [x] Scripts: `build`, `lint`, `test`, `dev`.
- [x] `.env.example` for optional local defaults; align `.gitignore` with build dirs (`/dist/`, `/out/`, reports if written under repo).

### Phase 2 — Vault index (read-only)

- [x] Walk configurable vault root; **CLI default** is **`./data`** (cwd-relative), overridable with **`--vault`** (`evernote-obsidian index`).
- [x] Index Markdown files: path, **normalized title** from filename and optional YAML frontmatter (`title:`).
- [x] **Correlation key (v1):** normalized **title**; **v1.1:** optional frontmatter **`evernote-guid:`** (line-based scalar, lowercase in index).
- [x] **Duplicate titles:** **fail** with a report listing collisions — **no** silent first-wins.
- [x] **Duplicate `evernote-guid:` values** in the vault: **fail** with `guidCollisions` (same no-silent-wins rule).

**Phase 2 implementation notes**

- **Frontmatter `title:` / `evernote-guid:` (v1):** line-based subset only (first scalar line per key, optional simple quotes), not full YAML — no block scalars, aliases, or other keys. GUIDs are normalized to lowercase in the index.
- **Empty normalized title** (e.g. filename stem trims to nothing): **invalid**; index fails with the same collision-shaped report shape (`normalizedTitle: ""`).
- **Symlinks:** **symlinked directories are not recursed** (avoids cycles); a regular file that is a symlink is still indexed. Layouts that rely on symlinked folders for notes are unsupported in v1.
- **CLI:** `--vault` requires a path when the flag is present; other I/O errors surface as **exit 2** and a short message (not only missing root).
- **Skipped directories (by name):** `.git`, `node_modules`, `.obsidian`, `.trash` — not recursed; symlinked directories still not followed.

**Deliverable:** `buildVaultIndex(root)` + fixture tests. ✅

### Phase 3 — Evernote metadata (evernote-backup SQLite)

Produce a **gitignored JSON snapshot** of note metadata (**GUID**, **title**, plus a placeholder **`updated`**) from a local **[evernote-backup](https://github.com/vzhd1701/evernote-backup)** SQLite database so later phases can correlate vault files to Evernote identities. **Phase 4+ numbering stays unchanged** (link extraction remains Phase 4).

- [x] **`snapshot --db <path>`** reads **`notes.guid`** and **`notes.title`** (read-only `node:sqlite`); writes the same envelope shape as before. **`host`** in the JSON is the literal **`evernote-backup`** (metadata origin label, not an API hostname).
- [x] **Trash** (`is_active = 0`) excluded; **`is_active` NULL** (in-progress sync rows) treated as active.
- [x] **`updated`:** Evernote’s real update time is only inside Python-pickled `raw_note` in upstream’s schema; this CLI does not unpickle. Every **`NoteRecord.updated`** is the sentinel **`1970-01-01T00:00:00.000Z`** (documented in README and types). Title-only correlation (Phase 5) is unaffected.
- [x] Optional **`--max-notes`** caps output volume; stdout summary includes **`sourceRowCount`** and **`truncated`** when the cap cuts rows.

**Deliverable:** `NoteRecord[]` + fixture tests + `snapshot` CLI. ✅

**Phase 3 implementation notes**

- **CLI:** `evernote-obsidian snapshot --db <path> [--out <path>] [--max-notes <n>]` — default **`./out/evernote-notes.json`**. No Evernote API credentials in this repo.
- **On-disk shape:** `{ version: 1, writtenAt, host, notes: NoteRecord[] }` unchanged. **`host`** is **`evernote-backup`** for this source.
- **Upstream schema:** expects `notes` table per evernote-backup’s `DB_SCHEMA` (`guid`, `title`, `is_active`, …). If the file is not that format, fail fast.

### Phase 4 — Link extraction

- [x] Per `.md`, find **note** URLs: **`evernote://…`** and **`https://www.evernote.com/shard/…`**; normalize each to **GUID** for the link map. Other **`*.evernote.com`** hosts (e.g. blog): **do not rewrite** — report or skip per CLI.
- [x] **Skip code spans:** fenced (`` ``` `` / `~~~`) and inline (`` `…` ``) regions are excluded from discovery so `rewrite --in-place` does not turn documentation literals into wikilinks; `links` uses the same rules.
- [x] Capture **display text / alias** when the import left one (e.g. existing `[[alias]]`-style segments or markdown link text) so rewrites can use **`[[path|alias]]`** without changing what readers see.
- [x] Emit **report only**: file, location, raw URL, parsed id, alias when possible.

**Deliverable:** `BrokenLink[]` JSON or stdout; no writes. ✅

### Phase 5 — Correlation

- [x] Join Evernote records to vault index by **`evernote-guid:` frontmatter when present**, else **normalized title**, plus **user override file** for collisions and renames.
- [x] Emit **link map**: **GUID → vault-relative path** to the target note file (all extracted note URLs normalize to a GUID). Rewrites combine this path with the **alias** from extraction into **`[[path|alias]]`**.

**Deliverable:** `link-map.json` (default gitignored unless sanitized). ✅

**Phase 5 implementation notes**

- **CLI:** `evernote-obsidian correlate --snapshot <path> [--vault <path>] [--overrides <path>] [--out <path>]` — default **`./out/link-map.json`**, vault default **`./data`**.
- **GUID map keys:** Evernote note GUIDs in snapshots, `guidToPath` / `link-map.json`, and override `byGuid` keys are always stored **lowercase** (normalized at ingestion). Link extraction lowercases GUIDs parsed from URLs before lookup; this keeps in-memory and on-disk maps aligned.
- **Overrides JSON:** `{ "version": 1, "byGuid": { "<guid>": "<vault-relative-path>" } }` — paths must match an indexed `.md` path (POSIX separators). **Evernote duplicate titles** (multiple GUIDs sharing the same normalized title) require **`byGuid` for every GUID** in that group.
- **Failure cases (exit 1):** vault index title/`evernote-guid` collisions (same as `index`); **unmatched** snapshot rows; **invalid** override paths; **duplicate target paths** (two GUIDs resolved to the same vault file); **Evernote title collisions** without resolvable GUIDs/overrides; **`guidTitleMismatches`** when frontmatter GUID and title-based resolution disagree. By default stderr shows a one-line hint plus compact counts; full arrays are written to **`./out/correlate-report.json`** (**`--report`**). **`--verbose`** / **`--report-stdout`** also print the full JSON on stderr (legacy scripting).

### Phase 6 — Rewrite

- [x] CLI: **`--vault`** (default `./data`), **`--map`**, **`--dry-run`**, **`--out-dir`** vs **`--in-place`** (with optional **`--backup`**).
- [x] Replace Evernote **note** URLs with **`[[path|alias]]`** (vault-relative path + captured alias); preserve surrounding Markdown where possible.
- [x] **`--in-place`:** same-directory temp file + **`fsync`** + **`rename`** (atomic replace on typical local disks; not guaranteed on all network/sync mounts).

### Phase 7 — Hardening

- [x] Golden-file tests on miniature vaults.
- [x] Encoding / Unicode / punctuation in titles; percent-encoding in URLs.
- [x] README: commands, security reminders.

## 6. Risks

| Risk                                       | Mitigation                                                           |
| ------------------------------------------ | -------------------------------------------------------------------- |
| Title mismatch after Importer sanitization | Normalization rules + override file; full unmatched detail in correlate report file (`--report`; `--verbose` for stderr) |
| Duplicate titles                           | Fail with report; overrides required until unambiguous               |
| Stale backup vs Obsidian import                    | Re-run `evernote-backup sync` before `snapshot`; document refresh cadence |
| evernote-backup DB format drift                    | Fail fast on missing `notes` table; pin upstream schema in tests / README     |
| Wrong rewrites                             | Dry-run default; golden tests; backup before in-place                |
| Torn in-place write on crash               | Temp file + atomic rename; backup for logical rollback               |

## 7. References

- [Import from Evernote – Obsidian Help](https://obsidian.md/help/import/evernote)
- [evernote-backup (SQLite backup tool)](https://github.com/vzhd1701/evernote-backup)
- [obsidian-importer#306](https://github.com/obsidianmd/obsidian-importer/issues/306)
- Repo README: `/README.md`
- EDDs for this repo: `/docs/edds/` (filenames: `YYYY-MM-DD-<slug>.edd.md`)
