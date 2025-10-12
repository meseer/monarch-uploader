# Error Handling Standards

## Core Principles

1. **Fail Fast** - Detect and report errors as early as possible
2. **Be Specific** - Provide clear, actionable error messages
3. **Propagate Properly** - Let errors bubble up through layers appropriately
4. **User-Friendly** - Show helpful messages to users, technical details in logs
5. **Consistent Patterns** - Use the same error handling patterns throughout

## Custom Error Classes

### When to Create Custom Errors

Create custom error classes for:
- Domain-specific errors that need special handling
- Errors that carry additional context
- Errors that need to be caught and handled differently

✅ **DO: Create domain-specific error classes**
```javascript
// src/services/questrade/balance.js
export class BalanceError extends Error {
  constructor(message, accountId) {
    super(message);
    this.name = 'BalanceError';
    this.accountId = accountId;
  }
}

// Usage
throw new BalanceError('No CSV data to upload', accountId);
```

✅ **DO: Include relevant context**
```javascript
export class UploadError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'UploadError';
    this.accountId = details.accountId;
    this.fromDate = details.fromDate;
    this.toDate = details.toDate;
    this.statusCode = details.statusCode;
  }
}
```

❌ **DON'T: Create error classes for everything**
```javascript
// ❌ Over-engineering - just use Error
class StringEmptyError extends Error {}
class NumberTooLargeError extends Error {}
class ArrayNotSortedError extends Error {}

// ✅ Use standard Error for simple cases
if (!str) throw new Error('String cannot be empty');
```

## Error Messages

### User-Facing Messages
Clear, actionable, non-technical:

```javascript
// ✅ DO: User-friendly messages
toast.show('Failed to upload balance. Please try again.', 'error');
toast.show('Account not found. Please select a valid account.', 'error');
toast.show('Unable to connect to Monarch. Please check your internet connection.', 'error');

// ❌ DON'T: Technical jargon for users
toast.show('API returned 500', 'error');
toast.show('Null pointer exception in balance processor', 'error');
toast.show('CORS policy violation', 'error');
```

### Developer Messages (Logs)
Technical, specific, with context:

```javascript
// ✅ DO: Detailed logging for debugging
debugLog(`Failed to fetch balance history for account ${accountId}:`, error);
debugLog(`API Error: ${error.status} - ${error.statusText}`, { endpoint, params });
debugLog('Validation failed:', { accountId, data, reason: error.message });

// ❌ DON'T: Vague or useless logs
debugLog('Something went wrong');
debugLog('Error');
debugLog('Failed');
```

## Error Handling Patterns

### 1. Try-Catch in Async Functions

✅ **DO: Handle errors at appropriate level**
```javascript
export async function processAndUploadBalance(accountId, accountName, fromDate, toDate) {
  try {
    // Set context
    stateManager.setAccount(accountId, accountName);
    
    // Fetch data
    const balanceData = await fetchBalanceHistory(accountId, fromDate, toDate);
    
    // Process
    const csvData = processBalanceData(balanceData, accountName);
    
    // Validate
    if (!csvData || csvData.length === 0) {
      throw new BalanceError('No data to upload', accountId);
    }
    
    // Upload
    const success = await uploadBalanceToMonarch(accountId, csvData, fromDate, toDate);
    
    if (success) {
      toast.show(`Successfully uploaded ${accountName} balance history`, 'info');
      return true;
    }
    
    toast.show(`Failed to upload ${accountName} balance history`, 'error');
    return false;
  } catch (error) {
    // User-friendly message
    const errorMessage = error instanceof BalanceError 
      ? error.message 
      : `Error processing account: ${error.message}`;
    toast.show(errorMessage, 'error');
    
    // Technical log
    debugLog(`Error in processAndUploadBalance for ${accountId}:`, error);
    return false;
  }
}
```

### 2. Validation Errors

