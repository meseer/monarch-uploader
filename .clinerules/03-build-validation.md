# Build Validation Requirements

## Mandatory Build Checks

**You MUST complete ALL of the following checks before marking any task as complete:**

### 1. Linting Check
```bash
npm run lint
```
- Ensures code follows project style guidelines
- Catches potential errors and anti-patterns
- Must pass without any errors

### 2. Test Suite
```bash
npm test
```
- Runs all unit and integration tests
- Verifies functionality works as expected
- All tests must pass (no failures or skipped tests)

### 3. Standard Build
```bash
npm run build
```
- Compiles the project for production
- Verifies webpack configuration is correct
- Ensures all imports and dependencies resolve

### 4. Full Build Validation
```bash
npm run build:full
```
- Performs comprehensive build validation
- Includes all build steps and checks
- Must complete successfully without errors

## Build Validation Checklist

Before marking any task complete, verify:

- [ ] `npm run lint` passes without errors
- [ ] `npm test` passes all tests
- [ ] `npm run build` completes successfully
- [ ] `npm run build:full` completes successfully
- [ ] No console errors or warnings in build output
- [ ] Version numbers updated in both `package.json` and `src/userscript-metadata.js`

## Error Resolution

If any build step fails:

1. **Fix the issue immediately** - Do not proceed with other changes
2. **Re-run the failed command** to verify the fix
3. **Run the full validation sequence again** from the beginning
4. **Only mark task complete** when all checks pass

## Common Issues and Solutions

| Issue | Solution |
|-------|----------|
| Linting errors | Run `npm run lint:fix` first, then manually fix remaining issues |
| Test failures | Review test output, fix implementation or update tests as needed |
| Build errors | Check import statements, file paths, and dependency versions |
| Version mismatch | Ensure versions in `package.json` and `src/userscript-metadata.js` match |

## Important Notes

- **NEVER** skip build validation steps
- **NEVER** commit or mark complete with failing builds
- If unsure about a build error, investigate thoroughly before proceeding
- Document any build configuration changes in commit messages
- Keep build output clean - fix warnings even if build succeeds

## Quick Validation Command

For convenience, you can run all checks in sequence:
```bash
npm run lint && npm test && npm run build && npm run build:full
```

If any step fails, the sequence stops, allowing you to fix issues immediately.
