# Contributing

Notes for anyone working **in this repository** (humans, agents, CI-style shells): tooling, GitHub access, and local checks. For what the project does and how to run the Evernote CLI, see [README.md](README.md).

## Local development

- **Node:** version **24** or newer (see `.nvmrc`).
- **Install:** `npm install`
- **Build:** `npm run build` (TypeScript → `dist/`)
- **Tests:** `npm test`
- **Lint:** `npm run lint` — `npm run format` applies Biome fixes.

## GitHub (`gh` / Git over HTTPS)

Optional: use a **fine-grained personal access token** scoped to **this repository only**, with the smallest permission set you need (for example **Contents** and **Pull requests**, plus **Issues** if you want normal PR thread comments). That keeps automation and local tools off **full** `gh auth login` access to every repo your account can reach.

Put the token **outside** the project tree (narrower blast radius if something reads the workspace), for example `~/.config/gh/evernote-obsidian.env`:

```text
GH_TOKEN=github_pat_xxxxxxxx
```

Use **`chmod 600`** on that file.

With **[direnv](https://direnv.net/)**, the committed root **`.envrc`** loads that file using a single line (no secrets in git; no `export` in the env file — `dotenv_if_exists` exports variables for you):

```bash
dotenv_if_exists "${HOME}/.config/gh/evernote-obsidian.env"
```

After **`direnv allow`** in this directory, `gh` and Git over `https://github.com/…` pick up **`GH_TOKEN`** for this shell. Prefer **HTTPS** remotes for this flow; **SSH** uses your keys separately and is not limited by the PAT’s repository list.

## Secrets

Never commit Evernote tokens, GitHub tokens, or `.enex` exports. The CLI reads **`.env`** for Evernote variables (see **`.env.example`** and the README); GitHub credentials belong only in paths like the env file above or your own secret store.
