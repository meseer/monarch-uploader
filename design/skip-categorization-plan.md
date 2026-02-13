# Skip Categorization Feature - Implementation Plan

## Overview

Allow users to skip manual transaction categorization during sync sessions. When skipped, the transaction category field in the CSV is left empty (no value between commas), so Monarch Money will automatically run its own categorization rules. If no rule matches, Monarch assigns "Uncategorized".

## Two Skip Modes

1. **Persistent (per-account setting)**: `skipCategorization` — stored in consolidated account object, toggled in Settings UI. Applies to all future syncs for that account.
2. **Session-level (temporary)**: "Skip All (this sync)" button in the category selector modal. Applies only to the current sync session, not persisted.

## Affected Integrations

- **Wealthsimple**: Credit card (`resolveCategoriesForTransactions`), CASH/investment (`showManualTransactionCategorization`)
- **Rogers Bank**: `resolveCategoriesForTransactions` in `rogersbank-upload.js`
- **Questrade**: `resolveCategoriesForOrders` in `questrade/transactions.js`
- **Canada Life**: NOT affected (uses direct `ACTIVITY_CATEGORY_MAP` with no user prompts)

## CSV Behavior

When category is skipped, `resolvedMonarchCategory` is set to `''` (empty string). The CSV conversion functions must preserve this empty string and NOT default to `'Uncategorized'`. This produces `,,` in the CSV, which tells Monarch to apply its own rules.

---

## Implementation Tasks

### Phase 1: Configuration

#### Task 1: Add SKIP_CATEGORIZATION to ACCOUNT_SETTINGS enum
- **File**: `src/core/integrationCapabilities.js`
- **Change**: Add `SKIP_CATEGORIZATION: 'skipCategorization'` to `ACCOUNT_SETTINGS`
- **Status**: [ ] Not started

#### Task 2: Add setting to integration configs
- **File**: `src/core/integrationCapabilities.js`
- **Change**: Add `ACCOUNT_SETTINGS.SKIP_CATEGORIZATION` to `settings` array and `settingDefaults` for:
  - Wealthsimple (default: `false`)
  - Questrade (default: `false`)
  - Rogers Bank (default: `false`)
- NOT Canada Life (no manual categorization)
- **Status**: [ ] Not started

### Phase 2: Settings UI

#### Task 3: Add skip categorization toggle to settings modal
- **File**: `src/ui/components/settingsModal.js`
- **Change**: Add rendering logic in `renderAccountSettingsSection()` for the new `SKIP_CATEGORIZATION` toggle
- **Label**: "Skip manual categorization"
- **Description**: "When enabled, transactions sync without category prompts. Monarch will apply its own categorization rules."
- **Status**: [ ] Not started

### Phase 3: Core Logic - CSV

#### Task 4: Modify CSV utils to preserve empty category strings
- **File**: `src/utils/csv.js`
- **Changes**:
  - `convertTransactionsToMonarchCSV()` (Rogers): Change `transaction.resolvedMonarchCategory` fallback logic. Use `??` instead of `||` to preserve empty string `''`.
  - `convertWealthsimpleTransactionsToMonarchCSV()`: Same change - `transaction.resolvedMonarchCategory ?? 'Uncategorized'`
  - `convertQuestradeOrdersToMonarchCSV()`: Same change
  - `convertQuestradeTransactionsToMonarchCSV()`: Questrade activity transactions use `ruleResult?.category` - check if empty string needs preserving
- **Key insight**: `'' || 'Uncategorized'` returns `'Uncategorized'`, but `'' ?? 'Uncategorized'` returns `''`
- **Status**: [ ] Not started

### Phase 4: Core Logic - Category Resolution

#### Task 5: Modify Wealthsimple category resolution to respect skip flag
- **File**: `src/services/wealthsimple/transactions.js`
- **Changes**:
  - `resolveCategoriesForTransactions()`: Accept `options.skipCategorization` parameter. When true, set all `resolvedMonarchCategory` to `''` and skip `showMonarchCategorySelector()` prompts entirely.
  - `fetchAndProcessCreditCardTransactions()`: Read `skipCategorization` from `consolidatedAccount` settings. Pass to `resolveCategoriesForTransactions()`.
  - `fetchAndProcessCashTransactions()`: When skip is active, bypass `showManualTransactionCategorization()` for unmatched transactions and use empty category. For rule-matched transactions, still use rule categories (skip only affects manual prompts).
  - `fetchAndProcessInvestmentTransactions()`: Same as CASH - skip manual categorization prompts.
  - `fetchAndProcessLineOfCreditTransactions()`: Same pattern.
- **Status**: [ ] Not started

#### Task 6: Modify Rogers Bank category resolution to respect skip flag
- **File**: `src/services/rogersbank-upload.js`
- **Changes**:
  - `resolveCategoriesForTransactions()`: Accept skip parameter. When true, set all `resolvedMonarchCategory` to `''`, skip `showMonarchCategorySelector()` and `applyCategoryMapping()`.
  - `uploadRogersBankToMonarch()`: Read `skipCategorization` from account data. Pass to `resolveCategoriesForTransactions()`.
