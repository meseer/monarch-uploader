# Code Duplication Guidelines

## Philosophy: Pragmatic DRY

**Balance simplicity with reusability — don't over-engineer to avoid all duplication.**

## When to Extract vs When to Duplicate

### Extract when:
- Complex logic appears **3+ times** (Rule of Three)
- Same logic appears **2+ times** AND is complex (validation, business rules, data transformations)
- Changes to one instance should always apply to all others
- The logic represents a clear, reusable concept with a good name

### Allow duplication when:
- Simple expressions in 1-2 places (e.g., `$${value.toFixed(2)}`)
- Similar structure but **different semantics** (different business meaning, likely to evolve differently)
- Extracting would make code harder to understand than the duplication

## Extraction Placement

| What to extract | Where to put it |
|----------------|-----------------|
| Pure logic/formatting | `src/core/utils.js` |
| Data transformation | `src/mappers/` |
| API communication | `src/api/` |
| Configuration values / magic numbers | `src/core/config.js` |
| Domain helpers used in one file only | Same file as a helper function |

## Anti-patterns to Avoid

- **Premature abstraction**: Don't create abstractions for 2 uses with unclear future
- **Unnecessary parameterization**: Don't over-parameterize for speculative flexibility
- **God functions**: Don't create one function that does everything with flags — use separate focused functions