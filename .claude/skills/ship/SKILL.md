---
name: ship
description: Run the full PR-driven development lifecycle for this repo — feature branch, local validation, version bump, commit, push, PR, wait for CI, squash-merge, and clean up. Use this for ANY change to tracked files in monarch-uploader (code, tests, docs, config, dependencies), including one-line fixes. Triggers on "ship it", "make a PR", "open a PR", "merge this", or any request to implement/fix/update something in this repo.
---

# Ship a change (PR-driven workflow)

`main` is protected by the `Protect main` ruleset. Direct pushes to `main` are
rejected. Every change — including a one-line typo fix — goes through a feature
branch and a squash-merged PR. You own the whole lifecycle end to end; do not
stop halfway and hand steps back to the user.

## Repository facts that shape this workflow

Verified against the `Protect main` ruleset and repo settings:

| Constraint | Consequence for you |
|---|---|
| Pull request required, squash-only merge | Always `gh pr merge --squash` |
| Required status check: `test (24.x)` | Wait for this exact check before merging |
| Strict status checks (branch must be current) | If `main` moved, update the branch and wait for CI **again** |
| Linear history, no force-push, no deletion on `main` | Never `git push --force` to `main`; rebase feature branches only |
| `required_approving_review_count: 0` | No reviewer needed — you can self-merge once CI is green |
| `delete_branch_on_merge` is **off** | Must pass `--delete-branch` explicitly |

CI runs `npm run lint`, `npm run test:coverage`, and a dev build. `npm run build:full`
locally is a superset, so a green local validation almost always means green CI.

## Steps

### 1. Branch before you edit

```bash
git checkout main && git pull && git checkout -b <type>/<kebab-case-description>
```

Types: `feat/`, `fix/`, `refactor/`, `docs/`, `test/`, `chore/`, `build/`.
When unsure, use `chore/`.

If you already made edits on `main` by mistake, do not commit there. Create the
branch now — uncommitted changes carry over — or move an existing commit with
`git branch <name> && git reset --hard origin/main`.

Unrelated changes belong in separate branches and separate PRs.

### 2. Make the change

Follow the conventions in `AGENTS.md`: layer boundaries, function length limits,
file size limits, HTML element IDs, error-handling patterns. New or modified
behavior needs test coverage in the matching `test/` file.

### 3. Bump the version

Every user-visible change ships a version bump. Decide the increment from
`AGENTS.md` (patch for fixes/refactors/docs, minor for features, major for a new
institution or breaking change), then:

```bash
npm run version:bump -- X.Y.Z
```

Current version:

```bash
node -p "require('./src/scriptInfo.json').version"
```

Skip this only for changes that cannot affect the built userscript at all — for
example edits confined to `.claude/`, `.github/`, or `docs/`.

### 4. Validate locally

```bash
npm run build:full
```

This is clean → lint → typecheck → test → production webpack build. It must pass
with zero errors. Fix the root cause and re-run; do not push a red build hoping
CI disagrees.

### 5. Commit and push

```bash
git add .
git commit -m "<type>: <summary, max 72 chars, lowercase, imperative, no period>

- Detail 1
- Detail 2"
git push -u origin <branch-name>
```

### 6. Open the PR

```bash
gh pr create --title "<type>: <summary>" --body "$(cat <<'EOF'
## Summary
- What changed and why

## Validation
- `npm run build:full` passes locally
EOF
)"
```

### 7. Wait for CI — do not skip this

Block until the required check finishes:

```bash
gh pr checks --watch --fail-fast
```

This exits non-zero on failure. If it fails:

1. Read the failure: `gh run view --log-failed` (or `gh pr checks` for the URL).
2. Fix it on the same branch, re-run `npm run build:full`, commit, push.
3. Watch again. Repeat until green.

Do not merge, and do not report success, while any required check is pending or
failing.

### 8. Handle a stale branch

Strict status checks mean the branch must be up to date with `main`. If
`gh pr merge` complains that the branch is not current, or `gh pr view` shows
`mergeStateStatus: BEHIND`:

```bash
gh pr update-branch --rebase
```

That push restarts CI, so return to step 7 and wait for green again.

### 9. Merge

```bash
gh pr merge --squash --delete-branch
```

If you would rather not sit through a second CI cycle after a branch update, you
may instead queue it: `gh pr merge --squash --delete-branch --auto`. Only do this
when the user is fine with the merge landing later, and say so explicitly —
otherwise wait and merge synchronously so you can confirm the outcome.

### 10. Clean up and verify

```bash
git checkout main && git pull && git branch
```

Confirm the local feature branch is gone and `git status` is clean. Then report
to the user: the PR number and URL, what merged, and the new version.

## Hard rules

- Never commit directly to `main`.
- Never force-push to `main`.
- Never merge with a pending or failing required check.
- Always `--squash` (the ruleset permits nothing else).
- Always `--delete-branch` (the repo will not do it for you).
- Never claim CI passed without having seen `gh pr checks` report success.

## Full lifecycle, condensed

```bash
git checkout main && git pull && git checkout -b fix/balance-rounding
# ...edit files, add tests...
npm run version:bump -- 7.14.1
npm run build:full
git add . && git commit -m "fix: round balances to two decimals"
git push -u origin fix/balance-rounding
gh pr create --title "fix: round balances to two decimals" --body "..."
gh pr checks --watch --fail-fast
gh pr merge --squash --delete-branch
git checkout main && git pull && git branch
```
