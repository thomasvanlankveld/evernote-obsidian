Be concise.

Git policy (agents):
- `main` is branch-protected: do all work on a feature branch and land changes via PR (no direct pushes to `main`).
- Prefer `git merge` (or PR) over rebase.
- Never rewrite remote/shared history: no `rebase`, `reset --hard`, `commit --amend`, or `push --force`—unless explicitly requested in this chat.
- **Git / `gh`:** maintainers often use **`gh auth login`** + **`gh auth setup-git`** (see [CONTRIBUTING.md](CONTRIBUTING.md)); credentials are outside the repo.

Design docs / EDD workflow for agents: [docs/edds/AGENTS.md](docs/edds/AGENTS.md).
