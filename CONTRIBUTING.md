# Contributing

Notes for anyone working **in this repository**: local checks and **optional** GitHub notes. For what the project does and how to run the Evernote CLI, see [README.md](README.md).

## Local development

- **Node:** version **24** or newer (see `.nvmrc`).
- **Install:** `npm install`
- **Build:** `npm run build` (TypeScript → `dist/`)
- **Tests:** `npm test`
- **Lint:** `npm run lint` — `npm run format` applies Biome fixes.

## Git and GitHub (your machine, your rules)

Use **SSH**, **`gh auth login`**, or **HTTPS + token**—whatever you prefer. For **`git`** over HTTPS with **`gh`**, run **`gh auth setup-git`** once unless you use another credential helper.

**Optional — repo-local token file:** copy **`.env.github.example`** to **`.env.github`**, set **`GH_TOKEN=`**, never commit it (covered by `.env.*` in `.gitignore`). With **direnv**, copy **`.envrc.example`** to **`.envrc`**, then **`direnv allow`**. Agent shells often skip direnv hooks; from the repo root use **`direnv exec . git …`** / **`direnv exec . gh …`** when needed—see **`AGENTS.md`**.

**Cursor prompts** on `git` / `gh` are usually **sandbox limits** (network, `git_write`, etc.), not missing docs in this repo.

## Secrets

Never commit Evernote tokens, OAuth token files, consumer secrets, GitHub tokens, or `.enex` exports. The CLI reads **`.env`** for Evernote variables (see **`.env.example`** and the README).
