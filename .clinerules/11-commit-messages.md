# Commit Message Guidelines - MANDATORY

## Critical: Always Generate Commit Messages

**You MUST generate a commit message after completing ANY changes to the codebase.**

After successfully implementing changes and passing all validation checks, you must:
1. Generate an appropriate commit message
2. Provide the complete `git commit` command ready for execution
3. Include this in your final response to the user

## Commit Message Format

### Structure
```
<type>: <brief summary (max 72 chars)>

<detailed description of changes>
```

### Type Prefixes
Use these conventional commit type prefixes:
- `feat:` - New feature or functionality
- `fix:` - Bug fix
- `refactor:` - Code refactoring without changing functionality
- `test:` - Adding or updating tests
- `docs:` - Documentation changes
- `style:` - Code style/formatting changes (not CSS)
- `perf:` - Performance improvements
- `build:` - Build system or dependency changes
- `ci:` - CI/CD configuration changes
- `chore:` - Maintenance tasks, version updates

### Summary Line Rules
- **Maximum 72 characters** for the summary line
- **Start with lowercase** after the type prefix
- **No period** at the end of the summary
- **Use imperative mood** ("add feature" not "added feature")
- **Be specific** about what changed

### Description Guidelines
- Provide a brief overview of **what** changed
- Explain **why** if not obvious from the summary
- List major changes as bullet points if multiple
- Keep it concise but informative

## Examples

### ✅ Good Commit Messages

```bash
# Single feature addition
git commit -m "feat: add security selector modal for questrade positions

- Implement modal UI component with search functionality
- Add keyboard navigation support
- Include price and change display for each security"

# Bug fix
git commit -m "fix: correct date range validation in balance upload

- Validate from date is before to date
- Show user-friendly error messages
- Prevent API calls with invalid date ranges"

# Refactoring
git commit -m "refactor: extract balance processing logic to separate service

- Move business logic from API layer to service layer
- Improve separation of concerns
- Add unit tests for extracted functions"

# Version update
git commit -m "chore: bump version to 2.1.0

- Update package.json version
- Update userscript metadata version
- Update README version badge"

# Test addition
git commit -m "test: add coverage for account balance calculations

- Test positive, negative, and zero balances
- Add edge case handling tests
- Verify currency formatting"
```

### ❌ Bad Commit Messages

```bash
# Too vague
git commit -m "fix: fixed bug"

# Too long summary
git commit -m "feat: implement comprehensive security selector modal with search functionality and keyboard navigation for questrade positions"

# Wrong mood
git commit -m "feat: added new feature"

# Missing type prefix
git commit -m "Update balance service"

# No description when needed
git commit -m "refactor: update code"
```

## Commit Command Generation

### Format for User

Always provide the complete command ready to execute:

```bash
git add .
git commit -m "type: brief summary

- Change detail 1
- Change detail 2
- Change detail 3"
```

### Multi-line Commit Messages

For complex changes, use the multi-line format:

```bash
git commit -m "feat: add upload progress tracking" -m "- Display real-time upload progress
- Show success/failure status for each account
- Add retry mechanism for failed uploads
- Store upload history in local storage"
```

## When to Generate Commit Messages

Generate a commit message:
- ✅ After successfully completing any code changes
- ✅ After passing all build validation checks
- ✅ When using the `attempt_completion` tool
- ✅ After fixing bugs or issues
- ✅ After adding new features
- ✅ After updating documentation
- ✅ After refactoring code
- ✅ After updating dependencies or versions

## Integration with Other Rules

### After Version Updates
When updating versions (as per rule 01), include version numbers:
```bash
git commit -m "chore: bump version to X.Y.Z

- Update package.json to X.Y.Z
- Update userscript metadata to X.Y.Z
- Update README version badge"
```

### After Test Coverage
When adding tests (as per rule 02), be specific:
```bash
git commit -m "test: add tests for balance upload service

- Cover successful upload scenario
- Test error handling for API failures
- Verify date range validation"
```

### After Build Validation
Only generate commit message after all checks pass (as per rule 03):
1. Run `npm run lint`
2. Run `npm test`
3. Run `npm run build`
4. Run `npm run build:full`
5. **Then** generate commit message

## Checklist for Commit Messages

Before providing a commit message, verify:
- [ ] All changes are complete and working
- [ ] Build validation has passed
- [ ] Version numbers are updated (if applicable)
- [ ] Tests are added/updated (if applicable)
- [ ] Summary line is under 72 characters
- [ ] Type prefix is appropriate
- [ ] Description explains the changes clearly
- [ ] Command is properly formatted for execution

## Quick Reference Template

```bash
# Copy and modify this template:
git add .
git commit -m "<type>: <what changed in under 72 chars>

- <Key change 1>
- <Key change 2>
- <Key change 3 if needed>"
```

## Important Notes

- **ALWAYS** include a commit message in your final response
- **NEVER** skip commit message generation after making changes
- If unsure about the type, default to `chore:` for general changes
- For multiple unrelated changes, suggest separate commits
- Include issue/ticket numbers if provided by the user (e.g., `fix: resolve date parsing (#123)`)

## Example Final Response

After completing a task, your response should end with:

---

**Commit message:**

```bash
git add .
git commit -m "feat: implement account balance upload for questrade

- Add balance fetching from Questrade API
- Convert balance history to CSV format
- Integrate with Monarch upload service
- Add error handling and user notifications"
```

This commit message summarizes the implementation of the Questrade balance upload feature with key changes listed.
