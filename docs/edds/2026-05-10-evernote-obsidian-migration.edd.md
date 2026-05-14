# EDD: Evernote → Obsidian link repair

**Status:** Draft  
**Last updated:** 2026-05-14 (Phase 3b OAuth shipped on branch)

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

Split so **3a** can merge as a complete vertical slice (developer token), while **3b** adds Evernote’s **preferred production auth** without renumbering the pipeline.

#### Phase 3a — Developer token auth + snapshot pipeline

- [x] Authenticate with **`EVERNOTE_DEVELOPER_TOKEN`**, list/fetch notes (GUID, title, updated), persist **gitignored JSON snapshot** for idempotent reruns and rate limits.

**Deliverable:** `NoteRecord[]` + redacted fixture tests + `snapshot` CLI for accounts where Evernote still issues a developer token (e.g. sandbox or legacy access). ✅

**Phase 3a implementation notes**

- **Auth:** `EVERNOTE_DEVELOPER_TOKEN` (required for `snapshot` when OAuth is not used); optional `EVERNOTE_HOST` (`www.evernote.com`, `sandbox.evernote.com`, or `app.yinxiang.com` / Yinxiang).
- **Transport:** Official npm package `evernote` (Thrift NoteStore); paginated `findNotesMetadata` (default page size 250, optional `--sleep-ms` between pages).
- **CLI:** `evernote-obsidian snapshot [--out <path>]` — default snapshot path **`./out/evernote-notes.json`** (repo already gitignores `/out/`). Loads **`.env` from cwd** when present without overriding already-set environment variables.
- **On-disk shape:** `{ version: 1, writtenAt, host, notes: NoteRecord[] }` where each `NoteRecord` is `{ guid, title, updated }` and `updated` is ISO 8601 UTC from Evernote’s `updated` ms value. **Snapshot fields may grow** later (e.g. `notebookGuid`) if correlation needs more disambiguation than title + overrides.
- **Safety:** Missing or non-finite `updated` for a note with a GUID **fails the fetch** (no silent `1970-01-01` rows). CLI accepts **`--max-notes`** to cap volume; stdout includes **`totalNotesFromApi`** when the API returns it.

#### Phase 3b — OAuth (production path when developer tokens are unavailable)

Evernote’s UI and docs steer API access toward **OAuth**; self-serve developer tokens are **restricted to specific cases**, which blocks **3a** alone for many production accounts. **3b** adds OAuth without changing the meaning of later phases.

- [x] Evernote **API key / consumer** configuration (client id and secret), documented in **`.env.example`** and README; secrets remain **gitignored** or env-only.
- [x] **Authorization flow** appropriate for a **personal CLI** (one-time browser login, local `http://127.0.0.1:8765/callback` redirect by default; override with **`EVERNOTE_OAUTH_CALLBACK_URL`** when the registered callback differs).
- [x] Persist **OAuth 1 access token** (Evernote’s classic API does **not** expose OAuth-2-style refresh tokens) plus optional **`edam_noteStoreUrl`** / **`edam_expires`** in a **gitignored** path (`./out/evernote-oauth.json` by default); **`login`** again before expiry.
- [x] Pass the resulting **user access credential** into the **same** Thrift NoteStore / `findNotesMetadata` path as **3a** (`Client({ token })`, optional `getNoteStore(edam_noteStoreUrl)`).
- [x] **`snapshot`** supports **OAuth path** via saved token file; **`login`** performs browser OAuth; **developer token remains supported** where it still works (e.g. sandbox).
- [x] Tests: unit coverage for credential resolution, OAuth token expiry checks, callback URL validation, and CLI wiring; no real credentials in repo.

**Deliverable:** `snapshot` (or documented two-step auth + snapshot) works **end-to-end for typical production Evernote users** who cannot create a developer token. ✅

**Phase 3b implementation notes**

- **Non-goal:** multi-tenant SaaS onboarding; a single-user migration tool is enough.
- **Non-goal:** changing the **3a snapshot JSON shape** or pagination semantics unless OAuth or API policy forces it.
- **Policy:** If Evernote changes OAuth or deprecates the classic API, this phase may need revision — same risk as **3a** with the maintenance-frozen `evernote` SDK (see README).
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
| Developer token unavailable (Evernote policy) | **Phase 3b OAuth**; optional future non-API metadata sources if API access is impossible |
| Wrong rewrites                             | Dry-run default; golden tests; backup before in-place                |

## 7. References

- [Import from Evernote – Obsidian Help](https://obsidian.md/help/import/evernote)
- [obsidian-importer#306](https://github.com/obsidianmd/obsidian-importer/issues/306)
- Repo README: `/README.md`
- EDDs for this repo: `/docs/edds/` (filenames: `YYYY-MM-DD-<slug>.edd.md`)
