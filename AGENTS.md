Be concise.

## Git — automated agents (Cursor, etc.)

The worktree rule is easy to miss because it sounds like “use a branch anywhere.” **Agents must use a linked worktree under this repo’s `.worktrees/` and do all implementation work there**, not only “commit from a feature branch” while editing in the primary clone.

**Before the first edit or `git commit` on a task**

1. From the checkout that contains `.git`, run  
   `git worktree add .worktrees/<slug>/ -b feat/<topic> origin/main`  
   (or `cd` into an existing `.worktrees/<slug>/` already on your branch). Path must be **inside** this repository at `.worktrees/…` (gitignored), not a sibling folder outside the repo.
2. **Point the whole agent session at that directory:** workspace root, file ops, and terminals. In Cursor, use **Move agent to root** (MCP) or **File → Open Folder** on `.worktrees/<slug>/` so the chat’s default cwd matches where you edit.
3. Run tests, edit, and commit only from that tree; open the PR from its branch.

**Humans:** optional; contribute from the root clone if you prefer.

**Everyone — `main` and history:** No direct push to `main`; ship via PR. Prefer `git merge` over rebase. Do not rewrite shared history (`rebase`, `reset --hard`, `commit --amend`, `push --force`) unless this chat explicitly requests it.

**Why there is no CI “worktree check”:** GitHub only sees commits, not which folder your editor used. Compliance is self-service: this file plus `.cursor/rules/agent-git-worktree.mdc`.

**`gh` / credentials:** [CONTRIBUTING.md](CONTRIBUTING.md).

## EDD workflow (agents)

[docs/edds/AGENTS.md](docs/edds/AGENTS.md).
