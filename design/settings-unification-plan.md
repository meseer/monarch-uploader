# Settings UI Unification Plan

## Overview

This document tracks the progress of unifying the settings UI across all integrations, using Wealthsimple as the model pattern.

**Goal**: Make all integration settings consistent with the Wealthsimple pattern:
- Consolidated account storage (`*_ACCOUNTS_LIST`)
- Per-account settings (not global)
- Enable/disable toggle per account
- Expandable account cards with settings
- Debug information section (editable JSON)
- Transaction management (for integrations with deduplication)

---

## Current State Analysis

### Data Storage Patterns

| Integration | Storage Pattern | Account Settings | Transaction Tracking |
|-------------|-----------------|------------------|---------------------|
| **Wealthsimple** | ✅ Consolidated `ACCOUNTS_LIST` | ✅ Per-account | ✅ Array in account object |
| **Questrade** | ⚠️ Mixed (see note below) | ❌ Global only | ✅ Separate prefix keys |
| **CanadaLife** | ❌ Prefix-based keys | ❌ Global only | ❌ N/A (balance only) |
| **Rogers Bank** | ❌ Prefix-based keys | ❌ Global only | ✅ Separate prefix keys |

### ⚠️ Questrade Storage Issue (Discovered & Fixed in v5.58.2)

**Problem:** The `questrade_accounts_list` key had conflicting dual usage:
1. **Questrade API layer** (`src/api/questrade.js`) used it as a raw account cache
2. **accountService** expected it to contain consolidated account format

**Root Cause:** The Questrade API was writing raw account objects from the API directly to `questrade_accounts_list`. This is historical behavior from before the consolidation effort.

**Solution (Option B - Implemented):**
- Created new `QUESTRADE_ACCOUNTS_CACHE` key for raw API cache
- Updated `src/api/questrade.js` to use the new cache key
- Updated `src/services/questrade/account.js` to use the new cache key
- `ACCOUNTS_LIST` (`questrade_accounts_list`) is now exclusively for consolidated format

**Storage Key Separation:**
| Key | Purpose | Format |
|-----|---------|--------|
| `questrade_accounts_cache` | Raw API response cache | `[{key, number, name, nickname, type, ...}]` |
| `questrade_accounts_list` | Consolidated account data | `[{questradeAccount, monarchAccount, syncEnabled, ...}]` |
| `questrade_monarch_account_for_{id}` | Legacy Monarch mapping | `{id, displayName, ...}` |
| `questrade_last_upload_date_{id}` | Legacy sync date | `"YYYY-MM-DD"` |

### Integration Capabilities

| Capability | Wealthsimple | Questrade | CanadaLife | Rogers Bank |
|------------|--------------|-----------|------------|-------------|
| Balance Upload | ✅ | ✅ | ✅ | ✅ |
| Transactions | ✅ | ✅ (orders) | ❌ | ✅ |
| Deduplication | ✅ | ✅ | ❌ | ✅ |
| Credit Limit | ✅ (credit cards) | ❌ | ❌ | ✅ |
| Holdings | ✅ | ✅ | ❌ | ❌ |

---

## Implementation Phases

### Phase 1: Capabilities Configuration System
**Status**: ✅ Complete

Create a centralized configuration defining what each integration supports.

- [x] Create `src/core/integrationCapabilities.js`
- [x] Create `test/core/integrationCapabilities.test.js`
- [x] Verify tests pass (46 tests passing)

### Phase 2: Unified Account Service Interface
**Status**: ✅ Complete

Create a common interface for account operations with backward compatibility.

- [x] Create `src/services/common/accountService.js`
- [x] Add migration logic for reading legacy prefix-based storage
- [x] Create `test/services/common/accountService.test.js`
- [x] Verify tests pass (42 tests passing)

### Phase 3: Refactor Settings UI
**Status**: ✅ Complete

Update settings modal to use capabilities and unified account service.

#### Phase 3.1: Account Cards Standardization ✅
- [x] Create generic `createGenericAccountCards()` function based on Wealthsimple pattern
- [x] Refactor `renderQuestradeTab()` to use generic cards
- [x] Refactor `renderCanadaLifeTab()` to use generic cards
- [x] Refactor `renderRogersBankTab()` to use generic cards (v5.58.5)
- [x] Enable/disable toggle per account (via `createToggleSwitch`)
- [x] Update tests for refactored tabs

