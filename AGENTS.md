Be concise.

Git policy (agents):
- Prefer `git merge` (or PR) over rebase.
- Never rewrite remote/shared history: no `rebase`, `reset --hard`, `commit --amend`, or `push --force`—unless explicitly requested in this chat.

EDD phases (agents):
- When a branch finishes an EDD phase: run `npm test` (and `npm run build` / `npm run lint` if code changed), then update the matching EDD under `edds/` (checkboxes + **Last updated**) on that same branch before pushing or marking the PR ready. See the “EDD phase completion” callout in the active EDD.