✅ **DO: Validate early and throw descriptive errors**
```javascript
export function validateDateRange(fromDate, toDate) {
  if (!fromDate || !toDate) {
    throw new Error('Both from and to dates are required');
  }
  
  const from = new Date(fromDate);
  const to = new Date(toDate);
  
  if (isNaN(from.getTime())) {
    throw new Error(`Invalid from date: ${fromDate}`);
  }
  
  if (isNaN(to.getTime())) {
    throw new Error(`Invalid to date: ${toDate}`);
  }
  
  if (from > to) {
    throw new Error('From date must be before to date');
  }
  
  return { from, to };
}
```

❌ **DON'T: Silent failures or vague messages**
```javascript
// ❌ Silent failure
export function validateDateRange(fromDate, toDate) {
  if (!fromDate || !toDate) return null;
  return { from: new Date(fromDate), to: new Date(toDate) };
}

// ❌ Vague error
if (!data) throw new Error('Bad data');
```

### 3. API Error Handling

✅ **DO: Handle different HTTP status codes appropriately**
```javascript
export async function makeQuestradeApiCall(endpoint) {
  const authStatus = authService.checkQuestradeAuth();
  if (!authStatus.authenticated) {
    throw new Error('Questrade auth token not found. Please log in to Questrade.');
  }

  return new Promise((resolve, reject) => {
    GM_xmlhttpRequest({
      method: 'GET',
      url: `${API.QUESTRADE_BASE_URL}${endpoint}`,
      headers: { Authorization: authStatus.token },
      onload: (res) => {
        if (res.status === 401) {
          authService.saveToken('questrade', null);
          stateManager.setQuestradeAuth(null);
          reject(new Error('Auth token expired. Please refresh the page.'));
        } else if (res.status === 404) {
          reject(new Error(`Resource not found: ${endpoint}`));
        } else if (res.status >= 500) {
          reject(new Error('Server error. Please try again later.'));
        } else if (res.status >= 200 && res.status < 300) {
          resolve(JSON.parse(res.responseText));
        } else {
          reject(new Error(`API Error: Received status ${res.status}`));
        }
      },
      onerror: (err) => {
        debugLog('Network error:', err);
        reject(new Error('Network error. Please check your connection.'));
      },
    });
  });
}
```

### 4. Error Propagation

✅ **DO: Let errors bubble up when appropriate**
```javascript
// Low-level function - throw errors
export async function fetchBalanceHistory(accountId, fromDate, toDate) {
  if (!accountId) {
    throw new BalanceError('Account ID is required', accountId);
  }
  
  // Let API errors propagate
  const data = await questradeApi.makeApiCall(`/accounts/${accountId}/balance`);
  return data;
}

// High-level function - catch and handle errors
export async function uploadAllAccounts() {
  try {
    const accounts = await fetchAccounts();
    
    for (const account of accounts) {
      try {
        await processAccount(account);
      } catch (error) {
        // Handle per-account errors without stopping the process
        debugLog(`Failed to process account ${account.id}:`, error);
        toast.show(`Failed to process ${account.name}`, 'error');
        // Continue with next account
      }
    }
  } catch (error) {
    // Handle fatal errors that stop everything
    debugLog('Fatal error in uploadAllAccounts:', error);
    toast.show('Upload process failed', 'error');
  }
}
```

### 5. Defensive Programming

✅ **DO: Check inputs and return early**
```javascript
export function processBalanceData(rawData, accountName) {
  // Guard clauses
  if (!rawData) {
    throw new Error('Balance data is required');
  }
  
  if (!rawData.history) {
    throw new Error('Balance history data is missing');
  }
  
  if (!accountName) {
    throw new Error('Account name is required');
  }
  
  // Now safely process
  let csvContent = '"Date","Total Equity","Account Name"\n';
  
  if (rawData.history.data && Array.isArray(rawData.history.data)) {
    rawData.history.data.forEach((item) => {
      const date = item.date ?? '';
      const totalEquity = item.totalEquity ?? '';
      csvContent += `"${date}","${totalEquity}","${accountName}"\n`;
    });
  }
  
  return csvContent;
}
```