#### Phase 3.2: Per-Account Settings ✅
- [x] Add per-account settings toggles based on capabilities
- [x] Add debug information section with editable JSON
- [x] Update tests

#### Phase 3.3: Transaction Management UI in Account Cards ✅
- [x] Create `renderTransactionsManagementSection()` reusable function
- [x] Integrate into `createGenericAccountCards()` for deduplication-enabled integrations
- [x] Verify lint and tests pass

### Phase 4: Storage Migration
**Status**: ⏳ In Progress

Migrate each integration to consolidated structure with backward compatibility.

#### Phase 4.1: CanadaLife Migration (Simplest)
**Status**: ✅ Complete (v5.58.8)

*All items completed:*
- [x] accountService.js supports CanadaLife via `INTEGRATIONS.CANADALIFE`
- [x] Migration logic implemented in `migrateFromLegacyStorage()`
- [x] Settings UI uses `createGenericAccountCards()` for CanadaLife
- [x] All CRUD operations available via unified accountService
- [x] Update `canadalife-upload.js` to use `accountService` instead of direct GM_getValue/GM_setValue
- [x] Verify tests pass with new storage pattern (2194 tests passing)
- [x] Backward compatibility maintained (legacy storage still written for migration period)

#### Phase 4.2: Questrade Migration
**Status**: ✅ Complete (v5.59.0)

*All items completed:*
- [x] accountService.js supports Questrade via `INTEGRATIONS.QUESTRADE`
- [x] Migration logic reads from legacy storage, writes to both
- [x] `balance.js` uses `getLastUpdateDate()` and `saveLastUploadDate()` from utils
- [x] `account.js` uses `accountService.upsertAccount()` for consolidated storage
- [x] `sync.js` orchestrates sync count tracking and legacy cleanup
- [x] Sync count tracking: cleanup only after 2 successful syncs (`MIN_SYNCS_BEFORE_CLEANUP = 2`)
- [x] All tests passing (2194 tests)
- [x] Backward compatibility maintained (legacy storage still written during migration period)

#### Phase 4.3: Rogers Bank Migration (Most Complex)
**Status**: ✅ Complete (v5.59.3)

*All items completed:*
- [x] accountService.js supports Rogers Bank via `INTEGRATIONS.ROGERSBANK`
- [x] Migration logic implemented - reads from consolidated first, falls back to legacy
- [x] `rogersbank-upload.js` uses `accountService.getMonarchAccountMapping()` for lookup
- [x] `rogersbank-upload.js` uses `accountService.upsertAccount()` for saving mappings
- [x] `rogersbank-upload.js` uses `accountService.getAccountData()` and `updateAccountInList()` for:
  - [x] Credit limit tracking (`lastSyncedCreditLimit`)
  - [x] Balance checkpoint (`balanceCheckpoint`)
- [x] Migrate global `ROGERSBANK_STORE_TX_DETAILS_IN_NOTES` → per-account (with global fallback)
- [x] `isFirstSync()` uses `getLastUpdateDate()` from utils
- [x] Sync count tracking: cleanup only after 2 successful syncs
- [x] All tests passing (39 Rogers Bank tests, 2206 total tests)
- [x] Backward compatibility maintained (legacy storage still written during migration period)

#### Phase 4.4: Legacy Storage Cleanup (Auto-delete after migration)
**Status**: ⏳ Partially Complete

After migration is complete and data exists in consolidated storage, automatically cleanup legacy keys after first successful sync.

| Integration | Migration Status | Cleanup Status | Legacy Keys to Clean |
|-------------|------------------|----------------|---------------------|
| **Wealthsimple** | ✅ N/A | ✅ N/A | None (always consolidated) |
| **Canada Life** | ✅ v5.58.8 | ✅ v5.58.10 | `canadalife_monarch_account_for_{id}`, `canadalife_last_upload_date_{id}` |
| **Questrade** | ✅ v5.59.0 | ✅ v5.59.0 | `questrade_monarch_account_for_{id}`, `questrade_last_upload_date_{id}` |
| **Rogers Bank** | ✅ v5.59.3 | ✅ v5.59.3 | `rogersbank_monarch_account_for_{id}`, `rogersbank_last_upload_date_{id}`, `rogersbank_last_credit_limit_{id}`, `rogersbank_balance_checkpoint_{id}`, `rogersbank_uploaded_refs_{id}` |

