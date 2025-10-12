# Separation of Concerns Guidelines

## Mandatory Layer Responsibilities

### API Layer (`src/api/`)
**ONLY responsible for HTTP communication**

✅ **DO:**
- Make HTTP requests using GM_xmlhttpRequest
- Handle HTTP-level errors (401, 500, etc.)
- Parse JSON responses
- Add authentication headers
- Return raw data to callers

❌ **DON'T:**
- Process or transform business data
- Make UI updates or show notifications
- Manage application state
- Contain business logic
- Handle domain-specific errors

**Example - Good API Client:**
```javascript
// ✅ DO: Thin wrapper, just HTTP communication
export async function makeQuestradeApiCall(endpoint) {
  const authStatus = authService.checkQuestradeAuth();
  if (!authStatus.authenticated) {
    throw new Error('Questrade auth token not found');
  }

  const fullUrl = `${API.QUESTRADE_BASE_URL}${endpoint}`;
  
  return new Promise((resolve, reject) => {
    GM_xmlhttpRequest({
      method: 'GET',
      url: fullUrl,
      headers: { Authorization: authStatus.token },
      onload: (res) => {
        if (res.status >= 200 && res.status < 300) {
          resolve(JSON.parse(res.responseText));
        } else {
          reject(new Error(`API Error: status ${res.status}`));
        }
      },
      onerror: (err) => reject(new Error('Network error'))
    });
  });
}
```

**Example - Bad API Client:**
```javascript
// ❌ DON'T: Business logic and UI updates in API layer
export async function fetchAccountBalance(accountId) {
  const response = await makeApiCall(`/accounts/${accountId}/balance`);
  
  // ❌ Business logic doesn't belong here
  const cadBalance = response.balances.find(b => b.currency === 'CAD');
  const formattedBalance = `$${cadBalance.amount.toFixed(2)}`;
  
  // ❌ UI updates don't belong here
  toast.show('Balance loaded successfully', 'info');
  stateManager.setBalance(formattedBalance);
  
  return formattedBalance;
}
```

### Services Layer (`src/services/`)
**Contains ALL business logic and coordinates operations**

✅ **DO:**
- Orchestrate multiple API calls
- Transform and validate data
- Apply business rules
- Handle domain-specific errors
- Coordinate between different modules
- Manage complex workflows

❌ **DON'T:**
- Make direct HTTP requests (use API layer)
- Create or manipulate DOM elements
- Show UI notifications directly (return status instead)
- Depend on UI-specific logic

**Example - Good Service:**
```javascript
// ✅ DO: Business logic, coordinates API and state
export async function processAndUploadBalance(accountId, accountName, fromDate, toDate) {
  try {
    // Set context
    stateManager.setAccount(accountId, accountName);
    
    // Fetch data via API layer
    const balanceData = await questradeApi.fetchBalanceHistory(accountId, fromDate, toDate);
    
    // Apply business logic
    const csvData = processBalanceData(balanceData, accountName);
    
    // Validate
    if (!csvData || csvData.length === 0) {
      throw new BalanceError('No data to upload', accountId);
    }
    
    // Upload via API layer
    const success = await monarchApi.uploadBalance(accountId, csvData, fromDate, toDate);
    
    // Update state
    if (success) {
      storeDateRange(accountId, toDate);
    }
    
    return success;
  } catch (error) {
    debugLog(`Error processing account ${accountId}:`, error);
    throw error;
  }
}
```

**Example - Bad Service:**
```javascript
// ❌ DON'T: Direct HTTP requests and DOM manipulation in service
export async function uploadBalance(accountId) {
  // ❌ Direct HTTP request - should use API layer
  const response = await GM_xmlhttpRequest({
    method: 'POST',
    url: 'https://api.example.com/upload',
    data: csvData
  });
  
  // ❌ DOM manipulation - should be in UI layer
  document.getElementById('status').textContent = 'Upload complete';
  document.querySelector('.progress').style.width = '100%';
  
  return response;
}
```

### UI Layer (`src/ui/`)
**ONLY handles presentation and user interaction**

✅ **DO:**
- Create and manipulate DOM elements
- Handle user events (clicks, inputs)
- Show notifications and dialogs
- Update visual state
- Format data for display

❌ **DON'T:**
- Contain business logic
- Make API calls directly
- Perform data transformations
- Manage application state (except local UI state)

**Example - Good UI Component:**
```javascript
// ✅ DO: Pure presentation, delegates actions to services
export async function initUploadButton() {
  const button = document.createElement('button');
  button.textContent = 'Upload Balance';
  button.className = 'upload-btn';
  
  button.addEventListener('click', async () => {
    try {
      // Show loading state
      button.disabled = true;
      button.textContent = 'Uploading...';
      
      // Delegate to service layer
      const account = stateManager.getState().currentAccount;
      const success = await balanceService.processAndUploadBalance(
        account.id,
        account.name,
        fromDate,
        toDate
      );
      
      // Update UI based on result
      if (success) {
        toast.show('Upload successful', 'info');
      } else {
        toast.show('Upload failed', 'error');
      }
    } catch (error) {
      toast.show(`Error: ${error.message}`, 'error');
    } finally {
      button.disabled = false;
      button.textContent = 'Upload Balance';
    }
  });
  
  return button;
}
```

