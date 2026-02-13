# Error Handling Standards

## Core Principles

1. **Fail Fast** — Detect and report errors as early as possible
2. **Be Specific** — Provide clear, actionable error messages
3. **Propagate Properly** — Let errors bubble up through layers appropriately
4. **User-Friendly** — Show helpful messages to users via toast, technical details in `debugLog`
5. **Consistent Patterns** — Use the same error handling patterns throughout

## Project-Specific Patterns

### User-Facing vs Developer Messages
- **User-facing**: Use `toast.show('Friendly message', 'error')` — no technical jargon
- **Developer**: Use `debugLog('Technical details:', error)` — include context (accountId, endpoint, etc.)

### Custom Error Classes
Create custom error classes only for domain-specific errors needing special handling (e.g., `BalanceError` with `accountId`). Don't create error classes for trivial validations — use standard `Error`.

### API Error Handling
- Handle specific HTTP status codes (401 → clear auth, 404 → resource not found, 500+ → server error)
- On 401, clear stored auth tokens and prompt re-login
- Use `GM_xmlhttpRequest` `onerror` for network failures

### Error Propagation
- **Low-level functions** (API, utilities): Throw errors with context
- **Mid-level functions** (services): Catch per-item errors in bulk operations, continue processing remaining items
- **High-level functions** (UI entry points): Catch all, show user-friendly toast, log technical details

### Validation
- Validate inputs early with guard clauses and throw descriptive errors
- Use early returns to flatten deeply nested code

## Anti-patterns to Avoid

- **Swallowing errors silently** — empty catch blocks
- **Catch-and-rethrow without adding value** — pointless catch blocks
- **Vague error messages** — "Something went wrong" or "Error"
- **Using errors for control flow** — use null checks instead