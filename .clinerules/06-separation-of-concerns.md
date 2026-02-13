# Separation of Concerns Guidelines

## Mandatory Layer Responsibilities

### API Layer (`src/api/`)
**ONLY responsible for HTTP communication**
- Make HTTP requests using GM_xmlhttpRequest
- Handle HTTP-level errors (401, 500, etc.)
- Parse JSON responses, add authentication headers
- Return raw data to callers
- **DO NOT**: Process business data, make UI updates, manage state, or contain business logic

### Services Layer (`src/services/`)
**Contains ALL business logic and coordinates operations**
- Orchestrate multiple API calls
- Transform and validate data, apply business rules
- Handle domain-specific errors
- Coordinate between different modules
- **DO NOT**: Make direct HTTP requests (use API layer), create/manipulate DOM elements

### UI Layer (`src/ui/`)
**ONLY handles presentation and user interaction**
- Create and manipulate DOM elements
- Handle user events (clicks, inputs)
- Show notifications and dialogs, update visual state
- Format data for display
- **DO NOT**: Contain business logic, make API calls directly, perform data transformations

### State Management (`src/core/state.js`)
**Centralized state management ONLY**
- Manage application-wide state, provide getters and setters
- **DO NOT**: Contain business logic, make API calls, or manipulate DOM

## Layer Communication Rules

### Dependency Flow
```
UI Layer → Services Layer → API Layer → Core/Utils
```

- Upper layers can import from lower layers
- Lower layers CANNOT import from upper layers
- Peer layers should minimize cross-dependencies

### Exception: Notifications
Toast notifications from service layers are acceptable for user feedback, but prefer returning status and letting the caller handle notifications when possible.