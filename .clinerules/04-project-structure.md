# Project Structure Conventions

## Mandatory Guidelines

### Always Read Project Documentation First
**Before making any changes, you MUST:**
1. Read the `VERSIONING.md` file in the project root
2. Review the `README.md` for project overview and setup
3. Check existing code patterns in similar files
4. Follow established conventions throughout the project

## Project Architecture

Follow the established directory structure:

```
src/
├── api/           # API clients for external services
├── core/          # Core modules (config, state, utils)
├── services/      # Business logic and data processing
├── ui/            # User interface components
│   ├── components/    # Reusable UI components
│   ├── modals/       # Modal dialog components
│   └── [institution]/ # Institution-specific UI
├── mappers/       # Data transformation utilities
└── utils/         # General utility functions
```

## File Organization Rules

### Adding New Features
- Place API clients in `src/api/`
- Business logic goes in `src/services/`
- UI components belong in `src/ui/components/`
- Utility functions go in `src/utils/`
- Institution-specific UI goes in `src/ui/[institution]/`

### Naming Conventions
- Use camelCase for file names and function names
- Use PascalCase for class names
- Use kebab-case for CSS classes
- Descriptive names that clearly indicate purpose

## Code Standards

### JavaScript/ES6
- Use ES6+ features (arrow functions, destructuring, template literals)
- Prefer `const` over `let`, avoid `var`
- Use async/await for asynchronous operations
- Add JSDoc comments for public functions

### Module Imports
- Order imports: external packages first, then local modules
- Group imports by type
- Use absolute imports from `src/` directory

### Error Handling
- Always handle errors appropriately
- Use try-catch blocks for async operations
- Provide meaningful error messages
- Log errors for debugging

## UI Development

### Component Structure
- Keep components focused and single-purpose
- Extract reusable logic into separate functions
- Use existing UI utilities (toast, modals, etc.)
- Follow existing component patterns

### Styling
- Maintain consistency with existing styles
- Use the project's established CSS patterns
- Ensure responsive design where applicable

## Testing Requirements

### Test Files
- Mirror source structure in `test/` directory
- Name test files as `[filename].test.js`
- Group related tests in describe blocks
- Follow existing test patterns

## Important Reminders

- **ALWAYS** update version numbers after changes
- **ALWAYS** add tests for new functionality
- **ALWAYS** run full build validation before completion
- **ALWAYS** maintain backward compatibility unless explicitly breaking
- **NEVER** skip the build validation process
- **NEVER** leave console.log statements in production code

## Checklist for New Features

Before submitting any new feature:
- [ ] Code follows project structure
- [ ] Tests added/updated
- [ ] Version numbers updated
- [ ] Build validation passes
- [ ] Documentation updated if needed
- [ ] No linting errors or warnings
- [ ] Error handling implemented