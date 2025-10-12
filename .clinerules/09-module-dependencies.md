# Module Dependencies and Import Guidelines

## Core Principles

1. **Clear Dependency Flow** - Dependencies should flow in one direction
2. **No Circular Dependencies** - Modules should not depend on each other cyclically
3. **Minimize Coupling** - Keep modules loosely coupled
4. **Explicit Imports** - Import only what you need
5. **Consistent Organization** - Follow import ordering conventions

## Dependency Hierarchy

### Allowed Dependency Flow

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

### ✅ Correct Import Patterns

```javascript
// UI component importing service
// src/ui/questrade/components/uploadButton.js
import { processAndUploadBalance } from '../../../services/questrade/balance';
import stateManager from '../../../core/state';

// Service importing API client
// src/services/questrade/balance.js
import questradeApi from '../../api/questrade';
import { debugLog } from '../../core/utils';

// API importing core utilities
// src/api/questrade.js
import { API } from '../core/config';
import authService from '../services/questrade/auth';
```

### ❌ Prohibited Import Patterns

```javascript
// ❌ API importing UI
// src/api/questrade.js
import toast from '../ui/toast'; // WRONG - API should not know about UI

// ❌ Core/Utils importing Services
// src/core/utils.js
import { uploadBalance } from '../services/balance'; // WRONG - Utils should be independent

// ❌ API importing Services (except auth services)
// src/api/monarch.js
import { processData } from '../services/balance'; // WRONG - API should be thin
```

## Import Organization

### Standard Import Order

Organize imports in this order, with blank lines between groups:

1. External packages (if any)
2. Core modules (config, state, utils)
3. API clients
4. Services
5. UI components
6. Relative imports from same directory

```javascript
// ✅ DO: Organized imports
// External packages first (if any)
import SomeLibrary from 'some-library';

// Core modules
import { STORAGE, API } from '../core/config';
import stateManager from '../core/state';
import { debugLog, formatDate } from '../core/utils';

// API clients
import questradeApi from '../api/questrade';
import monarchApi from '../api/monarch';

// Services (only if in UI layer)
import { processAndUploadBalance } from '../services/questrade/balance';

// UI components (only if in another UI component)
import toast from './toast';

// Relative imports from same directory
import { helper } from './helpers';
```

### Named vs Default Exports

**Use named exports for:**
- Utility functions
- Multiple exports from a file
- When you want to enforce consistent naming

**Use default exports for:**
- Single primary export
- Services with multiple methods
- Components

```javascript
// ✅ DO: Named exports for utilities
// src/core/utils.js
export function debugLog(message) { /* ... */ }
export function formatDate(date) { /* ... */ }

// Usage
import { debugLog, formatDate } from '../core/utils';

// ✅ DO: Default export for services
// src/api/questrade.js
export default {
  makeApiCall,
  fetchAccounts,
  getAccount
};

// Usage
import questradeApi from '../api/questrade';
```

## Preventing Circular Dependencies

### What is a Circular Dependency?

When Module A imports Module B, and Module B imports Module A (directly or indirectly).

```javascript
// ❌ CIRCULAR DEPENDENCY
// moduleA.js
import { functionB } from './moduleB';
export function functionA() { /* uses functionB */ }

// moduleB.js
import { functionA } from './moduleA';
export function functionB() { /* uses functionA */ }
```

### How to Fix Circular Dependencies

1. **Extract Shared Logic to a Third Module**
```javascript
// ✅ DO: Extract to shared module
// shared.js
export function sharedLogic() { /* ... */ }

// moduleA.js
import { sharedLogic } from './shared';
export function functionA() { /* uses sharedLogic */ }

// moduleB.js
import { sharedLogic } from './shared';
export function functionB() { /* uses sharedLogic */ }
```

2. **Move Function to Lower Layer**
```javascript
// ❌ DON'T: Service importing from another service
// src/services/balance.js
import { formatAccount } from './account';

// ✅ DO: Move formatting to utils
// src/core/utils.js
export function formatAccount(account) { /* ... */ }

// src/services/balance.js
import { formatAccount } from '../core/utils';
```

3. **Dependency Injection**
```javascript
// ✅ DO: Pass dependencies as parameters
// src/services/balance.js
export function processBalance(accountId, accountFormatter) {
  const formatted = accountFormatter(account);
  // ...
}

// Caller provides the formatter
import { formatAccount } from './account';
processBalance(id, formatAccount);
```

## Module Coupling

### Minimize Cross-Service Dependencies

**Prefer:**
- Services importing from API layer
- Services importing from core/utils
- Services being independent of each other

**Avoid:**
- Service A importing functions from Service B
- Creating a web of service interdependencies

