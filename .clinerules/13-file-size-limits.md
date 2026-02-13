# File Size Limits - MANDATORY

## Core Principle

**No single source or test file should exceed 1,500 lines.**

This limit ensures that files remain readable by AI models within a 200k token context window, while leaving ample room for system prompts, cline rules, conversation history, and other context.

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
- Example: `transactionRules.test.js` → `transactionRules.cash-etransfer.test.js`, `transactionRules.investment-dividends.test.js`

### Source Files
- Split by functional area following separation of concerns
- Extract related functions/classes into sub-modules
- Use an index file if needed to re-export for backward compatibility
- Example: `settingsModal.js` → `settingsModal.js` (orchestration) + `settingsModalTabs.js` + `settingsModalComponents.js`

### UI Components
- Extract sub-components into separate files
- Extract helper/utility functions used only by the component
- Keep the main component file focused on orchestration

## Quick Check Command

Run this to find files exceeding the limit:
```bash
find src test -name "*.js" | xargs wc -l | sort -rn | head -20
```

## Known Oversized Files (Legacy)

All previously oversized files have been split as of v5.81.0. No files currently exceed the 1,500 line limit.

**Split history (v5.81.0):**
| Original File | Was | Now | Sub-modules |
|---------------|-----|-----|-------------|
| `src/ui/components/settingsModal.js` | 3,316 | 798 | `settingsModalHelpers.js`, `settingsModalAccountCards.js` |
| `src/api/wealthsimple.js` | 2,977 | 1,038 | `wealthsimplePositions.js`, `wealthsimpleQueries.js` |
| `src/api/monarch.js` | 2,833 | 975 | `monarchTransactions.js`, `monarchAccounts.js` |
| `src/services/wealthsimple/transactions.js` | 2,613 | 1,042 | `transactionsHelpers.js`, `transactionsInvestment.js`, `transactionsReconciliation.js` |
| `src/services/wealthsimple/transactionRules.js` | 2,341 | 753 | `transactionRulesHelpers.js`, `transactionRulesInvestment.js` |
| `src/ui/components/categorySelector.js` | 1,986 | 1,020 | `categorySelectorUtils.js`, `categorySelectorManual.js` |

## Important Notes

- **NEVER** create a new file exceeding 1,500 lines
- **NEVER** add code to an existing file if it would exceed 1,500 lines without splitting first
- **ALWAYS** check file size before making additions to large files
- When reading large files for context, read in chunks (e.g., `sed -n '1,500p' file.js`) to avoid context overflow
- Prefer many small, focused files over few large monolithic files