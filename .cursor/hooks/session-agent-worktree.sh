#!/usr/bin/env sh
# Agent sessions: require a linked worktree; set EVERNOTE_OBSIDIAN_AGENT for Husky.
export EVERNOTE_OBSIDIAN_AGENT=1

if ! ./scripts/ensure-agent-worktree.sh; then
	issue_hint=""
	if command -v gh >/dev/null 2>&1; then
		issue_hint=" Run: npm run agent:worktree -- <issue#> [<topic>]"
	fi
	printf '%s\n' "{\"agent_message\":\"Edits must be in .worktrees/*, not the primary clone.${issue_hint} Move the workspace to the printed path and start a new agent session.\"}" 2>/dev/null || true
	exit 2
fi

exit 0
