# Integration Consistency Guidelines

## Overview

This document defines the patterns and requirements for maintaining consistency across all financial institution integrations (Questrade, CanadaLife, Rogers Bank, Wealthsimple, and future integrations).

## Mandatory Patterns

### 1. Consolidated Account Storage

**All integrations MUST use consolidated account storage:**

```javascript
// Storage key pattern: {integration}_accounts_list
// Example: wealthsimple_accounts_list, questrade_accounts_list

// Structure: Array of account objects with consistent schema
[
  {
    // Source account data (key varies by integration)
    [sourceAccountKey]: {
      id: "account-123",
      nickname: "Account Name",
      type: "ACCOUNT_TYPE",
      // ... other source-specific properties
    },
    
    // Monarch mapping (always this structure)
    monarchAccount: {
      id: "monarch-456",
      displayName: "Monarch Account Name",
      // ... other Monarch properties
    },
    
    // Sync state (always present)
    syncEnabled: true,
    lastSyncDate: "2024-01-15",
    
    // Per-account settings (varies by integration capabilities)
    storeTransactionDetailsInNotes: false,
    transactionRetentionDays: 91,
    transactionRetentionCount: 1000,
    
    // Transaction tracking (for deduplication)
    uploadedTransactions: [
      { id: "tx-1", date: "2024-01-10" },
      { id: "tx-2", date: "2024-01-11" },
    ],
    
    // Integration-specific fields
    // e.g., lastSyncedCreditLimit, balanceCheckpoint for credit cards
  }
]
```

### 2. Integration Capabilities Configuration

**All integrations MUST be registered in `src/core/integrationCapabilities.js`:**
- Add to `INTEGRATIONS` enum
- Add configuration to `INTEGRATION_CONFIG` with: `displayName`, `storageKeys`, `accountKeyName`, `faviconDomain`, capability flags (`hasDeduplication`, `hasTransactions`, `hasBalance`, `hasHoldings`, `hasCreditLimit`), `settings` array, and `categoryMappings` config

### 3. Account Service Usage

**All integrations MUST use `accountService` for account operations:**
- `accountService.getAccounts(integrationId)` — get all accounts
- `accountService.getMonarchAccountMapping(integrationId, accountId)` — get Monarch mapping
- `accountService.upsertAccount(integrationId, accountData)` — save/update account
- `accountService.updateAccountInList(integrationId, accountId, fields)` — update specific fields
- `getLastUpdateDate(accountId, integrationId)` / `saveLastUploadDate(accountId, integrationId, date)` from `src/core/utils`

### 4. Settings UI Pattern

**All integrations MUST use `createGenericAccountCards()` for settings display** in their `renderTab` function. Include lookback period section, account mappings section, and category mappings section (if enabled) following existing integration patterns.

## Never Do: Legacy Storage Direct Access

**NEVER access legacy storage keys directly for lookups:**
- ❌ `GM_getValue(STORAGE.PREFIX + accountId)` — direct legacy access
- ❌ `monarchApi.resolveAccountMapping(...)` — for existing integrations
- ✅ `accountService.getMonarchAccountMapping(integrationId, accountId)` — always use this

## Transaction Deduplication Pattern

For integrations with `hasDeduplication: true`:
1. Get `uploadedTransactions` from account data via `accountService`
2. Filter out already-uploaded transaction IDs
3. After successful upload, append new transaction IDs with today's date
4. Save via `accountService.updateAccountInList()`

## Migration Requirements

When migrating from legacy storage to consolidated:
1. Support both read paths during migration period
2. Write only to consolidated storage
3. Track sync count via `accountService.incrementSyncCount()`
4. Clean up legacy storage after 2+ successful syncs via `accountService.cleanupLegacyStorage()`

## Checklist for Adding New Integrations

### Configuration
- [ ] Add to `INTEGRATIONS` enum in `integrationCapabilities.js`
- [ ] Add configuration object in `INTEGRATION_CONFIG`
- [ ] Define all storage keys in `STORAGE` config
- [ ] Add storage key constants to `src/core/config.js`

### Account Service Support
- [ ] Verify `accountService` supports the new integration
- [ ] Implement migration logic if needed (in `migrateFromLegacyStorage`)
- [ ] Add cleanup logic in `cleanupLegacyStorage` if applicable

### Settings UI
- [ ] Add tab definition in `createSettingsModal`
- [ ] Implement `render{Integration}Tab` function
- [ ] Use `createGenericAccountCards` for account display
- [ ] Add favicon to tab button

### Services
- [ ] Use `accountService.getMonarchAccountMapping()` for lookups
- [ ] Use `accountService.upsertAccount()` for saving
- [ ] Use `getLastUpdateDate()` / `saveLastUploadDate()` from utils
- [ ] Implement deduplication using `uploadedTransactions` array

### Testing
- [ ] Add tests for new capabilities configuration
- [ ] Add tests for account service integration
- [ ] Add tests for upload/sync service
- [ ] Add tests for settings UI rendering

## Storage Key Naming Convention

```
{integration}_{purpose}_{suffix}

Examples:
- wealthsimple_accounts_list        # Consolidated account data
- questrade_lookback_days           # Global setting
- rogersbank_category_mappings      # Category mapping storage
```

## Account Entry Structure Reference

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `{source}Account` | Object | Yes | Source account data (e.g., `wealthsimpleAccount`) |
| `monarchAccount` | Object | No | Monarch account mapping (null if unmapped) |
| `syncEnabled` | Boolean | Yes | Whether sync is enabled for this account |
| `lastSyncDate` | String | No | ISO date of last successful sync |
| `uploadedTransactions` | Array | No* | Transaction IDs for deduplication (* required if hasDeduplication) |
| `storeTransactionDetailsInNotes` | Boolean | No | Per-account setting |
| `transactionRetentionDays` | Number | No | Per-account setting |
| `transactionRetentionCount` | Number | No | Per-account setting |
| `syncCount` | Number | No | Number of successful syncs (for migration tracking) |

## Important Notes

- **Always use capabilities** to check what an integration supports
- **Never hardcode** integration-specific logic outside capabilities
- **Test with fresh install** to ensure no legacy data dependency
- **Keep backward compatibility** during migration periods