**Cleanup Implementation Pattern (from Canada Life v5.58.10):**
1. After successful sync completes
2. Call `accountService.cleanupLegacyStorage(integrationId, accountId)`
3. Function validates consolidated data exists before deleting legacy keys
4. Logs cleanup actions for debugging

**Implementation Tasks:**
- [x] Create `cleanupLegacyStorage()` function in accountService (v5.58.10)
- [x] Integrate cleanup into CanadaLife upload service (v5.58.10)
- [x] Fix `getLastUpdateDate()` and `saveLastUploadDate()` to use consolidated storage first (v5.58.11)
- [x] Integrate cleanup into Questrade sync service with sync count tracking (v5.59.0)
- [x] Integrate cleanup into Rogers Bank upload service (v5.59.3)

### Phase 5: Uploaded Transactions Management UI
**Status**: ⏳ Not Started

Add transaction management section to all integrations with deduplication.

- [ ] Create generic `createTransactionsManagementSection()` function
- [ ] Add to Questrade settings (for orders)
- [ ] Add to Wealthsimple settings (existing data, needs UI)
- [ ] Ensure Rogers Bank uses the generic function
- [ ] Add bulk operations (select all, delete selected, add)
- [ ] Update tests

### Phase 6: Update Cline Rules for Integration Consistency
**Status**: ⏳ Not Started

After achieving baseline consistency, update cline rules to maintain consistency for future work.

- [ ] Create `.clinerules/12-integration-consistency.md` guideline document
- [ ] Document the consolidated account structure pattern
- [ ] Document required capabilities configuration for new integrations
- [ ] Document settings UI patterns (account cards, per-account settings)
- [ ] Document migration requirements for storage changes
- [ ] Add checklist for adding new integrations

### Phase 7: Code Cleanup
**Status**: ⏳ Not Started

After all integrations are migrated to the unified pattern, remove deprecated code.

- [ ] Remove `createAccountMappingCards()` from settingsModal.js
- [ ] Remove `createWealthsimpleAccountCards()` (replaced by generic)
- [ ] Remove legacy `getStorageData()` function if unused
- [ ] Remove legacy render functions that were replaced
- [ ] Clean up any duplicate helper functions
- [ ] Remove unused imports
- [ ] Run full test suite to verify no regressions
- [ ] Update documentation to reflect final architecture

---

## Migration Safety Rules

1. **Always read from both storage locations** during migration period
2. **Never delete legacy storage** until migration is confirmed (requires 2 successful syncs)
3. **Add migration version flag** to track migration state per integration
4. **Provide rollback function** in case of issues
5. **Log all migration actions** for debugging

---

## Architecture Pattern: Account Mapping Resolution (v5.59.1)

### Problem Discovered
After legacy storage cleanup, account mappings were lost because code was still checking legacy storage directly (via `monarchApi.resolveAccountMapping` or direct `GM_getValue`) instead of using `accountService`.

### Solution: Centralized Mapping Lookup

**Always use `accountService.getMonarchAccountMapping()`** to look up Monarch account mappings:

```javascript
// ❌ DON'T: Check legacy storage directly (will fail after cleanup)
const monarchAccount = await monarchApi.resolveAccountMapping(
  accountId, 
  STORAGE.PREFIX, 
  'brokerage'
);

// ✅ DO: Use accountService (checks consolidated first, falls back to legacy)
import accountService from '../services/common/accountService';
import { INTEGRATIONS } from '../core/integrationCapabilities';

const monarchAccount = accountService.getMonarchAccountMapping(
  INTEGRATIONS.QUESTRADE,  // or CANADALIFE, ROGERSBANK, etc.
  accountId
);

if (!monarchAccount) {
  // Show account selector UI for new mapping
  const selectedAccount = await showMonarchAccountSelector(...);
  
  if (selectedAccount) {
    // Save ONLY to consolidated storage (not legacy)
    accountService.upsertAccount(INTEGRATIONS.QUESTRADE, {
      questradeAccount: { id: accountId, nickname: accountName },
      monarchAccount: selectedAccount,
    });
  }
}
```

### Key Functions in accountService

