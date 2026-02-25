# Refactor Task: Unify Questrade Account Mapping Logic

## Background

Currently, Questrade has **three separate duplicate implementations** of account mapping logic:
1. `src/services/questrade/sync.js` - `ensureAllAccountMappings()` function
2. `src/services/questrade/balance.js` - `ensureAllAccountMappings()` function
3. `src/services/questrade/balance.js` - `uploadBalanceToMonarch()` function (inline mapping)

All three locations contain similar code for:
- Checking for existing Monarch account mappings
- Showing account selector with create option
- Handling skip case (setting `monarchAccount: null, syncEnabled: false`)
- Handling newly created accounts (setting Questrade logo)
- Saving mapping to consolidated storage via `accountService.upsertAccount()`

## Recent Bug Fix (v6.4.12)

The skip handling bug was fixed in all three locations:
- When user clicks "Skip", the code now correctly saves `monarchAccount: null` and `syncEnabled: false`
- Previously, it was incorrectly saving `monarchAccount: { skipped: true }` with `syncEnabled: true`

## Problems This Refactor Solves

### 1. Duplicate Mapping Request in Balance Sync
The balance upload flow (`uploadAllAccountsToMonarch`) has TWO places that check for account mappings:
- `ensureAllAccountMappings()` is called first to map all unmapped accounts upfront
- `uploadBalanceToMonarch()` ALSO checks for mapping and prompts if not found

This creates potential for:
- Duplicate prompts if mapping doesn't persist between the two calls
- Race conditions or storage inconsistencies
- Confusing user experience when asked twice for the same account

### 2. Repeated Mapping Requests on Every Full Sync
The full sync flow (`syncAllAccountsToMonarch` in sync.js) asks for account mapping **every time**, even on subsequent syncs. This indicates that `ensureAllAccountMappings()` in sync.js is either:
- Not properly saving the mapping to consolidated storage after user selection
- Not correctly checking for existing mappings before prompting
- Using inconsistent save/retrieve logic compared to balance.js

### 3. Inconsistent Implementation Across Files
The three duplicate implementations may have subtle differences in:
- How they check for existing mappings
- How they save mappings to storage
- Error handling and edge cases
- Progress dialog updates

This leads to inconsistent behavior and makes debugging difficult.

## Goal

**Refactor all three locations to use the existing unified `accountMappingResolver.js` service.**

The `src/services/common/accountMappingResolver.js` already provides:
- `resolveAccountMapping()` - unified account mapping with all the features needed
- Support for skip handling
- Support for newly created accounts
- Logo setting logic
- Consolidated storage via `accountService`

## Implementation Plan

### 1. Review `accountMappingResolver.js`
- Verify it supports all features needed by Questrade
- Check if skip handling is implemented correctly
- Verify newly created account logo setting is supported
- Ensure it uses `accountService.upsertAccount()` properly

### 2. Update `src/services/questrade/sync.js`
Replace `ensureAllAccountMappings()` function with calls to `accountMappingResolver.resolveAccountMapping()`:
```javascript
import { resolveAccountMapping } from '../common/accountMappingResolver';

// In ensureAllAccountMappings():
for (let i = 0; i < unmappedAccounts.length; i += 1) {
  const account = unmappedAccounts[i];
  const accountName = account.nickname || account.name || 'Account';
  
  const mapping = await resolveAccountMapping(
    INTEGRATIONS.QUESTRADE,
    account.key,
    accountName,
    {
      accountType: 'brokerage',
      accountSubtype: 'brokerage',
      logoId: LOGO_CLOUDINARY_IDS.QUESTRADE,
      progressDialog,
      allowSkip: true,
    }
  );
  
  // Handle cancellation
  if (!mapping) return false;
  
  // Handle skip
  if (mapping.skipped) continue;
}
```

### 3. Update `src/services/questrade/balance.js`
Replace both `ensureAllAccountMappings()` and inline mapping in `uploadBalanceToMonarch()`:

For `ensureAllAccountMappings()`:
- Same pattern as sync.js

For `uploadBalanceToMonarch()`:
```javascript
// Replace the inline account selector code with:
const mapping = await resolveAccountMapping(
  INTEGRATIONS.QUESTRADE,
  accountId,
  accountName,
  {
    accountType: 'brokerage',
    accountSubtype: 'brokerage',
    logoId: LOGO_CLOUDINARY_IDS.QUESTRADE,
    allowSkip: true,
  }
);

if (!mapping) {
  throw new BalanceError('Account mapping cancelled by user', accountId);
}

if (mapping.skipped) {
  throw new BalanceError('Account skipped by user', accountId);
}

monarchAccount = mapping.monarchAccount;
```

### 4. Verify `accountMappingResolver` Has All Features

Check that `accountMappingResolver.resolveAccountMapping()` includes:
- ✅ Account selector with create option
- ✅ Skip handling (`monarchAccount: null, syncEnabled: false`)
- ✅ Logo setting for newly created accounts
- ✅ Progress dialog updates
- ✅ Consolidated storage via `accountService.upsertAccount()`
- ✅ Returns appropriate result for cancellation/skip/success

### 5. Testing

After refactoring:
- Test account mapping flow in sync
- Test account mapping flow in balance upload
- Test skip functionality
- Test newly created account logo setting
- Verify no duplicate code remains
- Run full test suite: `npm run lint && npm test && npm run build && npm run build:full`

## Benefits of This Refactor

1. **Single source of truth** - All account mapping logic in one place
2. **Easier maintenance** - Bug fixes only need to be applied once
3. **Consistency** - Same behavior across all Questrade flows
4. **Reduced code duplication** - ~200 lines of duplicate code eliminated
5. **Better testability** - Unit test the mapping resolver once

## Files to Modify

- `src/services/questrade/sync.js` - Update `ensureAllAccountMappings()`
- `src/services/questrade/balance.js` - Update `ensureAllAccountMappings()` and `uploadBalanceToMonarch()`
- May need to extend `src/services/common/accountMappingResolver.js` if missing features

## Related Files for Reference

- `src/services/common/accountService.js` - Consolidated storage operations
- `src/core/integrationCapabilities.js` - Integration constants
- `src/core/config.js` - Logo constants
- `src/ui/components/accountSelectorWithCreate.js` - UI component used by resolver

## Success Criteria

- [ ] All three duplicate implementations replaced with calls to `accountMappingResolver`
- [ ] Skip handling works correctly in all flows
- [ ] Newly created accounts get Questrade logo set
- [ ] Progress dialog updates work properly
- [ ] All tests pass
- [ ] No functional regressions
- [ ] Code is cleaner and more maintainable