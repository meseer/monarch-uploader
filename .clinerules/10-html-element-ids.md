# HTML Element ID Guidelines

## Core Principle

**ALWAYS add meaningful IDs to HTML elements created in JavaScript.**

IDs improve:
- Testability - Easy to select elements in tests
- Debugging - Quick identification in browser DevTools
- Maintainability - Clear understanding of element purpose
- Accessibility - Better screen reader support

## Mandatory ID Usage

### When to Add IDs

**You MUST add IDs to:**
- All modal overlays and dialogs
- All interactive elements (buttons, inputs, selects)
- All containers that hold dynamic content
- All list items in dynamically generated lists
- All major structural elements (headers, sections, footers)
- All elements that may need to be accessed programmatically
- All elements that represent distinct UI components

**Examples of elements requiring IDs:**
```javascript
// Modals and overlays
overlay.id = 'security-selector-overlay';
modal.id = 'security-selector-modal';

// Interactive elements
button.id = 'submit-button';
input.id = 'search-input';
select.id = 'account-selector';

// Containers
resultsContainer.id = 'search-results';
headerContainer.id = 'page-header';

// List items with unique identifiers
item.id = `security-item-${security.id}`;
row.id = `transaction-row-${transaction.id}`;
```

## ID Naming Conventions

### Format: kebab-case

Always use kebab-case (lowercase with hyphens):

```javascript
// ✅ DO: Use kebab-case
element.id = 'security-selector-modal';
element.id = 'upload-button';
element.id = 'account-list-container';

// ❌ DON'T: Other formats
element.id = 'SecuritySelectorModal';  // PascalCase
element.id = 'securitySelectorModal';  // camelCase
element.id = 'security_selector_modal'; // snake_case
```

### Descriptive Names

IDs should clearly describe:
1. **What** the element is (button, container, input, etc.)
2. **Where** it belongs (which component/feature)
3. **What it does** (if action-oriented)

```javascript
// ✅ DO: Descriptive IDs
'security-selector-search-input'  // What: input, Where: security selector, Does: search
'account-upload-button'           // What: button, Where: account, Does: upload
'transaction-list-container'      // What: container, Where: transaction list
'balance-history-chart'           // What: chart, Where: balance history

// ❌ DON'T: Vague IDs
'input1'
'div-container'
'button'
'wrapper'
```

### Unique IDs for List Items

When creating multiple similar elements (list items, rows, etc.), use a unique identifier:

```javascript
// ✅ DO: Include unique ID from data
securities.forEach((security) => {
  const item = document.createElement('div');
  item.id = `security-item-${security.id}`;
  
  const logo = document.createElement('img');
  logo.id = `security-logo-${security.id}`;
  
  const name = document.createElement('div');
  name.id = `security-name-${security.id}`;
});

// ✅ DO: Use index if no unique ID available
transactions.forEach((transaction, index) => {
  const row = document.createElement('tr');
  row.id = `transaction-row-${index}`;
});
```

### Namespace by Component

Group related element IDs by component/feature name:

```javascript
// Security Selector component
'security-selector-overlay'
'security-selector-modal'
'security-selector-header'
'security-selector-search-input'
'security-selector-results'
'security-selector-cancel'

// Account Upload component
'account-upload-button'
'account-upload-progress'
'account-upload-status'
'account-upload-error'
```

## ID Structure Patterns

### Modal Components

```javascript
// Overlay
overlay.id = '{component-name}-overlay';

// Modal container
modal.id = '{component-name}-modal';

// Modal parts
header.id = '{component-name}-header';
content.id = '{component-name}-content';
footer.id = '{component-name}-footer';
closeButton.id = '{component-name}-close';
cancelButton.id = '{component-name}-cancel';
confirmButton.id = '{component-name}-confirm';
```

### Form Elements

```javascript
// Container
form.id = '{feature-name}-form';

// Inputs
input.id = '{feature-name}-{field-name}-input';
select.id = '{feature-name}-{field-name}-select';
textarea.id = '{feature-name}-{field-name}-textarea';

// Labels
label.id = '{feature-name}-{field-name}-label';

// Error messages
error.id = '{feature-name}-{field-name}-error';
```

### List Items

