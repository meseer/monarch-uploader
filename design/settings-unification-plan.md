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
**Status**: ⏳ In Progress

Update settings modal to use capabilities and unified account service.

#### Phase 3.1: Account Cards Standardization
- [x] Create generic `createGenericAccountCards()` function based on Wealthsimple pattern
- [x] Refactor `renderQuestradeTab()` to use generic cards
- [x] Refactor `renderCanadaLifeTab()` to use generic cards
- [ ] Refactor `renderRogersBankTab()` to use generic cards (has custom transaction management UI)
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
**Status**: ⏳ Not Started

Migrate each integration to consolidated structure with backward compatibility.

#### Phase 4.1: CanadaLife Migration (Simplest)
- [ ] Create CanadaLife account service module
- [ ] Implement `getCanadaLifeAccounts()` with migration logic
- [ ] Implement `updateAccountInList()` for CanadaLife
- [ ] Implement `markAccountAsSkipped()` for CanadaLife
- [ ] Add migration from prefix-based to consolidated storage
- [ ] Update `canadalife-upload.js` to use new account service
- [ ] Update settings UI to use new account service
- [ ] Add tests for migration
- [ ] Verify backward compatibility

#### Phase 4.2: Questrade Migration
- [ ] Create Questrade consolidated account service
- [ ] Implement `getQuestradeAccounts()` with migration logic
- [ ] Implement `updateAccountInList()` for Questrade
- [ ] Implement `markAccountAsSkipped()` for Questrade
- [ ] Add per-account settings (TX details in notes, retention)
- [ ] Add migration from prefix-based to consolidated storage
- [ ] Update Questrade services to use new account service
- [ ] Update settings UI to use new account service
- [ ] Add tests for migration
- [ ] Verify backward compatibility

#### Phase 4.3: Rogers Bank Migration (Most Complex)
- [ ] Create Rogers Bank account service module
- [ ] Implement `getRogersBankAccounts()` with migration logic
- [ ] Implement `updateAccountInList()` for Rogers Bank
- [ ] Implement `markAccountAsSkipped()` for Rogers Bank
- [ ] Migrate global settings to per-account
  - [ ] `ROGERSBANK_STORE_TX_DETAILS_IN_NOTES` → per-account
  - [ ] `ROGERSBANK_TRANSACTION_RETENTION_DAYS` → per-account
  - [ ] `ROGERSBANK_TRANSACTION_RETENTION_COUNT` → per-account
- [ ] Add migration from prefix-based to consolidated storage
- [ ] Update `rogersbank-upload.js` to use new account service
- [ ] Update settings UI to use new account service
- [ ] Add tests for migration
- [ ] Verify backward compatibility

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
2. **Never delete legacy storage** until migration is confirmed
3. **Add migration version flag** to track migration state per integration
4. **Provide rollback function** in case of issues
5. **Log all migration actions** for debugging

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
