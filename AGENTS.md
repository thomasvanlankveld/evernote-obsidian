Be concise.

## Git — automated agents (Cursor, etc.)

**Work from `.worktrees/<slug>/`**, not the primary clone. Automation enforces this; do not duplicate hook logic here.

1. `npm run agent:worktree -- <issue#> [<short-topic>]` — validates the issue (when numeric), creates `.worktrees/<issue>-<topic>` and `feat/<issue>-<topic>` from `origin/main`, prints the path.
2. Move the **workspace / agent root** to the printed `.worktrees/…` path ([`scripts/agent-worktree.sh`](scripts/agent-worktree.sh), [`scripts/ensure-agent-worktree.sh`](scripts/ensure-agent-worktree.sh)).
3. Commit with `Closes #N` when fixing an issue. Tests, commits, and PRs only from the worktree.

**Humans:** worktree optional; `ALLOW_PRIMARY_CLONE=1` skips the guard. Set `EVERNOTE_OBSIDIAN_AGENT=1` only when you want Husky to require a worktree on commit.

**Cursor:** [`.cursor/hooks.json`](.cursor/hooks.json) runs the same guard at session start and sets agent mode.

**Everyone:** No push to `main` (PR only). Prefer merge over rebase. No `push --force` / `rebase` / `reset --hard` / `commit --amend` on shared history unless this chat asks.

**`gh`:** [CONTRIBUTING.md](CONTRIBUTING.md).

## EDD workflow (agents)

[docs/edds/AGENTS.md](docs/edds/AGENTS.md).