```javascript
// ❌ DON'T: Service importing from another service
// src/services/transactions.js
import { getAccountBalance } from './balance';

// ✅ DO: Both services use API layer independently
// src/services/transactions.js
import questradeApi from '../api/questrade';
const accountData = await questradeApi.fetchAccount(accountId);

// src/services/balance.js
import questradeApi from '../api/questrade';
const accountData = await questradeApi.fetchAccount(accountId);
```

### Shared Logic Location

When multiple services need the same logic:

1. **If it's pure logic/formatting** → `src/core/utils.js`
2. **If it's data transformation** → `src/mappers/`
3. **If it's API communication** → `src/api/`
4. **If it's configuration** → `src/core/config.js`

```javascript
// ✅ DO: Extract shared logic to appropriate location
// src/core/utils.js
export function calculatePercentageChange(oldValue, newValue) {
  if (oldValue === 0) return 0;
  return ((newValue - oldValue) / Math.abs(oldValue)) * 100;
}

// Both services can now import from utils
// src/services/balance.js
import { calculatePercentageChange } from '../core/utils';

// src/services/portfolio.js
import { calculatePercentageChange } from '../core/utils';
```

## Import Patterns to Avoid

### 1. Wildcard Imports

```javascript
// ❌ DON'T: Import everything
import * as utils from '../core/utils';
utils.debugLog('message');

// ✅ DO: Import only what you need
import { debugLog } from '../core/utils';
debugLog('message');
```

### 2. Deep Imports from node_modules (if applicable)

```javascript
// ❌ DON'T: Import from deep paths
import SomeComponent from 'library/dist/internal/components/SomeComponent';

// ✅ DO: Import from package root
import { SomeComponent } from 'library';
```

### 3. Relative Path Hell

```javascript
// ❌ DON'T: Too many parent directory references
import { something } from '../../../../../../../../utils';

// ✅ DO: If you need this many levels, consider:
// 1. Restructuring your directories
// 2. Using absolute imports (if configured in webpack)
// 3. Moving the utility closer to where it's used
```

## State Management Dependencies

### Central State Manager Pattern

Your project uses a centralized state manager. Follow these rules:

```javascript
// ✅ DO: Import state manager anywhere it's needed
// src/services/balance.js
import stateManager from '../../core/state';
stateManager.setAccount(accountId, accountName);

// src/ui/components/uploadButton.js
import stateManager from '../../../core/state';
const account = stateManager.getState().currentAccount;
```

### State Manager Should NOT Import

```javascript
// ❌ DON'T: State manager importing business logic
// src/core/state.js
import { processBalance } from '../services/balance'; // WRONG

// ✅ DO: State manager only manages state
// src/core/state.js
class StateManager {
  setBalance(balance) { /* ... */ }
  getBalance() { /* ... */ }
}
```

## Testing Imports

### Test Files Can Import Freely

Test files are allowed to import from any layer:

```javascript
// test/services/balance.test.js - This is fine
import { processBalanceData } from '../../src/services/questrade/balance';
import questradeApi from '../../src/api/questrade';
import stateManager from '../../src/core/state';
```

## Checklist for Module Organization

Before adding new imports:
- [ ] Import flows from higher layer to lower layer
- [ ] No circular dependencies exist
- [ ] Imports are organized in standard order
- [ ] Only importing what's actually needed
- [ ] Not importing from inappropriate layers
- [ ] Shared logic is extracted to appropriate common location

## Refactoring Dependency Issues

### Detecting Problems

Watch for these warning signs:
1. Difficulty tracking where functions are defined
2. Changes rippling across many unrelated files
3. Inability to test modules in isolation
4. Import chains that circle back

### Refactoring Steps

1. **Draw the dependency graph**
   - List all imports in your module
   - Trace where each import comes from
   - Identify cycles or violations

2. **Extract shared code**
   - Move common logic to lower layers
   - Create utility functions
   - Break apart overly coupled modules

3. **Verify the fix**
   - Check that imports follow the hierarchy
   - Ensure no circular dependencies remain
   - Run all tests to confirm nothing broke

## Examples from Your Codebase

### Good Patterns

```javascript
// ✅ Service properly importing API and utils
// src/services/questrade/balance.js
import questradeApi from '../../api/questrade';
import monarchApi from '../../api/monarch';
import { debugLog, formatDate } from '../../core/utils';
import stateManager from '../../core/state';

// ✅ UI component properly importing service
// src/ui/questrade/components/uploadButton.js
import { uploadAllAccountsToMonarch } from '../../../services/questrade/balance';
import toast from '../../toast';
```

### Patterns to Watch

```javascript
// ⚠️ WATCH: Auth service imported by API
// This is acceptable for auth specifically, but should be rare
// src/api/questrade.js
import authService from '../services/questrade/auth';
```

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
