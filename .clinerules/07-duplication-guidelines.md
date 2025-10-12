# Code Duplication Guidelines

## Philosophy: Pragmatic DRY (Don't Repeat Yourself)

**Balance simplicity with reusability - don't over-engineer to avoid all duplication.**

### Core Principle
Duplication is acceptable when:
- The duplicated code is simple and clear
- Extracting would add unnecessary complexity
- The code serves different contexts with different likely evolution paths
- It appears in only 1-2 places

Duplication should be eliminated when:
- The same complex logic appears 3+ times
- Changes to one instance should always apply to others
- The logic represents a clear, reusable concept
- Bugs in one place should be fixed in all places

## When to Extract vs When to Duplicate

### ✅ DO Extract When:

1. **Complex Business Logic Repeated 3+ Times**
```javascript
// ❌ DON'T: Complex calculation duplicated
function processAccountA(data) {
  const taxRate = data.province === 'ON' ? 0.13 : 0.12;
  const afterTax = data.amount * (1 - taxRate);
  const fee = afterTax * 0.015;
  return afterTax - fee;
}

function processAccountB(data) {
  const taxRate = data.province === 'ON' ? 0.13 : 0.12;
  const afterTax = data.amount * (1 - taxRate);
  const fee = afterTax * 0.015;
  return afterTax - fee;
}

// ✅ DO: Extract complex calculation
function calculateNetAmount(amount, province) {
  const taxRate = province === 'ON' ? 0.13 : 0.12;
  const afterTax = amount * (1 - taxRate);
  const fee = afterTax * 0.015;
  return afterTax - fee;
}

function processAccountA(data) {
  return calculateNetAmount(data.amount, data.province);
}

function processAccountB(data) {
  return calculateNetAmount(data.amount, data.province);
}
```

2. **Validation Logic**
```javascript
// ❌ DON'T: Duplicate validation
function uploadBalance(accountId, data) {
  if (!accountId || typeof accountId !== 'string') {
    throw new Error('Invalid account ID');
  }
  if (!data || !Array.isArray(data)) {
    throw new Error('Invalid data');
  }
  // ... rest of function
}

function uploadTransactions(accountId, transactions) {
  if (!accountId || typeof accountId !== 'string') {
    throw new Error('Invalid account ID');
  }
  // ... rest of function
}

// ✅ DO: Extract validation
function validateAccountId(accountId) {
  if (!accountId || typeof accountId !== 'string') {
    throw new Error('Invalid account ID');
  }
}

function uploadBalance(accountId, data) {
  validateAccountId(accountId);
  if (!data || !Array.isArray(data)) {
    throw new Error('Invalid data');
  }
  // ... rest of function
}

function uploadTransactions(accountId, transactions) {
  validateAccountId(accountId);
  // ... rest of function
}
```

3. **Data Transformation Patterns**
```javascript
// ✅ DO: Extract when transformation is complex or reused
function formatCurrency(amount, currencyCode = 'CAD') {
  const formatter = new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: currencyCode
  });
  return formatter.format(amount);
}

// Use in multiple places
const balanceDisplay = formatCurrency(balance.amount);
const feeDisplay = formatCurrency(fee.amount);
```

### ✅ DO Allow Duplication When:

1. **Simple, Context-Specific Logic**
```javascript
// ✅ ACCEPTABLE: Simple formatting specific to each context
function displayAccountBalance(balance) {
  return `Balance: $${balance.toFixed(2)}`;
}

function displayTransactionAmount(amount) {
  return `Amount: $${amount.toFixed(2)}`;
}

// No need to extract - the formatting is trivial and contexts differ
```

2. **Similar Structure but Different Semantics**
```javascript
// ✅ ACCEPTABLE: Similar code but different business meaning
function validateAccountForUpload(account) {
  if (!account.id) return false;
  if (!account.type) return false;
  if (account.balance < 0) return false;  // Must have positive balance for upload
  return true;
}

function validateAccountForDisplay(account) {
  if (!account.id) return false;
  if (!account.type) return false;
  if (account.balance === undefined) return false;  // Balance can be negative for display
  return true;
}

// Don't combine - they serve different purposes and may evolve differently
```

3. **Configuration Objects**
```javascript
// ✅ ACCEPTABLE: Similar config objects in different contexts
const questradeConfig = {
  baseUrl: 'https://api.questrade.com',
  timeout: 30000,
  retries: 3
};

const monarchConfig = {
  baseUrl: 'https://api.monarch.com',
  timeout: 30000,
  retries: 3
};

// Don't over-engineer a "createApiConfig" function unless you have 5+ APIs
```

## Extraction Patterns

### 1. Utility Functions
Place in `src/utils/` or `src/core/utils.js` for widely-used helpers:

```javascript
// src/core/utils.js
export function isValidDate(dateString) {
  const date = new Date(dateString);
  return date instanceof Date && !isNaN(date.getTime());
}

export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
```

