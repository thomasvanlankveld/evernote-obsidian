Be concise.

Git policy (agents):
- Prefer `git merge` (or PR) over rebase.
- Never rewrite remote/shared history: no `rebase`, `reset --hard`, `commit --amend`, or `push --force`—unless explicitly requested in this chat.
- **Git / `gh`:** maintainers often use **`gh auth login`** + **`gh auth setup-git`** (see [CONTRIBUTING.md](CONTRIBUTING.md)); credentials are outside the repo. **Cursor prompts** on `git` / `gh` are usually **sandbox / auto-run** (e.g. **network**, **git_write**, access to **`gh`’s config**), not missing repo files.
- **Linked worktrees:** prefer a path **under this repo** (e.g. **`.worktrees/<slug>/`**) instead of a **sibling** directory. Cursor agents are scoped to workspace roots; siblings are easy to miss unless you add them explicitly. This repo **gitignores** **`.worktrees/`**; nested checkouts still work—see [git worktree](https://git-scm.com/docs/git-worktree).

Design docs / EDD workflow for agents: [docs/edds/AGENTS.md](docs/edds/AGENTS.md).
