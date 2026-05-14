Be concise.

Git policy (agents):
- `main` is branch-protected: do all work on a feature branch and land changes via PR (no direct pushes to `main`).
- Prefer `git merge` (or PR) over rebase.
- Never rewrite remote/shared history: no `rebase`, `reset --hard`, `commit --amend`, or `push --force`—unless explicitly requested in this chat.
- **Git / `gh` credentials** are a maintainer choice; this repo does not commit them. If you use a local **`.envrc`** + **direnv**, interactive shells load it after `direnv allow`; **agent shells often do not**—from the repo root use **`direnv exec . git …`** / **`direnv exec . gh …`** so that environment is applied. See [CONTRIBUTING.md](CONTRIBUTING.md).
- **Cursor prompts** on `git fetch` / `push` / `gh` are usually **sandbox or auto-run limits** (e.g. **network**, **git_write**, or **`all`** when reading credentials under **`$HOME`**), not missing repo files.

Design docs / EDD workflow for agents: [docs/edds/AGENTS.md](docs/edds/AGENTS.md).
