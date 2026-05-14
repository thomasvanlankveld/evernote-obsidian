Be concise.

## Git — automated agents (Cursor, etc.)

**Use a worktree under `.worktrees/<slug>/` inside this repo for all edits and commits**, not the primary clone root while “on a branch” elsewhere.

1. `git worktree add .worktrees/<slug>/ -b feat/<topic> origin/main` (or reuse an existing tree on your branch). Stay under `./.worktrees/`, not a sibling path outside the repo.
2. Move the **workspace / agent root** to that folder (Cursor: Move agent to root, or open that folder) so cwd and edits match.
3. Tests, commits, and PRs only from there.

**Humans:** worktree optional.

**Everyone:** No push to `main` (PR only). Prefer merge over rebase. No `push --force` / `rebase` / `reset --hard` / `commit --amend` on shared history unless this chat asks.

**`gh`:** [CONTRIBUTING.md](CONTRIBUTING.md).

## EDD workflow (agents)

[docs/edds/AGENTS.md](docs/edds/AGENTS.md).
