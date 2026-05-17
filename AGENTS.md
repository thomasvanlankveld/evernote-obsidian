Be concise.

## Git — agents (Cursor)

Use **Cursor worktrees** for isolated agent work—not manual `git worktree add .worktrees/...` in this repo.

- **Agents Window:** Start or move an agent into a worktree from the Agents Window. Cursor creates an isolated checkout (often under `~/.cursor/worktrees/`). See [Cursor worktrees](https://cursor.com/docs/configuration/worktrees).
- **Editor:** Use `/worktree` (or `/best-of-n`) for an isolated run in the current chat.

After Cursor creates a worktree, setup runs from [`.cursor/worktrees.json`](.cursor/worktrees.json) (e.g. `npm ci`). Review in the Agents Window; commit and open a PR from the worktree when ready.

**Humans:** Primary clone or a worktree—your choice.

**Everyone:** No push to `main` (PR only). Prefer merge over rebase. No `push --force` / `rebase` / `reset --hard` / `commit --amend` on shared history unless this chat asks.

**`gh`:** [CONTRIBUTING.md](CONTRIBUTING.md).

## EDD workflow (agents)

[docs/edds/AGENTS.md](docs/edds/AGENTS.md).