### 2. Domain-Specific Helpers
Keep within the same module if only used there:

```javascript
// src/services/balance.js

// Helper used only in this file
function calculateDailyAverage(balances) {
  const total = balances.reduce((sum, b) => sum + b.amount, 0);
  return total / balances.length;
}

export function getBalanceSummary(accountId) {
  const balances = fetchBalances(accountId);
  const average = calculateDailyAverage(balances);
  // ... use average
}
```

### 3. Shared Constants
Extract to configuration files:

```javascript
// ❌ DON'T: Magic numbers scattered throughout
function calculateFee(amount) {
  return amount * 0.015;  // What is this number?
}

function estimateTax(amount) {
  return amount * 0.13;  // What is this number?
}

// ✅ DO: Named constants
// src/core/config.js
export const FEES = {
  TRANSACTION_FEE_RATE: 0.015,
  TAX_RATE_ON: 0.13,
  TAX_RATE_BC: 0.12
};

// Usage
import { FEES } from '../core/config';

function calculateFee(amount) {
  return amount * FEES.TRANSACTION_FEE_RATE;
}
```

## Signs You're Over-Engineering

Watch for these anti-patterns:

### 1. Premature Abstraction
```javascript
// ❌ DON'T: Create abstraction for 2 uses with unclear future
function createFormatter(prefix, suffix, precision) {
  return (value) => `${prefix}${value.toFixed(precision)}${suffix}`;
}

const currencyFormatter = createFormatter('$', '', 2);
const percentFormatter = createFormatter('', '%', 1);

// ✅ DO: Keep it simple until you need 3+ instances
function formatCurrency(value) {
  return `$${value.toFixed(2)}`;
}

function formatPercent(value) {
  return `${value.toFixed(1)}%`;
}
```

### 2. Unnecessary Parameterization
```javascript
// ❌ DON'T: Over-parameterize for unclear flexibility
function processData(data, sortKey, filterFn, mapFn, reduceFn) {
  return data
    .sort((a, b) => a[sortKey] - b[sortKey])
    .filter(filterFn)
    .map(mapFn)
    .reduce(reduceFn);
}

// ✅ DO: Specific functions for specific needs
function getActiveAccountBalances(accounts) {
  return accounts
    .filter(acc => acc.status === 'active')
    .map(acc => acc.balance);
}
```

### 3. God Functions
```javascript
// ❌ DON'T: One function that does everything with flags
function processAccount(account, options = {}) {
  if (options.validate) {
    // validation logic
  }
  if (options.transform) {
    // transformation logic
  }
  if (options.upload) {
    // upload logic
  }
  if (options.notify) {
    // notification logic
  }
}

// ✅ DO: Separate concerns into focused functions
function validateAccount(account) { /* ... */ }
function transformAccountData(account) { /* ... */ }
function uploadAccount(account) { /* ... */ }
function notifyUploadComplete(account) { /* ... */ }
```

## Decision Framework

Ask these questions when you see duplication:

1. **Is it actually the same?**
   - Does it have the same business meaning?
   - Will changes to one always apply to the other?

2. **How complex is it?**
   - Is it a simple expression or complex logic?
   - Would bugs here be hard to track down?

3. **How many times does it appear?**
   - 2 times: Probably leave it
   - 3 times: Consider extracting if complex
   - 4+ times: Definitely extract

4. **Would extraction make it clearer?**
   - Does extraction give it a meaningful name?
   - Or would the abstraction be harder to understand?

5. **How stable is it?**
   - Is this code likely to change?
   - Do changes need to be synchronized?

## Quick Reference

| Scenario | Action |
|----------|--------|
| Simple expression, 2 instances | Keep duplicated |
| Simple expression, 3+ instances | Consider extracting if it adds clarity |
| Complex logic, 2 instances | Consider extracting |
| Complex logic, 3+ instances | Extract |
| Validation logic, 2+ instances | Extract |
| Business rule, 2+ instances | Extract |
| Configuration values | Extract to constants |
| Similar but different semantics | Keep separate |
| Copied for "just in case" modification | Delete duplicate until actually needed |

## Checklist Before Extracting

Before creating a shared function/util, verify:
- [ ] Logic appears in 3+ places OR is complex and appears in 2+ places
- [ ] All instances serve the same business purpose
- [ ] Extraction will have a clear, descriptive name
- [ ] The abstraction won't be harder to understand than duplication
- [ ] Future changes should logically apply to all instances
- [ ] You're not creating it "just in case" it's needed later

## Important Notes

- **Favor clarity over cleverness** - Simple duplication beats complex abstraction
- **Extract when you have 3 examples** - Not before (Rule of Three)
- **Name it well** - If you can't name it clearly, maybe it shouldn't be extracted
- **Keep it cohesive** - Extracted code should have a single, clear purpose
- **Don't fear duplication** - It's not always evil, sometimes it's honest
