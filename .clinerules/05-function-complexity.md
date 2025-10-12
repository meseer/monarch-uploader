# Function Complexity and Length Guidelines

## Mandatory Rules

### Function Length Limits
**Soft Limit: 50 lines | Hard Limit: 100 lines**

- Functions should ideally be under 50 lines
- Functions over 100 lines MUST be refactored
- Count only code lines (exclude comments and whitespace)
- If you need to create a function over 50 lines, justify why in comments

### Single Responsibility Principle
Each function must do ONE thing well:
- ✅ `fetchBalanceHistory()` - fetches balance data
- ✅ `processBalanceData()` - converts data to CSV
- ❌ `fetchAndProcessBalance()` - doing too much (should be split)

### Complexity Indicators
Watch for these signs that a function needs refactoring:
- **Multiple levels of nesting** (>3 levels deep)
- **Many parameters** (>5 parameters suggests poor design)
- **Long parameter lists** (consider using options object)
- **Multiple return points** that make logic hard to follow
- **Repetitive code blocks** that should be extracted

## Refactoring Guidelines

### When to Extract Helper Functions

**Extract when you see:**
```javascript
// ❌ DON'T: Complex nested logic in one function
async function uploadAllAccounts() {
  const accounts = await fetchAccounts();
  for (const account of accounts) {
    try {
      const fromDate = getLastDate(account.key);
      if (!fromDate) {
        const date = await showDatePicker();
        if (!date) return;
        saveDate(account.key, date);
      }
      const balance = await fetchBalance(account.key);
      const csv = convertToCsv(balance);
      await upload(csv);
    } catch (error) {
      handleError(error);
    }
  }
}
```

**Extract to multiple focused functions:**
```javascript
// ✅ DO: Break into smaller, focused functions
async function uploadAllAccounts() {
  const accounts = await fetchAccounts();
  
  for (const account of accounts) {
    await processAccountUpload(account);
  }
}

async function processAccountUpload(account) {
  try {
    const fromDate = await ensureDateForAccount(account.key);
    if (!fromDate) return;
    
    const balance = await fetchBalance(account.key);
    const csv = convertToCsv(balance);
    await upload(csv);
  } catch (error) {
    handleAccountError(account, error);
  }
}

async function ensureDateForAccount(accountKey) {
  const lastDate = getLastDate(accountKey);
  if (lastDate) return lastDate;
  
  const selectedDate = await showDatePicker();
  if (selectedDate) {
    saveDate(accountKey, selectedDate);
  }
  return selectedDate;
}
```

### Reducing Nesting Depth

**Use early returns to flatten logic:**
```javascript
// ❌ DON'T: Deep nesting
function processData(data) {
  if (data) {
    if (data.items) {
      if (data.items.length > 0) {
        return data.items.map(item => transform(item));
      }
    }
  }
  return [];
}

// ✅ DO: Early returns reduce nesting
function processData(data) {
  if (!data) return [];
  if (!data.items) return [];
  if (data.items.length === 0) return [];
  
  return data.items.map(item => transform(item));
}
```

### Extract Loop Bodies

**When loop bodies are complex:**
```javascript
// ❌ DON'T: Complex logic inside loop
for (const account of accounts) {
  // 30+ lines of processing logic here
  const balance = await fetch();
  const processed = transform();
  const validated = validate();
  await upload();
}

// ✅ DO: Extract to dedicated function
for (const account of accounts) {
  await processAccount(account);
}

async function processAccount(account) {
  const balance = await fetch();
  const processed = transform();
  const validated = validate();
  await upload();
}
```

## Parameter Management

### Use Options Objects for Multiple Parameters
```javascript
// ❌ DON'T: Long parameter list
function createReport(
  accountId, 
  fromDate, 
  toDate, 
  includeBalance, 
  includeTransactions,
  format,
  outputPath
) {
  // ...
}

// ✅ DO: Options object
function createReport(options) {
  const {
    accountId,
    fromDate,
    toDate,
    includeBalance = true,
    includeTransactions = true,
    format = 'csv',
    outputPath
  } = options;
  // ...
}
```

### Destructure at Function Entry
```javascript
// ✅ DO: Clear what properties are used
function processTransaction({ amount, merchant, date, category }) {
  // Use amount, merchant, date, category
}
```

## Code Organization Within Functions

### Logical Section Grouping
```javascript
// ✅ DO: Group related operations with blank lines
async function uploadBalance(accountId, csvData, fromDate, toDate) {
  // Validation
  if (!csvData) {
    throw new BalanceError('No CSV data to upload', accountId);
  }
  
  // Get account context
  const accountName = stateManager.getState().currentAccount.nickname || 'Unknown Account';
  
  // Resolve mapping
  const monarchAccount = await monarchApi.resolveAccountMapping(
    accountId,
    STORAGE.QUESTRADE_ACCOUNT_MAPPING_PREFIX,
    'brokerage'
  );
  
  if (!monarchAccount) {
    throw new BalanceError('Account mapping cancelled', accountId);
  }
  
  // Perform upload
  const success = await monarchApi.uploadBalance(
    monarchAccount.id, 
    csvData, 
    fromDate, 
    toDate
  );
  
  // Post-upload actions
  if (success) {
    storeDateRange(accountId, toDate);
    debugLog(`Successfully uploaded ${accountName} balance history`);
  }
  
  return success;
}
```

## Checklist Before Committing Functions

Before marking any function as complete, verify:
- [ ] Function is under 50 lines (or 100 with justification)
- [ ] Function has a single, clear responsibility
- [ ] Nesting depth is 3 levels or less
- [ ] No repetitive code blocks (extracted to helpers)
- [ ] Parameters are manageable (<5, or using options object)
- [ ] Function name clearly describes what it does
- [ ] Complex logic is extracted to named helper functions
- [ ] JSDoc comment explains purpose and parameters

## When to Break the Rules

**Acceptable exceptions:**
1. **Data transformation pipelines** - Sequential steps that are clearer together
2. **Configuration objects** - Large objects that are easier to read in one place
3. **Test setup functions** - May be longer to maintain test clarity

**Always justify exceptions with comments explaining why keeping it together is better.**
