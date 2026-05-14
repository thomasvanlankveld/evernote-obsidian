# Contributing

Notes for anyone working **in this repository**: local checks and **optional** GitHub notes. For what the project does and how to run the Evernote CLI, see [README.md](README.md).

## Local development

- **Node:** version **24** or newer (see `.nvmrc`).
- **Install:** `npm install`
- **Build:** `npm run build` (TypeScript → `dist/`)
- **Tests:** `npm test`
- **Lint:** `npm run lint` — `npm run format` applies Biome fixes.

## Git and GitHub (your machine, your rules)

**HTTPS + `gh` (no repo-local token file):** run **`gh auth login`** once, then **`gh auth setup-git`**. Git uses `gh` as its credential helper; tokens live in **`gh`’s config under your home directory**, not in this repo. **SSH** or another helper is fine if you prefer.

**Cursor** may still prompt before `git` / `gh` (**network**, **`git_write`**, or access to **`gh`’s files**)—that is sandbox / auto-run policy, not something missing from this repository.

## Secrets

Never commit Evernote developer tokens, GitHub tokens, or `.enex` exports. The CLI reads **`.env`** for Evernote variables (see **`.env.example`** and the README).
