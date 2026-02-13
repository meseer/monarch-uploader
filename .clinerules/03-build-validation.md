# Build Validation Requirements

## Mandatory Build Checks

**You MUST complete ALL of the following checks before marking any task as complete:**

```bash
npm run lint && npm test && npm run build && npm run build:full
```

If any step fails, fix the issue and re-run the full sequence from the beginning.

### Individual Commands

| Command | Purpose |
|---------|---------|
| `npm run lint` | Code style and anti-pattern checks (use `npm run lint:fix` first for auto-fixable issues) |
| `npm test` | All unit/integration tests must pass |
| `npm run build` | Production compilation, verifies webpack and imports |
| `npm run build:full` | Comprehensive build validation |

All commands must complete with zero errors. Fix warnings even if the build succeeds.