# Test Coverage Requirements

## Mandatory Test Coverage

- **New functions/methods**: Must have tests covering happy paths, error scenarios, and edge cases
- **Modified code**: Update existing tests to reflect new behavior; add regression tests for bug fixes
- **New UI components, services, API integrations, utilities**: All require test coverage

## Test File Locations

| Source Location | Test Location |
|----------------|--------------|
| `src/api/*.js` | `test/api/*.test.js` |
| `src/core/*.js` | `test/core/*.test.js` |
| `src/services/*.js` | `test/services/*.test.js` |
| `src/ui/components/*.js` | `test/ui/*.test.js` |
| `src/utils/*.js` | `test/utils/*.test.js` |

## Guidelines

- Use descriptive test names; group with `describe` blocks; follow Arrange-Act-Assert
- Mock external dependencies; use existing setup in `test/setup.js`
- Follow testing patterns established in existing test files
- Run `npm test` before marking any task complete  all tests must pass