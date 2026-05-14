Be concise.

Git policy (agents):
- **`main`, PRs, worktrees:** No direct pushes to **`main`**; ship with a **PR** from a **feature branch**. **Agents:** run **`git worktree add .worktrees/<slug>/ -b feat/<topic> origin/main`** (or reuse a tree on that branch), then keep **all** edits, **`git commit`**, and the **workspace root** in that **linked** checkout—nest under **`.worktrees/`** in this repo (gitignored), not a sibling checkout outside the workspace root—see [git worktree](https://git-scm.com/docs/git-worktree).
- Prefer `git merge` (or PR) over rebase.
- Never rewrite remote/shared history: no `rebase`, `reset --hard`, `commit --amend`, or `push --force`—unless explicitly requested in this chat.
- **Git / `gh`:** maintainers often use **`gh auth login`** + **`gh auth setup-git`** (see [CONTRIBUTING.md](CONTRIBUTING.md)); credentials are outside the repo.

Design docs / EDD workflow for agents: [docs/edds/AGENTS.md](docs/edds/AGENTS.md).
