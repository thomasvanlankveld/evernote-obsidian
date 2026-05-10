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

### Phase 0 — Decisions

Resolve items in **§8 Open questions & decisions** before large implementation.

### Phase 1 — Scaffold

- TypeScript (or ESM TypeScript via `tsx`), `src/`, CLI entry (`package.json` `bin` or `node dist/cli.js`).
- Scripts: `build`, `lint`, `test`, `dev`.
- `.env.example` for credentials; align `.gitignore` with build dirs (`/dist/`, `/out/`, reports if written under repo).

### Phase 2 — Vault index (read-only)

- Walk configurable vault root (default: `data/`).
- Index Markdown files: path, **normalized title** from filename and optional YAML frontmatter.
- Policy for **duplicate titles** (see §8).

**Deliverable:** `buildVaultIndex(root)` + fixture tests.

### Phase 3 — Evernote metadata

- **Option A — API:** authenticate, list/fetch notes (GUID, title, updated), persist **gitignored JSON snapshot** for idempotent reruns and rate-limit friendliness.
- **Option B — Offline:** parse `.enex` / exports for GUIDs and link patterns (no network).

**Deliverable:** `NoteRecord[]` + redacted fixture tests.

### Phase 4 — Link extraction

- Per `.md`, find `evernote:///…` and other agreed patterns (e.g. Evernote web URLs if needed).
- Emit **report only**: file, location, raw URL, parsed id when possible.

**Deliverable:** `BrokenLink[]` JSON or stdout; no writes.

### Phase 5 — Correlation

- Join Evernote records to vault index: primary **title match** (normalized), plus **user override file** (CSV/JSON) for collisions and renames.
- Emit **link map**: `guid | url-pattern → vault-relative path` and optional **target wikilink** string.

**Deliverable:** `link-map.json` (default gitignored unless sanitized).

### Phase 6 — Rewrite

- CLI: `--vault`, `--map`, `--dry-run`, `--out-dir` vs `--in-place` (with optional backup copy).
- Replace targets per §8 link style; preserve surrounding Markdown where possible.

### Phase 7 — Hardening

- Golden-file tests on miniature vaults.
- Encoding / Unicode / punctuation in titles; percent-encoding in URLs.
- README: env vars, command order, security reminders.

## 6. Risks

| Risk | Mitigation |
|------|------------|
| Title mismatch after Importer sanitization | Normalization rules + override file; verbose unmatched report |
| Duplicate titles | Explicit policy (fail, first-wins, or require disambiguation) |
| API limits / offline-only constraint | Snapshot cache; document Option B (.enex) path |
| Wrong rewrites | Dry-run default; golden tests; backup before in-place |

## 7. References

- [Import from Evernote – Obsidian Help](https://obsidian.md/help/import/evernote)
- [obsidian-importer#306](https://github.com/obsidianmd/obsidian-importer/issues/306)
- Repo README: `/README.md`
- EDDs for this repo: `/edds/` (filenames: `YYYY-MM-DD-<slug>.edd.md`)

## 8. Open questions & decisions

Track status: **TBD** | **Proposed** | **Accepted**

| ID | Question | Status | Notes / proposal |
|----|----------|--------|------------------|
| Q1 | **Evernote source:** API vs `.enex`-only for v1? | Proposed | **API first** for stable GUIDs and scale; add `.enex` parser when someone cannot use API. |
| Q2 | **Primary vault correlation key:** title only vs title + hash vs frontmatter? | Proposed | **Title (+ normalization)** for v1; optional frontmatter key later (e.g. `evernote-guid:`) if user adds it via preprocessor. |
| Q3 | **Duplicate titles** in vault or Evernote | Proposed | **Fail with report** listing collisions; require override rows for each duplicate until map is unambiguous. Safer than silent first-wins. |
| Q4 | **Output link style** | Proposed | **`[[Note Title]]`** for v1 (match Obsidian default importer titles); optional flag for `[[path|alias]]` or Markdown `[]()` later. |
| Q5 | **URL patterns to rewrite** | Proposed | Minimum: `evernote:///…`; extend after sampling real vault (web `evernote.com` links, etc.). |
| Q6 | **Default vault path in CLI** | Proposed | **`./data`** relative to cwd; override with `--vault`. |
| Q7 | **Language / runtime** | Proposed | **TypeScript**, compile to `dist/`, Node ESM. |
| Q8 | **`.nvmrc`** | TBD | README references Node 24; add `24` at repo root when scaffold lands. |

### 8.1 Resolved when accepted

When you accept or change a row above, update **Status** to **Accepted** and move any superseded idea to a short **Decision log** subsection (date + one line).

---

## Decision log

_(Append accepted choices here as you lock them.)_
