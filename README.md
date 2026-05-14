# Evernote → Obsidian migration

Personal tooling to move notes from Evernote into Obsidian when the stock import path leaves **internal links broken**.

## Why this exists

The usual flow is: export `.enex` from Evernote, import with Obsidian’s [Importer](https://obsidian.md/help/import/evernote). That works for content, but note-to-note links often stay as `evernote:///…` URLs because the export does not carry enough stable identifiers for importers to rewrite them—see [obsidian-importer#306](https://github.com/obsidianmd/obsidian-importer/issues/306). For a large vault with many internal links, fixing that by hand is not practical.

A complementary approach is to use **Evernote’s API** (or other metadata sources) to build a mapping from those URLs or note identities to the Markdown files Obsidian actually created, then rewrite links in bulk. This repo is a place to grow that kind of automation.

## Prerequisites

- [nvm](https://github.com/nvm-sh/nvm) (or another Node version manager you prefer)
- Node **24** (see `.nvmrc`)

## Commands (implemented so far)

After `npm install` and `npm run build`, the **`evernote-obsidian`** CLI is available (the npm package name matches the tool; see `package.json` `bin`).

- **`evernote-obsidian index [--vault <path>]`** — Walk the vault (default `./data`) and report whether normalized titles are unique enough for correlation.
- **`evernote-obsidian login [--token-path <path>] [--timeout-ms <n>] [--no-open]`** — Run Evernote **OAuth 1** in the browser and save an access token JSON file (default **`./out/evernote-oauth.json`**, gitignored with the rest of `out/`). Register **`http://127.0.0.1:8765/callback`** (or your override in **`EVERNOTE_OAUTH_CALLBACK_URL`**) on your Evernote API key so the redirect matches the local listener.
- **`evernote-obsidian snapshot [--out <path>] [--oauth-token-path <path>] [--page-size <n>] [--sleep-ms <n>] [--max-notes <n>]`** — Call Evernote’s API and write a JSON snapshot of note metadata (GUID, title, last updated). Default output: `./out/evernote-notes.json` (the `out/` directory is gitignored). Use **`--max-notes`** to cap how many newest notes you pull (handy when iterating against production).

Copy `.env.example` to `.env`. For **`snapshot`**, set **`EVERNOTE_DEVELOPER_TOKEN`** *or* run **`login`** first so an OAuth token file exists. Optional **`EVERNOTE_HOST`** selects production (`www.evernote.com`), sandbox, or Yinxiang (`app.yinxiang.com`). Evernote’s classic API uses **OAuth 1** long-lived access tokens (with `edam_expires`); there is **no refresh token** — run **`login`** again before expiry if `snapshot` reports the token expired.

**`.env` loading** (for `snapshot`) is a small v1 parser: `KEY=value` lines, optional `#` comments, optional single-line quotes. It is **not** full dotenv (e.g. unquoted `#` inside values, `export KEY=`, and multiline values are not supported).

For **very large accounts**, prefer running `snapshot` during a **quiet period**: paging is ordered by `updated` descending; concurrent edits can in theory shift results between pages (the CLI may warn if Evernote’s `totalNotes` does not match the written row count).

## Evernote snapshot: limits

These boundaries are intentional for an early, personal migration tool; they are not a full Evernote client.

- **Authentication:** **`EVERNOTE_DEVELOPER_TOKEN`** when available, or **OAuth 1** via **`evernote-obsidian login`** (consumer key + secret) and a gitignored token file under **`out/`** by default.
- **Account scope:** Metadata is read from the **primary personal NoteStore** returned for that token. **Evernote Business** and other secondary stores are not separately enumerated in this phase.
- **What is fetched:** **Metadata only** (GUID, title, `updated` timestamp)—not full note bodies or resources. Pagination uses Evernote’s `findNotesMetadata`; use **`--sleep-ms`** if you hit rate limits.
- **SDK:** The npm package **`evernote`** is Evernote’s official JavaScript SDK around the Thrift API; it is **maintenance-frozen** upstream. If Evernote changes or restricts the classic API, this path may need revisiting.
- **Evernote policy:** Access via developer tokens is subject to Evernote’s own product and developer policies; if a developer token is unavailable, use **OAuth** (`login` + `snapshot`) instead.

## Restoring `data/` on a new machine

`data/` is not in git. Copy your vault snapshot or re-import from Evernote into `data/` locally, or symlink it to your real Obsidian vault folder if that fits your workflow.

## Security

- Never commit Evernote developer tokens, OAuth access token files, consumer secrets, or `.enex` files that contain private notes unless this repo is strictly private and you accept the risk.
- Prefer environment variables or a local `.env` (gitignored) for credentials; see **`.env.example`** for variable names used by the CLI. Treat **`./out/evernote-oauth.json`** like a password (mode `0600` on write; keep **`out/`** gitignored).

## Contributing

Repository tooling, GitHub token + **direnv** layout for `gh` / HTTPS Git, and local build commands: [CONTRIBUTING.md](CONTRIBUTING.md).

## Next steps (for later implementation)

Rough direction only: correlate snapshot metadata with imported Markdown (by title, optional overrides, or other sidecars), produce a link map, then rewrite `evernote:///…` (and shard URLs) to `[[wikilinks]]` or Markdown links that match your vault layout. See [docs/edds/2026-05-10-evernote-obsidian-migration.edd.md](docs/edds/2026-05-10-evernote-obsidian-migration.edd.md) for phased detail.

## Context

- [Import from Evernote – Obsidian Help](https://obsidian.md/help/import/evernote)
- [[Evernote] Links for Evernote notes are not converted · Issue #306 · obsidianmd/obsidian-importer](https://github.com/obsidianmd/obsidian-importer/issues/306)
