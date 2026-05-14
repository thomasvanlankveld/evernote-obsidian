# EDD: Evernote → Obsidian link repair

**Status:** Draft  
**Last updated:** 2026-05-14 (Phase 4: link extraction; `links` CLI)

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
- [x] **Correlation key (v1):** normalized **title** only; optional later: frontmatter such as `evernote-guid:` if a preprocessor adds it.
- [x] **Duplicate titles:** **fail** with a report listing collisions — **no** silent first-wins (overrides land in a later phase).

**Phase 2 implementation notes**

- **Frontmatter `title:` (v1):** line-based subset only (first `title:` scalar line, optional simple quotes), not full YAML — no block scalars, aliases, or other keys.
- **Empty normalized title** (e.g. filename stem trims to nothing): **invalid**; index fails with the same collision-shaped report shape (`normalizedTitle: ""`).
- **Symlinks:** **symlinked directories are not recursed** (avoids cycles); a regular file that is a symlink is still indexed. Layouts that rely on symlinked folders for notes are unsupported in v1.
- **CLI:** `--vault` requires a path when the flag is present; other I/O errors surface as **exit 2** and a short message (not only missing root).
- **Tooling noise:** only `.git` and `node_modules` are skipped by name; e.g. **`.obsidian`** may contribute Markdown — add an ignore list later if that hurts real vaults.

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
- [x] Capture **display text / alias** when the import left one (e.g. existing `[[alias]]`-style segments or markdown link text) so rewrites can use **`[[path|alias]]`** without changing what readers see.
- [x] Emit **report only**: file, location, raw URL, parsed id, alias when possible.

**Deliverable:** `BrokenLink[]` JSON or stdout; no writes. ✅

### Phase 5 — Correlation

- Join Evernote records to vault index by **normalized title**, plus **user override file** for collisions and renames.
- Emit **link map**: **GUID → vault-relative path** to the target note file (all extracted note URLs normalize to a GUID). Rewrites combine this path with the **alias** from extraction into **`[[path|alias]]`**.

**Deliverable:** `link-map.json` (default gitignored unless sanitized).

### Phase 6 — Rewrite

- CLI: **`--vault`** (default `./data`), **`--map`**, **`--dry-run`**, **`--out-dir`** vs **`--in-place`** (with optional backup copy).
- Replace Evernote **note** URLs with **`[[path|alias]]`** (vault-relative path + captured alias); preserve surrounding Markdown where possible.

### Phase 7 — Hardening

- Golden-file tests on miniature vaults.
- Encoding / Unicode / punctuation in titles; percent-encoding in URLs.
- README: commands, security reminders.

## 6. Risks

| Risk                                       | Mitigation                                                           |
| ------------------------------------------ | -------------------------------------------------------------------- |
| Title mismatch after Importer sanitization | Normalization rules + override file; verbose unmatched report        |
| Duplicate titles                           | Fail with report; overrides required until unambiguous               |
| Stale backup vs Obsidian import                    | Re-run `evernote-backup sync` before `snapshot`; document refresh cadence |
| evernote-backup DB format drift                    | Fail fast on missing `notes` table; pin upstream schema in tests / README     |
| Wrong rewrites                             | Dry-run default; golden tests; backup before in-place                |

## 7. References

- [Import from Evernote – Obsidian Help](https://obsidian.md/help/import/evernote)
- [evernote-backup (SQLite backup tool)](https://github.com/vzhd1701/evernote-backup)
- [obsidian-importer#306](https://github.com/obsidianmd/obsidian-importer/issues/306)
- Repo README: `/README.md`
- EDDs for this repo: `/docs/edds/` (filenames: `YYYY-MM-DD-<slug>.edd.md`)
