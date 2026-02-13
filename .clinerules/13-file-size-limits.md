# File Size Limits - MANDATORY

## Core Principle

**No single source or test file should exceed 1,500 lines.**

## Hard Limits

| Metric | Limit | Notes |
|--------|-------|-------|
| **Lines per file** | 1,500 | Absolute maximum for any `.js` file |
| **Recommended target** | 500-800 | Ideal range for most files |
| **Minimum for split** | Files approaching 1,200+ lines should be proactively planned for splitting |

## When Creating New Files

- **Before writing**, estimate the final line count
- If a file will exceed 1,500 lines, plan to split it before writing
- For test files, split by logical `describe` block groupings
- For source files, split by functional area or concern

## When Modifying Existing Files

- **Before adding code** to a file, check its current line count
- If adding code would push a file over 1,500 lines, split first
- Never add code to an already-oversized file without splitting

## How to Split Files

### Test Files
- Group related `describe` blocks into separate files
- Each file gets its own imports (only what it needs)
- Use descriptive suffixes: `featureName.category.test.js`

### Source Files
- Split by functional area following separation of concerns
- Extract related functions/classes into sub-modules
- Use an index file if needed to re-export for backward compatibility

### UI Components
- Extract sub-components into separate files
- Extract helper/utility functions used only by the component
- Keep the main component file focused on orchestration

## Quick Check Command

```bash
find src test -name "*.js" | xargs wc -l | sort -rn | head -20