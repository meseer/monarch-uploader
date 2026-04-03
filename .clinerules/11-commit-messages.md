# Git Workflow - MANDATORY

## Overview

This project uses branch protection on `main`. All changes must go through a feature branch → PR → merge workflow. **You MUST manage this entire lifecycle automatically** — do not leave manual steps for the user.

## Workflow Steps

### 1. Before Making Changes — Create a Feature Branch

At the start of every task that involves code or file changes:

```bash
git checkout main && git pull && git checkout -b <type>/<short-name>
```

- Always branch from an up-to-date `main`
- Create the branch **before** making any changes

### 2. Branch Naming Convention

Format: `<type>/<kebab-case-description>`

| Type | When to use | Example |
|------|-------------|---------|
| `feat/` | New feature | `feat/pending-transactions` |
| `fix/` | Bug fix | `fix/balance-rounding` |
| `refactor/` | Code refactoring | `refactor/extract-sync-logic` |
| `docs/` | Documentation | `docs/readme-update` |
| `test/` | Test additions/changes | `test/holdings-edge-cases` |
| `chore/` | Maintenance, deps, config | `chore/update-dependencies` |
| `build/` | Build system changes | `build/webpack-config` |

### 3. After Validation Passes — Commit, Push, and Create PR

After all build validation checks pass (`npm run lint && npm test && npm run build && npm run build:full`):

```bash
# Stage and commit
git add .
git commit -m "<type>: <summary>

- Detail 1
- Detail 2"

# Push and create PR
git push origin <branch-name>
gh pr create --title "<type>: <summary>" --body "<bullet list of changes>"
```

### 4. After CI Passes — Merge and Clean Up

Once CI checks pass on the PR:

```bash
gh pr merge --squash --delete-branch
```

This command:
- Squash-merges the PR into `main`
- Deletes the remote branch
- Switches to `main` and pulls the latest changes
- Deletes the local branch

After merging, verify you're on a clean `main`:

```bash
git checkout main && git pull && git branch
```

## Commit Message Format

```
<type>: <brief summary (max 72 chars)>

<detailed description of changes>
```

### Type Prefixes
- `feat:` — New feature or functionality
- `fix:` — Bug fix
- `refactor:` — Code refactoring without changing functionality
- `test:` — Adding or updating tests
- `docs:` — Documentation changes
- `style:` — Code style/formatting changes (not CSS)
- `perf:` — Performance improvements
- `build:` — Build system or dependency changes
- `chore:` — Maintenance tasks, version updates

### Summary Line Rules
- Max 72 characters, lowercase after prefix, no trailing period
- Use imperative mood ("add feature" not "added feature")

### Description Guidelines
- Brief overview of **what** changed; explain **why** if not obvious
- List major changes as bullet points if multiple

## Important Rules

- **NEVER commit directly to `main`** — always use a feature branch
- **NEVER force-push to `main`**
- **ALWAYS create the feature branch before making changes** — if you forget, move the commit to a branch before pushing
- **ALWAYS use `--squash` merge** to keep `main` history clean
- **ALWAYS delete the branch after merge** (the `--delete-branch` flag handles this)
- If unsure about the type, default to `chore:`
- For multiple unrelated changes, suggest separate branches and PRs

## Quick Reference — Full Lifecycle

```bash
# 1. Start
git checkout main && git pull && git checkout -b feat/my-feature

# 2. Make changes, then validate
npm run lint && npm test && npm run build && npm run build:full

# 3. Commit and push
git add .
git commit -m "feat: add my feature

- Change detail 1
- Change detail 2"
git push origin feat/my-feature

# 4. Create PR
gh pr create --title "feat: add my feature" --body "- Change detail 1
- Change detail 2"

# 5. After CI passes — merge
gh pr merge --squash --delete-branch