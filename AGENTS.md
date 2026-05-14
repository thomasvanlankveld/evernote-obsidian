Be concise.

Git policy (agents):
- `main` is branch-protected: do all work on a feature branch and land changes via PR (no direct pushes to `main`).
- Prefer `git merge` (or PR) over rebase.
- Never rewrite remote/shared history: no `rebase`, `reset --hard`, `commit --amend`, or `push --force`—unless explicitly requested in this chat.
- **GitHub HTTPS + `GH_TOKEN`:** interactive shells load `.envrc` via direnv; **agent/CI shells usually do not**—run `direnv exec . git …` / `direnv exec . gh …` from the repo root so the token is exported (see [CONTRIBUTING.md](CONTRIBUTING.md)).
- **Cursor agent runs:** `git fetch`, `git push`, and `gh` need **network** plus **`all`** (or equivalent) so outbound Git works and `~/.config/gh/evernote-obsidian.env` can be read when sourcing env for push.

Design docs / EDD workflow for agents: [docs/edds/AGENTS.md](docs/edds/AGENTS.md).
