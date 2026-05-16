# Contributing

Notes for anyone working **in this repository**: local checks and **optional** GitHub notes. For what the project does and how to run the Evernote CLI, see [README.md](README.md).

## Local development

- **Node:** version **24** or newer (see `.nvmrc`).
- **Install:** `npm install`
- **Build:** `npm run build` (TypeScript → `dist/`)
- **Tests:** `npm test`
- **Lint:** `npm run lint` — `npm run format` applies Biome fixes.

## Continuous integration

On pull requests and pushes to `main`, [`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs `npm ci`, then `npm run lint`, `npm test`, and `npm run build` on Node **24** (see `.nvmrc`).

## Git and GitHub (your machine, your rules)

**HTTPS + `gh` (no repo-local token file):** run **`gh auth login`** once, then **`gh auth setup-git`**. Git uses `gh` as its credential helper; tokens live in **`gh`’s config under your home directory**, not in this repo. **SSH** or another helper is fine if you prefer.

## Secrets

Never commit Evernote backup databases, GitHub tokens, or `.enex` exports that contain private data.
