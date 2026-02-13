# HTML Element ID Guidelines

## Core Principle

**ALWAYS add meaningful IDs to HTML elements created in JavaScript.**

IDs improve testability, debugging, maintainability, and accessibility.

## When to Add IDs

**You MUST add IDs to:**
- All modal overlays and dialogs
- All interactive elements (buttons, inputs, selects)
- All containers that hold dynamic content
- All list items in dynamically generated lists
- All major structural elements (headers, sections, footers)

## ID Naming Conventions

### Format: kebab-case
```javascript
// ✅ DO
element.id = 'security-selector-modal';
// ❌ DON'T
element.id = 'SecuritySelectorModal';  // PascalCase
element.id = 'security_selector_modal'; // snake_case
```

### Namespace by Component
Group related element IDs by component/feature name:
- `{component}-overlay`, `{component}-modal`, `{component}-header`
- `{feature}-{action}-button`, `{feature}-{field}-input`
- `{feature}-item-{uniqueId}` for list items

### Unique IDs for List Items
Use a unique identifier from data or index:
```javascript
item.id = `security-item-${security.id}`;
```

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

## Common Pitfalls

- ❌ Generic IDs: `div1`, `button`, `wrapper`
- ❌ Duplicate IDs across list items (use unique suffix)
- ❌ Skipping IDs for "simple" elements — all interactive elements need IDs