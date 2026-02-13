# Function Complexity and Length Guidelines

## Mandatory Rules

### Function Length Limits
**Soft Limit: 50 lines | Hard Limit: 100 lines**

- Functions should ideally be under 50 lines
- Functions over 100 lines MUST be refactored
- Count only code lines (exclude comments and whitespace)
- If you need to create a function over 50 lines, justify why in comments

### Single Responsibility Principle
Each function must do ONE thing well:
- ✅ `fetchBalanceHistory()` - fetches balance data
- ✅ `processBalanceData()` - converts data to CSV
- ❌ `fetchAndProcessBalance()` - doing too much (should be split)

### Complexity Indicators
Watch for these signs that a function needs refactoring:
- **Multiple levels of nesting** (>3 levels deep)
- **Many parameters** (>5 parameters suggests poor design)
- **Long parameter lists** (consider using options object)
- **Multiple return points** that make logic hard to follow
- **Repetitive code blocks** that should be extracted

## Refactoring Guidelines

- Extract complex nested logic into named helper functions
- Use early returns to flatten deeply nested code
- Extract loop bodies into dedicated functions when they're complex
- Use options objects for functions with >5 parameters
- Destructure parameters at function entry for clarity
- Group related operations within functions with blank lines and comments