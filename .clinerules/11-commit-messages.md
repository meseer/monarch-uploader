# Commit Message Guidelines - MANDATORY

## Critical: Always Generate Commit Messages

**You MUST generate a commit message after completing ANY changes to the codebase.**

After successfully implementing changes and passing all validation checks, provide the complete `git commit` command ready for execution in your final response.

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

## Output Format

Always provide the complete command ready to execute:

```bash
git add .
git commit -m "type: brief summary

- Change detail 1
- Change detail 2"
```

## When to Generate

Generate a commit message:
- After successfully completing any code changes
- After passing all build validation checks (`npm run lint && npm test && npm run build && npm run build:full`)
- When using the `attempt_completion` tool

If unsure about the type, default to `chore:`. For multiple unrelated changes, suggest separate commits.