# Contributing

Notes for anyone working **in this repository**: local checks and **optional** GitHub notes. For what the project does and how to run the Evernote CLI, see [README.md](README.md).

## Local development

- **Node:** version **24** or newer (see `.nvmrc`).
- **Install:** `npm install`
- **Build:** `npm run build` (TypeScript → `dist/`)
- **Tests:** `npm test`
- **Lint:** `npm run lint` — `npm run format` applies Biome fixes.

## Git and GitHub (your machine, your rules)

This repo **does not** prescribe how you authenticate to GitHub. Use **SSH**, **`gh auth login`**, **HTTPS + personal access token**, or whatever fits your workflow. Remotes can be `git@github.com:…` or `https://github.com/…`.

If you use **`gh`** with a token, set **`GH_TOKEN`** or **`GITHUB_TOKEN`** in the environment the way you prefer (shell profile, OS secret store, CI secrets, etc.). For **`git`** over HTTPS with a token, run **`gh auth setup-git`** once so Git uses `gh` as the credential helper (or configure another helper you trust).

### Optional pattern: direnv + token outside the repo

Some people keep a fine-grained PAT in a file under **`$HOME`** (for example `~/.config/gh/evernote-obsidian.env` with a single line `GH_TOKEN=…`, file mode **`600`**), then load it only in this directory:

1. Copy **`.envrc.example`** to **`.envrc`** (`.envrc` is gitignored).
2. Edit paths if yours differ.
3. Run **`direnv allow`** in the repo root.

That layout is **not required**; it is only a documented example.

### Agents, Cursor, and “always asking permission”

If the **agent** still prompts before **`git pull`**, **`git push`**, or **`gh`**, that is almost always **Cursor’s sandbox / auto-run policy** (network, `git_write`, or **`all`** when the tool must read **`$HOME`** for credentials)—not missing files in this repository. Grant the requested capability for that run, adjust Cursor’s automation settings for trusted workspaces, or run Git yourself outside the agent. **`direnv` hooks only apply to interactive shells**; for scripts or agents, **`direnv exec . <command>`** from the repo root can load a local **`.envrc`** if you use one—see root **`AGENTS.md`**.

## Secrets

Never commit Evernote tokens, OAuth token files, consumer secrets, GitHub tokens, or `.enex` exports. The CLI reads **`.env`** for Evernote variables (see **`.env.example`** and the README); keep GitHub credentials in your own secret store or untracked local files.
