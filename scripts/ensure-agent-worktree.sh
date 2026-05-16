#!/usr/bin/env sh
# Fail unless cwd is a linked git worktree (git-dir contains /worktrees/).
# Humans may set ALLOW_PRIMARY_CLONE=1 to skip.

if [ "${ALLOW_PRIMARY_CLONE:-}" = "1" ]; then
	exit 0
fi

git_dir=$(git rev-parse --git-dir 2>/dev/null) || {
	echo >&2 "ensure-agent-worktree: not inside a git repository"
	exit 1
}

case "$git_dir" in
*/worktrees/*) exit 0 ;;
esac

repo_root=$(git rev-parse --show-toplevel 2>/dev/null) || repo_root="."
echo >&2 "Agent edits must use a worktree under .worktrees/, not the primary clone."
echo >&2 "From ${repo_root}: npm run agent:worktree -- <issue#> [<short-topic>]"
echo >&2 "Then move the workspace / agent root to the printed .worktrees/ path."
exit 1
