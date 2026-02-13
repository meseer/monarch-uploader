# Module Dependencies and Import Guidelines

## Dependency Hierarchy

```
UI Layer (src/ui/)
    ↓ can import
Services Layer (src/services/)
    ↓ can import
API Layer (src/api/)
    ↓ can import
Core/Utils (src/core/, src/utils/)
    ↓ can import
Config (src/core/config.js)
```

**Golden Rules:**
- Higher layers CAN import from lower layers
- Lower layers CANNOT import from higher layers
- Lateral imports within the same layer should be minimized
- Exception: API layer may import auth services

## Quick Reference

| Import From → To | Allowed? | Notes |
|------------------|----------|-------|
| UI → Services | ✅ Yes | Standard pattern |
| UI → API | ❌ No | Use services instead |
| Services → API | ✅ Yes | Standard pattern |
| Services → Services | ⚠️ Minimize | Extract to utils if possible |
| API → Services | ❌ No* | *Except auth services |
| API → UI | ❌ Never | Severe violation |
| Utils → Services | ❌ Never | Utils must be independent |
| Anywhere → Utils | ✅ Yes | Utils are foundation |
| Anywhere → Config | ✅ Yes | Config is foundation |
| Anywhere → State | ✅ Yes | Centralized state is OK |

## Import Organization

Organize imports in this order, with blank lines between groups:
1. External packages (if any)
2. Core modules (config, state, utils)
3. API clients
4. Services
5. UI components
6. Relative imports from same directory

## Export Conventions

- **Named exports** for utility functions and multiple exports per file
- **Default exports** for single primary exports, services, and components

## Preventing Circular Dependencies

- If Module A and Module B need each other, extract shared logic to a third module
- Move shared functions to lower layers (`src/core/utils.js`)
- Use dependency injection (pass dependencies as parameters) when needed

## Shared Logic Placement

| What | Where |
|------|-------|
| Pure logic/formatting | `src/core/utils.js` |
| Data transformation | `src/mappers/` |
| API communication | `src/api/` |
| Configuration | `src/core/config.js` |

## State Manager Rules

- State manager (`src/core/state.js`) can be imported anywhere
- State manager itself MUST NOT import from services, API, or UI layers