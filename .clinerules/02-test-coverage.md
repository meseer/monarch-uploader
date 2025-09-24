# Test Coverage Requirements

## Mandatory Test Coverage

### When Adding New Features
**You MUST add test coverage for:**
- All new functions and methods
- New UI components (if testable)
- New service methods
- New API integrations
- New utility functions
- Edge cases and error scenarios

### When Modifying Existing Code
**You MUST update tests when:**
- Changing function behavior
- Modifying method signatures
- Updating business logic
- Refactoring existing code
- Fixing bugs (add regression tests)

## Test File Locations

Map your code changes to the appropriate test files:

| Source File Location | Test File Location |
|---------------------|-------------------|
| `src/api/*.js` | `test/api/*.test.js` |
| `src/core/*.js` | `test/core/*.test.js` |
| `src/services/*.js` | `test/services/*.test.js` |
| `src/ui/components/*.js` | `test/ui/*.test.js` |
| `src/utils/*.js` | `test/utils/*.test.js` |

## Test Writing Guidelines

### Structure
- Use descriptive test names that explain what is being tested
- Group related tests using `describe` blocks
- Follow the Arrange-Act-Assert pattern
- Mock external dependencies appropriately

### Coverage Requirements
- Aim for meaningful test coverage, not just high percentages
- Test happy paths and error scenarios
- Include edge cases and boundary conditions
- Verify error handling and validation

### Running Tests
Before considering any task complete:
1. Run `npm test` to execute all tests
2. Ensure all tests pass
3. Verify new functionality is covered
4. Check that modified code still passes existing tests

## Examples

### Adding a New Function
```javascript
// If you add a new function in src/utils/formatter.js
export function formatCurrency(amount) {
  // implementation
}

// You MUST add tests in test/utils/formatter.test.js
describe('formatCurrency', () => {
  test('formats positive amounts correctly', () => {
    expect(formatCurrency(100)).toBe('$100.00');
  });
  
  test('handles negative amounts', () => {
    expect(formatCurrency(-50)).toBe('-$50.00');
  });
  
  test('handles zero', () => {
    expect(formatCurrency(0)).toBe('$0.00');
  });
});
```

### Modifying Existing Code
```javascript
// If you modify an existing function's behavior
// You MUST update its tests to reflect the new behavior
// AND ensure backward compatibility tests still pass
```

## Important Notes
- Never skip tests for "simple" functions - they often hide edge cases
- If a component/function is hard to test, consider refactoring for testability
- Use the existing test setup in `test/setup.js`
- Follow the testing patterns established in the existing test files