- **Status**: [ ] Not started

#### Task 7: Modify Questrade category resolution to respect skip flag
- **File**: `src/services/questrade/transactions.js`
- **Changes**:
  - `resolveCategoriesForOrders()`: Accept skip parameter. When true, set all `resolvedMonarchCategory` to `''`, skip `showMonarchCategorySelector()` and `applyCategoryMapping()`.
  - `processAndUploadOrders()`: Read `skipCategorization` from account data. Pass to `resolveCategoriesForOrders()`.
- **Status**: [ ] Not started

### Phase 5: Session-Level Skip - Category Selector UI

#### Task 8: Add "Skip All (this sync)" button to category selector
- **File**: `src/ui/components/categorySelector.js`
- **Changes**:
  - In `showCategoryGroupSelector()`: Add a "Skip All" button alongside Cancel, Save as Rule, and Assign Once buttons.
  - When clicked: resolve with a special `{ skipAll: true }` sentinel value.
  - In `showManualTransactionCategorization()`: Add a "Skip" button to skip individual manual categorization.
- **Caller handling**: Each integration's category resolution function checks for `skipAll` response and sets all remaining transactions to empty category.
- **Status**: [ ] Not started

#### Task 9: Handle skipAll response in Wealthsimple category resolution
- **File**: `src/services/wealthsimple/transactions.js`
- **Change**: In `resolveCategoriesForTransactions()`, when `selectedCategory.skipAll === true`, set session-level skip flag and resolve all remaining categories with empty string.
- **Status**: [ ] Not started

#### Task 10: Handle skipAll response in Rogers Bank category resolution
- **File**: `src/services/rogersbank-upload.js`
- **Change**: Same pattern as Wealthsimple.
- **Status**: [ ] Not started

#### Task 11: Handle skipAll response in Questrade category resolution
- **File**: `src/services/questrade/transactions.js`
- **Change**: Same pattern as Wealthsimple.
- **Status**: [ ] Not started

### Phase 6: Tests

#### Task 12: Tests for integrationCapabilities changes
- **File**: `test/core/integrationCapabilities.test.js`
- **Tests**: Verify `SKIP_CATEGORIZATION` exists in `ACCOUNT_SETTINGS`, is in correct integrations' settings arrays, has correct defaults.
- **Status**: [ ] Not started

#### Task 13: Tests for CSV changes
- **File**: `test/utils/csv.test.js`
- **Tests**: Verify empty string category is preserved (not replaced with 'Uncategorized'), verify null/undefined still defaults to 'Uncategorized'.
- **Status**: [ ] Not started

#### Task 14: Tests for Wealthsimple skip categorization
- **File**: `test/services/wealthsimple/transactions.test.js`
- **Tests**: Verify skip flag bypasses category resolution prompts, verify empty category is set.
- **Status**: [ ] Not started

#### Task 15: Tests for Rogers Bank skip categorization
- **File**: `test/services/rogersbank-upload.test.js`
- **Tests**: Same pattern.
- **Status**: [ ] Not started

#### Task 16: Tests for Questrade skip categorization
- **File**: `test/services/questrade/transactions.test.js`
- **Tests**: Same pattern.
- **Status**: [ ] Not started

#### Task 17: Tests for settingsModal skip toggle
- **File**: `test/ui/settingsModal.test.js`
- **Tests**: Verify toggle renders for correct integrations.
- **Status**: [ ] Not started

### Phase 7: Finalization

#### Task 18: Update version numbers
- **Files**: `package.json`, `src/userscript-metadata.cjs`, `README.md`
- **Change**: Bump minor version (new feature)
- **Status**: [ ] Not started

#### Task 19: Run build validation
- **Command**: `npm run lint && npm test && npm run build && npm run build:full`
- **Status**: [ ] Not started

#### Task 20: Generate commit message
- **Status**: [ ] Not started

---

## Technical Details

### How skipCategorization Setting Is Read

```javascript
// In each integration's upload function:
const accountData = accountService.getAccountData(INTEGRATIONS.XXXX, accountId);
const skipCategorization = accountData?.skipCategorization === true;
```

### How Session Skip Works

When user clicks "Skip All (this sync)" in the category selector:
1. The selector resolves with `{ skipAll: true }` 
2. The calling resolution function sets a local `sessionSkip = true`
3. All remaining categories in the loop are resolved with `''` (empty string)
4. This is NOT persisted - only affects the current batch

### CSV Output with Empty Category

```
Date,Merchant,Category,Account,Original Statement,Notes,Amount,Tags
2024-01-15,Starbucks,,Rogers Mastercard,STARBUCKS #1234,,10.50,
```

The `,,` between Merchant and Account means empty Category. Monarch will apply its own rules.

### Settings UI Toggle

Same pattern as existing toggles (e.g., `storeTransactionDetailsInNotes`, `stripStoreNumbers`):
```javascript
if (hasSetting(integrationId, ACCOUNT_SETTINGS.SKIP_CATEGORIZATION)) {
  // Render toggle with label and description
}