```javascript
// Container
list.id = '{feature-name}-list';

// Individual items
item.id = `{feature-name}-item-${uniqueId}`;

// Item parts
itemName.id = `{feature-name}-item-name-${uniqueId}`;
itemPrice.id = `{feature-name}-item-price-${uniqueId}`;
itemActions.id = `{feature-name}-item-actions-${uniqueId}`;
```

## Testing Considerations

IDs make testing significantly easier:

```javascript
// Tests can easily select elements
test('displays security name', () => {
  const nameElement = document.getElementById('security-name-123');
  expect(nameElement.textContent).toBe('Apple Inc.');
});

test('shows loading indicator during search', async () => {
  const loading = document.getElementById('security-selector-loading');
  expect(loading.style.display).toBe('block');
});
```

## Common Pitfalls to Avoid

### ❌ DON'T: Generic or Auto-generated IDs

```javascript
// ❌ Bad - meaningless
element.id = 'div1';
element.id = 'element-' + Math.random();
element.id = 'temp';

// ✅ Good - meaningful
element.id = 'security-search-results';
element.id = `account-item-${account.id}`;
element.id = 'balance-upload-button';
```

### ❌ DON'T: Duplicate IDs

```javascript
// ❌ Bad - same ID for multiple elements
items.forEach(item => {
  const div = document.createElement('div');
  div.id = 'item'; // Duplicate!
});

// ✅ Good - unique IDs
items.forEach(item => {
  const div = document.createElement('div');
  div.id = `item-${item.id}`; // Unique
});
```

### ❌ DON'T: Skip IDs for "Simple" Elements

```javascript
// ❌ Bad - missing IDs
const button = document.createElement('button');
button.textContent = 'Submit';
// No ID added

// ✅ Good - all interactive elements have IDs
const button = document.createElement('button');
button.id = 'form-submit-button';
button.textContent = 'Submit';
```

## Examples from the Codebase

### Security Selector Component

```javascript
// Modal structure
overlay.id = 'security-selector-overlay';
modal.id = 'security-selector-modal';
header.id = 'security-selector-header';
securityDetails.id = 'security-selector-details';

// Search functionality
searchContainer.id = 'security-selector-search-container';
searchInput.id = 'security-selector-search-input';
loadingIndicator.id = 'security-selector-loading';
resultsContainer.id = 'security-selector-results';

// Actions
cancelBtn.id = 'security-selector-cancel';

// List items (each security)
item.id = `security-item-${security.id}`;
logoContainer.id = `security-logo-container-${security.id}`;
logoImg.id = `security-logo-img-${security.id}`;
fallback.id = `security-logo-fallback-${security.id}`;
infoContainer.id = `security-info-${security.id}`;
nameDiv.id = `security-name-${security.id}`;
detailsDiv.id = `security-details-${security.id}`;
priceContainer.id = `security-price-container-${security.id}`;
priceDiv.id = `security-price-${security.id}`;
changeDiv.id = `security-price-change-${security.id}`;
```

## Checklist for Adding IDs

Before committing UI code, verify:
- [ ] All modals/overlays have IDs
- [ ] All interactive elements (buttons, inputs, etc.) have IDs
- [ ] All containers holding dynamic content have IDs
- [ ] All list items have unique IDs
- [ ] All IDs use kebab-case
- [ ] All IDs are descriptive and meaningful
- [ ] No duplicate IDs exist
- [ ] IDs follow the component namespace pattern

## Quick Reference

| Element Type | ID Pattern | Example |
|--------------|-----------|---------|
| Modal overlay | `{component}-overlay` | `security-selector-overlay` |
| Modal container | `{component}-modal` | `security-selector-modal` |
| Button | `{feature}-{action}-button` | `account-upload-button` |
| Input | `{feature}-{field}-input` | `security-search-input` |
| Container | `{feature}-{content}-container` | `search-results-container` |
| List item | `{feature}-item-{id}` | `security-item-123` |
| Item sub-element | `{feature}-{part}-{id}` | `security-name-123` |

## Important Notes

- **NEVER skip IDs** - They're essential for maintainability
- **Be consistent** - Follow the established patterns in the codebase
- **Think about testing** - IDs should make elements easy to find in tests
- **Use semantic names** - Someone reading the ID should understand what the element does
- **Document changes** - If you establish a new ID pattern for a component, document it in comments