**Example - Bad UI Component:**
```javascript
// ❌ DON'T: Business logic and API calls in UI
export async function initUploadButton() {
  const button = document.createElement('button');
  
  button.addEventListener('click', async () => {
    // ❌ Business logic in UI layer
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - 90);
    
    // ❌ Direct API call from UI
    const response = await GM_xmlhttpRequest({
      url: 'https://api.questrade.com/balance',
      method: 'GET'
    });
    
    // ❌ Data transformation in UI
    const cadBalance = response.balances
      .filter(b => b.currency === 'CAD')
      .reduce((sum, b) => sum + b.amount, 0);
    
    // ❌ Another direct API call
    await GM_xmlhttpRequest({
      url: 'https://api.monarch.com/upload',
      method: 'POST',
      data: cadBalance
    });
  });
  
  return button;
}
```

### State Management (`src/core/state.js`)
**Centralized state management ONLY**

✅ **DO:**
- Manage application-wide state
- Provide getters and setters
- Emit state change events if needed
- Keep state minimal and focused

❌ **DON'T:**
- Contain business logic
- Make API calls
- Manipulate DOM
- Perform data transformations

## Layer Communication Rules

### Dependency Flow
```
UI Layer
   ↓ (can import)
Services Layer
   ↓ (can import)
API Layer
   ↓ (can import)
Core/Utils
```

**Rules:**
- Upper layers can import from lower layers
- Lower layers CANNOT import from upper layers
- Peer layers (e.g., different services) should minimize dependencies

### Example - Correct Dependencies:
```javascript
// ✅ UI imports Service
import { uploadBalance } from '../services/balance';

// ✅ Service imports API
import questradeApi from '../api/questrade';

// ✅ Service imports Utils
import { formatDate } from '../core/utils';
```

### Example - Incorrect Dependencies:
```javascript
// ❌ API imports Service (wrong direction)
import { processBalance } from '../services/balance';

// ❌ API imports UI (wrong direction)
import toast from '../ui/toast';

// ❌ Core/Utils imports Service (wrong direction)
import { uploadBalance } from '../services/balance';
```

## Exception: Notifications

While toast notifications are UI components, showing them from service layers is acceptable for user feedback:

```javascript
// ✅ ACCEPTABLE: Toast from service for user feedback
export async function uploadBalance(accountId) {
  try {
    const result = await monarchApi.upload(data);
    toast.show('Upload successful', 'info');
    return result;
  } catch (error) {
    toast.show('Upload failed', 'error');
    throw error;
  }
}
```

However, prefer returning status and letting the caller handle notifications when possible:

```javascript
// ✅ BETTER: Return status, let caller handle notification
export async function uploadBalance(accountId) {
  try {
    const result = await monarchApi.upload(data);
    return { success: true, result };
  } catch (error) {
    return { success: false, error: error.message };
  }
}
```

## Checklist for New Code

Before committing, verify:
- [ ] API layer only makes HTTP calls, no business logic
- [ ] Services contain business logic, no direct HTTP or DOM
- [ ] UI only handles presentation, delegates to services
- [ ] Dependencies flow in correct direction (UI → Services → API → Core)
- [ ] No circular dependencies
- [ ] State management is centralized
- [ ] Each layer has single, clear responsibility

## Refactoring Violations

When you find code that violates these rules:

1. **Identify the violation** - What layer responsibility is being broken?
2. **Extract the logic** - Move it to the appropriate layer
3. **Update dependencies** - Ensure proper import/export
4. **Test the separation** - Verify each layer still works

**Example Refactoring:**
```javascript
// BEFORE: Business logic in API layer
// src/api/questrade.js
export async function getAccountBalance(accountId) {
  const response = await makeApiCall(`/accounts/${accountId}`);
  // ❌ Business logic in API layer
  const cadBalance = response.balances.find(b => b.currency === 'CAD');
  return cadBalance.amount;
}

// AFTER: Moved to service layer
// src/api/questrade.js - Clean API layer
export async function fetchAccountData(accountId) {
  return await makeApiCall(`/accounts/${accountId}`);
}

// src/services/account.js - Business logic in service
export async function getAccountCADBalance(accountId) {
  const accountData = await questradeApi.fetchAccountData(accountId);
  const cadBalance = accountData.balances.find(b => b.currency === 'CAD');
  return cadBalance ? cadBalance.amount : 0;
}
