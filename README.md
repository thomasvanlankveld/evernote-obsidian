# Evernote → Obsidian migration

Personal tooling to move notes from Evernote into Obsidian when the stock import path leaves **internal links broken**.

## Why this exists

The usual flow is: export `.enex` from Evernote, import with Obsidian’s [Importer](https://obsidian.md/help/import/evernote). That works for content, but note-to-note links often stay as `evernote:///…` URLs because the export does not carry enough stable identifiers for importers to rewrite them—see [obsidian-importer#306](https://github.com/obsidianmd/obsidian-importer/issues/306). For a large vault with many internal links, fixing that by hand is not practical.

A complementary approach is to use **Evernote’s API** (or other metadata sources) to build a mapping from those URLs or note identities to the Markdown files Obsidian actually created, then rewrite links in bulk. This repo is a place to grow that kind of automation.

## Prerequisites

- [nvm](https://github.com/nvm-sh/nvm) (or another Node version manager you prefer)
- Node **24** (see `.nvmrc`)

## Restoring `data/` on a new machine

`data/` is not in git. Copy your vault snapshot or re-import from Evernote into `data/` locally, or symlink it to your real Obsidian vault folder if that fits your workflow.

## Security

- Never commit Evernote developer tokens or `.enex` files that contain private notes unless this repo is strictly private and you accept the risk.
- Prefer environment variables or a local `.env` (gitignored) for credentials; add `.env.example` later if you document required variables.

## Next steps (for later implementation)

Rough direction only: authenticate to Evernote, list or fetch notes with stable IDs, correlate with imported Markdown (by title, ENML hash, or exported sidecar metadata), produce a link map, then rewrite `evernote:///…` (and any other patterns) to `[[wikilinks]]` or Markdown links that match your vault layout.

## Context

- [Import from Evernote – Obsidian Help](https://obsidian.md/help/import/evernote)
- [[Evernote] Links for Evernote notes are not converted · Issue #306 · obsidianmd/obsidian-importer](https://github.com/obsidianmd/obsidian-importer/issues/306)