## Error Recovery Strategies

### 1. Retry Logic for Transient Failures

```javascript
async function uploadWithRetry(uploadFn, maxRetries = 3) {
  let lastError;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await uploadFn();
    } catch (error) {
      lastError = error;
      debugLog(`Upload attempt ${attempt} failed:`, error);
      
      // Don't retry on validation errors or auth errors
      if (error instanceof BalanceError || error.message.includes('auth')) {
        throw error;
      }
      
      // Wait before retrying (exponential backoff)
      if (attempt < maxRetries) {
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw new Error(`Failed after ${maxRetries} attempts: ${lastError.message}`);
}
```

### 2. Graceful Degradation

```javascript
export async function getAccountWithFallback(accountId) {
  try {
    // Try to get from API
    return await fetchAccountFromApi(accountId);
  } catch (error) {
    debugLog('Failed to fetch from API, using cached data:', error);
    
    // Fall back to cached data
    const cached = getCachedAccount(accountId);
    if (cached) {
      toast.show('Using cached account data', 'warning');
      return cached;
    }
    
    // No fallback available
    throw new Error('Account not available');
  }
}
```

### 3. Partial Success Handling

```javascript
export async function bulkUpload(accounts) {
  const results = {
    successful: [],
    failed: []
  };
  
  for (const account of accounts) {
    try {
      await uploadAccount(account);
      results.successful.push(account.id);
    } catch (error) {
      results.failed.push({
        accountId: account.id,
        error: error.message
      });
      debugLog(`Failed to upload account ${account.id}:`, error);
    }
  }
  
  // Report results
  if (results.failed.length === 0) {
    toast.show(`Successfully uploaded ${results.successful.length} accounts`, 'info');
  } else if (results.successful.length === 0) {
    toast.show('All uploads failed', 'error');
  } else {
    toast.show(
      `${results.successful.length} succeeded, ${results.failed.length} failed`,
      'warning'
    );
  }
  
  return results;
}
```

## Testing Error Scenarios

Always test error paths:

```javascript
// test/services/balance.test.js
describe('processBalanceData', () => {
  test('throws error when rawData is null', () => {
    expect(() => processBalanceData(null, 'Account')).toThrow('Balance data is required');
  });
  
  test('throws error when history is missing', () => {
    expect(() => processBalanceData({}, 'Account')).toThrow('Balance history data is missing');
  });
  
  test('throws error when accountName is empty', () => {
    expect(() => processBalanceData({ history: {} }, '')).toThrow('Account name is required');
  });
  
  test('handles missing data gracefully', () => {
    const result = processBalanceData({ history: { data: [] } }, 'Account');
    expect(result).toContain('"Date","Total Equity","Account Name"');
  });
});
```

## Checklist for Error Handling

Before marking any error-prone function as complete:
- [ ] All inputs are validated
- [ ] Appropriate error types are thrown
- [ ] Error messages are clear and actionable
- [ ] Errors are logged with context
- [ ] User-facing messages are friendly
- [ ] Error recovery strategies are in place where appropriate
- [ ] Error scenarios are tested
- [ ] Errors propagate to the right level

## Common Pitfalls to Avoid

❌ **DON'T: Swallow errors silently**
```javascript
// ❌ Bad
try {
  await dangerousOperation();
} catch (error) {
  // Silent failure - error is lost
}
```

❌ **DON'T: Catch and re-throw without adding value**
```javascript
// ❌ Bad
try {
  await operation();
} catch (error) {
  throw error; // Pointless catch
}
```

❌ **DON'T: Use errors for control flow**
```javascript
// ❌ Bad
try {
  const user = findUser(id);
  return user;
} catch (error) {
  return null; // Use null/undefined checks instead
}
```

✅ **DO: Provide context when re-throwing**
```javascript
// ✅ Good
try {
  await operation();
} catch (error) {
  throw new Error(`Failed to process account ${accountId}: ${error.message}`);
}
