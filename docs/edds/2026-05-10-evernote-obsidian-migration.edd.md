# EDD: Evernote → Obsidian link repair

**Status:** Draft  
**Last updated:** 2026-05-14 (Phase 3 OAuth-only snapshot auth)

## EDD phase completion (before you push / open a PR)

When implementation for a phase is done on your branch: run **`npm test`** (and **`npm run build`** / **`npm run lint`** if you touched code), then in **this EDD** tick that phase’s checkbox(es) and bump **Last updated** if the plan changed. Keep EDD edits in the **same branch** as the code so reviewers see intent and execution together. Agents: canonical checklist in [AGENTS.md](./AGENTS.md) in this folder.

## 1. Context

Exporting Evernote to `.enex` and importing with Obsidian’s Importer preserves content but often leaves **internal links** as **`evernote://…`** URLs or **`https://www.evernote.com/shard/…`** web links. Importers lack stable crosswalk from those URLs to the Markdown files actually created ([obsidian-importer#306](https://github.com/obsidianmd/obsidian-importer/issues/306)).

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
(gitignored API snapshot)           │                      │
                                    └──────────────────────┼──► rewrite (dry-run / out-dir / in-place+backup)
```

## 5. Implementation phases

### Phase 1 — Scaffold

- [x] **TypeScript**, compile to **`dist/`**, **Node ESM**; `src/`, CLI entry (`package.json` `bin` or `node dist/cli.js`); optional `tsx` for local dev.
- [x] Scripts: `build`, `lint`, `test`, `dev`.
- [x] `.env.example` for credentials; align `.gitignore` with build dirs (`/dist/`, `/out/`, reports if written under repo).

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

### Phase 3 — Evernote metadata (API)

Produce a **gitignored JSON snapshot** of note metadata (GUID, title, updated) from Evernote’s API so later phases can correlate vault files to Evernote identities. **Phase 4+ numbering stays unchanged** (link extraction remains Phase 4).

Implementation originally landed in two slices (**3a** then **3b**); the CLI is now **OAuth-only** (Evernote consumer key + secret, browser `login`, saved access token). **Personal developer tokens are not supported.**

- [x] **OAuth 1** `login` and persisted token JSON under gitignored **`out/`** (default `./out/evernote-oauth.json`); re-run **`login`** before **`edam_expires`**.
- [x] **`snapshot`** reads that token (optional **`--oauth-token-path`** / **`EVERNOTE_OAUTH_TOKEN_PATH`**) and calls Thrift **`findNotesMetadata`** via the official **`evernote`** npm package.
- [x] Consumer key + secret documented in **`.env.example`** and README; secrets env-only or gitignored files.
- [x] Tests: credential resolution, token expiry, callback URL validation, CLI wiring; no real credentials in repo.

**Deliverable:** `NoteRecord[]` + redacted fixture tests + **`login`** + **`snapshot`** end-to-end for typical Evernote accounts. ✅

**Phase 3 implementation notes**

- **Auth:** **`EVERNOTE_CONSUMER_KEY`** / **`EVERNOTE_CONSUMER_SECRET`** for `login`; optional **`EVERNOTE_HOST`** (`www.evernote.com`, `sandbox.evernote.com`, or `app.yinxiang.com` / Yinxiang). Default OAuth callback **`http://127.0.0.1:8765/callback`** (override with **`EVERNOTE_OAUTH_CALLBACK_URL`** when your API key registration differs).
- **Transport:** Official npm package `evernote` (Thrift NoteStore); paginated `findNotesMetadata` (default page size 250, optional `--sleep-ms` between pages).
- **CLI:** `evernote-obsidian snapshot [--out <path>] [--oauth-token-path <path>]` — default snapshot **`./out/evernote-notes.json`**. Loads **`.env` from cwd** when present without overriding already-set environment variables.
- **On-disk snapshot shape:** `{ version: 1, writtenAt, host, notes: NoteRecord[] }` where each `NoteRecord` is `{ guid, title, updated }` and `updated` is ISO 8601 UTC from Evernote’s `updated` ms value. **Snapshot fields may grow** later (e.g. `notebookGuid`) if correlation needs more disambiguation than title + overrides.
- **Safety:** Missing or non-finite `updated` for a note with a GUID **fails the fetch** (no silent `1970-01-01` rows). CLI accepts **`--max-notes`** to cap volume; stdout includes **`totalNotesFromApi`** when the API returns it.
- **Non-goal:** multi-tenant SaaS onboarding; a single-user migration tool is enough.
- **Policy:** If Evernote changes OAuth or deprecates the classic API, this phase may need revision — same maintenance risk as the frozen **`evernote`** SDK (see README).
- **OAuth 1 detail:** Evernote returns a **long-lived access token** and **`edam_expires`** (not an OAuth 2 refresh token). The CLI persists access material to disk and instructs users to re-run **`login`** when expired.

### Phase 4 — Link extraction

- Per `.md`, find **note** URLs: **`evernote://…`** and **`https://www.evernote.com/shard/…`**; normalize each to **GUID** for the link map. Other **`*.evernote.com`** hosts (e.g. blog): **do not rewrite** — report or skip per CLI.
- Capture **display text / alias** when the import left one (e.g. existing `[[alias]]`-style segments or markdown link text) so rewrites can use **`[[path|alias]]`** without changing what readers see.
- Emit **report only**: file, location, raw URL, parsed id, alias when possible.

**Deliverable:** `BrokenLink[]` JSON or stdout; no writes.

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
- README: env vars, command order, security reminders.

## 6. Risks

| Risk                                       | Mitigation                                                           |
| ------------------------------------------ | -------------------------------------------------------------------- |
| Title mismatch after Importer sanitization | Normalization rules + override file; verbose unmatched report        |
| Duplicate titles                           | Fail with report; overrides required until unambiguous               |
| API limits / outages                       | Snapshot cache; retry/backoff; document when to refresh the snapshot |
| Evernote API / OAuth policy shifts           | Re-run **`login`**; document breakage; optional future non-API metadata sources if API access is impossible |
| Wrong rewrites                             | Dry-run default; golden tests; backup before in-place                |

## 7. References

- [Import from Evernote – Obsidian Help](https://obsidian.md/help/import/evernote)
- [obsidian-importer#306](https://github.com/obsidianmd/obsidian-importer/issues/306)
- Repo README: `/README.md`
- EDDs for this repo: `/docs/edds/` (filenames: `YYYY-MM-DD-<slug>.edd.md`)