| Function | Purpose | When to Use |
|----------|---------|-------------|
| `getMonarchAccountMapping(integrationId, accountId)` | Get Monarch mapping (consolidated first, legacy fallback) | Before any upload/sync |
| `upsertAccount(integrationId, accountData)` | Save account with mapping to consolidated | After user selects new mapping |
| `updateAccountInList(integrationId, accountId, updates)` | Update specific properties | Update lastSyncDate, etc. |
| `getLastUpdateDate(accountId, integrationId)` | Get last sync date | In utils.js, for date range |
| `saveLastUploadDate(accountId, integrationId, date)` | Save last sync date | After successful sync |

### Legacy Storage is Read-Only

During migration period:
- **Read**: Check consolidated first, fall back to legacy
- **Write**: ONLY to consolidated storage
- **Delete**: After 2 successful syncs via `cleanupLegacyStorage()`

### Migration Checklist for Each Integration

When migrating an integration to consolidated storage:

1. **Import accountService and INTEGRATIONS**
2. **⚠️ CRITICAL: Find ALL usages of `monarchApi.resolveAccountMapping()` calls**
   - Search the entire codebase: `resolveAccountMapping|resolveMonarchAccountMapping`
   - This includes sync services, position services, transaction services, balance services
   - Bug found in v5.59.1: Questrade had 3 places calling this (balance, sync positions, transactions)
   - Replace with `accountService.getMonarchAccountMapping()` for lookup
   - Use `accountService.upsertAccount()` for saving new mappings
3. **Replace direct GM_getValue for mappings** with accountService calls
4. **Replace direct GM_setValue for mappings** - remove entirely, use `upsertAccount`
5. **Replace date storage** - use `getLastUpdateDate()` / `saveLastUploadDate()` from utils
6. **Add sync count tracking** in sync orchestration:
   ```javascript
   const newSyncCount = accountService.incrementSyncCount(integrationId, accountId);
   if (accountService.isReadyForLegacyCleanup(integrationId, accountId)) {
     accountService.cleanupLegacyStorage(integrationId, accountId);
   }
   ```
7. **Test**: Verify sync works with fresh install (no legacy data)
8. **Test**: Verify sync works after migration (legacy data exists)
9. **Test**: Verify sync works after cleanup (legacy data deleted)

### Files Updated in Questrade Migration (v5.59.1 bug fix)

For reference, these files were updated to use `accountService.getMonarchAccountMapping()`:

| File | Location | Previous Call |
|------|----------|---------------|
| `src/services/questrade/balance.js` | `uploadBalanceToMonarch()` | `monarchApi.resolveAccountMapping()` |
| `src/services/questrade/balance.js` | `ensureAllAccountMappings()` | `GM_getValue` |
| `src/services/questrade/sync.js` | `syncAccountToMonarch()` positions step | `monarchApi.resolveAccountMapping()` |
| `src/services/questrade/transactions.js` | `processAndUploadTransactions()` | `monarchApi.resolveAccountMapping()` |

---

## Consolidated Account Structure (Target)

All integrations should use this structure:

```javascript
// Example: WEALTHSIMPLE_ACCOUNTS_LIST structure
[
  {
    // Source account data
    wealthsimpleAccount: {
      id: "account-123",
      nickname: "TFSA",
      type: "MANAGED_TFSA",
      // ... other source account properties
    },
    
    // Monarch mapping
    monarchAccount: {
      id: "monarch-456",
      displayName: "Wealthsimple TFSA",
      // ... other Monarch account properties
    },
    
    // Sync state
    syncEnabled: true,
    lastSyncDate: "2024-01-15",
    
    // Per-account settings
    storeTransactionDetailsInNotes: false,
    transactionRetentionDays: 91,
    transactionRetentionCount: 1000,
    stripStoreNumbers: true, // Wealthsimple-specific
    includePendingTransactions: true, // Wealthsimple-specific
    
    // Transaction tracking (for deduplication)
    uploadedTransactions: [
      { id: "tx-1", date: "2024-01-10" },
      { id: "tx-2", date: "2024-01-11" },
    ],
    
    // Credit card specific
    lastSyncedCreditLimit: 10000,
    balanceCheckpoint: { date: "2024-01-15", amount: -500 },
  }
]
```

---

## Version History

- **v1.0** (2026-01-27): Initial plan created
- **v1.1** (2026-02-01): Phase 4.3 (Rogers Bank Migration) completed (v5.59.3)
