#!/usr/bin/env sh
set -eu

usage() {
	echo "Usage: npm run agent:worktree -- <issue#|slug> [<short-topic>]" >&2
	echo "  issue#  — validated with gh; creates .worktrees/<issue>-<topic> and feat/<issue>-<topic>" >&2
	echo "  slug    — e.g. chore-readme → .worktrees/chore-readme and branch chore/readme" >&2
	exit 1
}

slugify() {
	printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+|-+$//g' | cut -c1-48
}

ref=${1:-}
topic=${2:-}

[ -n "$ref" ] || usage

top=$(git rev-parse --show-toplevel)
git_common=$(git rev-parse --git-common-dir)
case "$git_common" in
/*) ;;
*) git_common="${top}/${git_common}" ;;
esac
repo_root=$(dirname "$git_common")
cd "$repo_root"

git fetch origin main

if printf '%s' "$ref" | grep -Eq '^[0-9]+$'; then
	issue=$ref
	if ! gh issue view "$issue" >/dev/null 2>&1; then
		echo >&2 "agent-worktree: GitHub issue #${issue} not found (is gh authenticated?)"
		exit 1
	fi
	if [ -z "$topic" ]; then
		title=$(gh issue view "$issue" --json title -q .title)
		topic=$(slugify "$title")
	fi
	slug="${issue}-${topic}"
	worktree_rel=".worktrees/${slug}"
	branch="feat/${issue}-${topic}"
else
	slug=$ref
	if [ -n "$topic" ]; then
		slug="${ref}-${topic}"
	fi
	worktree_rel=".worktrees/${slug}"
	# chore-readme → chore/readme (first hyphen only)
	branch=$(printf '%s' "$slug" | sed 's/-/\//')
fi

worktree_path="${repo_root}/${worktree_rel}"

if git worktree list --porcelain | grep -q "^worktree ${worktree_path}$"; then
	echo "Worktree already exists: ${worktree_path}"
	git -C "$worktree_path" status -sb
elif git show-ref --verify --quiet "refs/heads/${branch}"; then
	if wt_path=$(git worktree list --porcelain | awk -v b="$branch" '
		/^worktree / { p=$2 }
		/^branch refs\/heads\// {
			sub(/^branch refs\/heads\//, "", $0)
			if ($0 == b) { print p; exit }
		}
	'); then
		[ -n "$wt_path" ] && echo "Branch ${branch} is already checked out at: ${wt_path}" && exit 0
	fi
	git worktree add "$worktree_rel" "$branch"
else
	git worktree add "$worktree_rel" -b "$branch" origin/main
fi

echo ""
echo "Worktree:  ${worktree_path}"
echo "Branch:    ${branch}"
echo ""
echo "Next steps:"
echo "  1. Move the agent / workspace root to: ${worktree_path}"
echo "  2. export EVERNOTE_OBSIDIAN_AGENT=1   # optional; Cursor hook sets this"
if printf '%s' "$ref" | grep -Eq '^[0-9]+$'; then
	echo "  3. Commit with: Closes #${issue}"
fi
