# EDD: Evernote → Obsidian link repair

**Status:** Draft  
**Last updated:** 2026-05-10

## 1. Context

Exporting Evernote to `.enex` and importing with Obsidian’s Importer preserves content but often leaves **internal links** as `evernote:///…` URLs. Importers lack stable crosswalk from those URLs to the Markdown files actually created ([obsidian-importer#306](https://github.com/obsidianmd/obsidian-importer/issues/306)).

This project adds automation: **correlate Evernote note identity → vault file**, then **rewrite links** in bulk.

## 2. Goals

- Build a **repeatable CLI-oriented pipeline** (Node ≥24, per repo).
- Support **dry-run** and **safe defaults** (no silent data loss).
- Keep **secrets and personal notes out of git** (tokens, `.env`, vault under `data/` or configurable path).

## 3. Non-goals (initially)

- Replacing Obsidian Importer or parsing full ENML for a full re-import.
- Perfect resolution of every edge case without human **override** input.
- GUI or Obsidian plugin (CLI / scripts only unless explicitly expanded later).

## 4. High-level architecture

```text
[Vault .md files] ──► scan ──► broken evernote links
                                    │
[Evernote metadata] ──► index ──────┼──► correlate ──► link map
(API snapshot or .enex)             │                      │
                                    └──────────────────────┼──► rewrite (dry-run / out-dir / in-place+backup)
```

## 5. Implementation phases

### Phase 1 — Scaffold

- **TypeScript**, compile to **`dist/`**, **Node ESM**; `src/`, CLI entry (`package.json` `bin` or `node dist/cli.js`); optional `tsx` for local dev.
- Scripts: `build`, `lint`, `test`, `dev`.
- `.env.example` for credentials; align `.gitignore` with build dirs (`/dist/`, `/out/`, reports if written under repo).

### Phase 2 — Vault index (read-only)

- Walk configurable vault root; **CLI default** is **`./data`** (cwd-relative), overridable with **`--vault`**.
- Index Markdown files: path, **normalized title** from filename and optional YAML frontmatter.
- **Correlation key (v1):** normalized **title** only; optional later: frontmatter such as `evernote-guid:` if a preprocessor adds it.
- **Duplicate titles:** **fail** with a report listing collisions; user supplies **override** rows (CSV/JSON) until the map is unambiguous — **no** silent first-wins.

**Deliverable:** `buildVaultIndex(root)` + fixture tests.

### Phase 3 — Evernote metadata

- **v1 — API first:** authenticate, list/fetch notes (GUID, title, updated), persist **gitignored JSON snapshot** for idempotent reruns and rate limits.
- **Follow-on:** parse **`.enex` / offline** exports for GUIDs and link patterns when the API is not an option.

**Deliverable:** `NoteRecord[]` + redacted fixture tests.

### Phase 4 — Link extraction

- Per `.md`, find **note** URLs: **`evernote://…`** and **`https://www.evernote.com/shard/…`**; normalize each to **GUID** for the link map. Other **`*.evernote.com`** hosts (e.g. blog): **do not rewrite** — report or skip per CLI.
- Capture **display text / alias** when the import left one (e.g. existing `[[alias]]`-style segments or markdown link text) so rewrites can use **`[[path|alias]]`** without changing what readers see.
- Emit **report only**: file, location, raw URL, parsed id, alias when possible.

**Deliverable:** `BrokenLink[]` JSON or stdout; no writes.

### Phase 5 — Correlation

- Join Evernote records to vault index by **normalized title**, plus **user override file** for collisions and renames.
- Emit **link map**: `guid | url-pattern → vault-relative path` (target note file). Rewrites combine this path with the **alias** from extraction into **`[[path|alias]]`**.

**Deliverable:** `link-map.json` (default gitignored unless sanitized).

### Phase 6 — Rewrite

- CLI: **`--vault`** (default `./data`), **`--map`**, **`--dry-run`**, **`--out-dir`** vs **`--in-place`** (with optional backup copy).
- Replace Evernote **note** URLs with **`[[path|alias]]`** (vault-relative path + captured alias); preserve surrounding Markdown where possible.

### Phase 7 — Hardening

- Golden-file tests on miniature vaults.
- Encoding / Unicode / punctuation in titles; percent-encoding in URLs.
- README: env vars, command order, security reminders.

## 6. Risks

| Risk | Mitigation |
|------|------------|
| Title mismatch after Importer sanitization | Normalization rules + override file; verbose unmatched report |
| Duplicate titles | Fail with report; overrides required until unambiguous |
| API limits / offline-only constraint | Snapshot cache; document Option B (.enex) path |
| Wrong rewrites | Dry-run default; golden tests; backup before in-place |

## 7. References

- [Import from Evernote – Obsidian Help](https://obsidian.md/help/import/evernote)
- [obsidian-importer#306](https://github.com/obsidianmd/obsidian-importer/issues/306)
- Repo README: `/README.md`
- EDDs for this repo: `/edds/` (filenames: `YYYY-MM-DD-<slug>.edd.md`)
