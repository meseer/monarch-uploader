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

```javascript
// Add to INTEGRATIONS enum
export const INTEGRATIONS = {
  QUESTRADE: 'questrade',
  CANADALIFE: 'canadalife',
  ROGERSBANK: 'rogersbank',
  WEALTHSIMPLE: 'wealthsimple',
  NEW_INTEGRATION: 'newintegration', // Add new integration here
};

// Add configuration to INTEGRATION_CONFIG
[INTEGRATIONS.NEW_INTEGRATION]: {
  displayName: 'New Integration',
  storageKeys: {
    accountsList: 'newintegration_accounts_list',
    lookbackDays: 'newintegration_lookback_days',
    mappingPrefix: 'newintegration_monarch_account_for_',
    lastUploadPrefix: 'newintegration_last_upload_date_',
    // Add other storage keys as needed
  },
  accountKeyName: 'newintegrationAccount', // Key name in account object
  faviconDomain: 'newintegration.com',
  hasDeduplication: true, // Whether it tracks uploaded transactions
  hasTransactions: true,  // Whether it supports transaction sync
  hasBalance: true,       // Whether it supports balance sync
  hasHoldings: false,     // Whether it supports holdings sync
  hasCreditLimit: false,  // Whether it tracks credit limits
  settings: [
    ACCOUNT_SETTINGS.TRANSACTION_RETENTION_DAYS,
    ACCOUNT_SETTINGS.TRANSACTION_RETENTION_COUNT,
    ACCOUNT_SETTINGS.STORE_TX_DETAILS_IN_NOTES,
  ],
  categoryMappings: {
    enabled: false, // Set to true if integration uses category mappings
    storageKey: null,
    sourceLabel: null,
  },
}
```

### 3. Account Service Usage

**All integrations MUST use `accountService` for account operations:**

```javascript
import accountService from '../services/common/accountService';
import { INTEGRATIONS } from '../core/integrationCapabilities';

// Getting accounts
const accounts = accountService.getAccounts(INTEGRATIONS.NEW_INTEGRATION);

// Getting Monarch account mapping
const monarchAccount = accountService.getMonarchAccountMapping(
  INTEGRATIONS.NEW_INTEGRATION,
  accountId
);

// Saving/updating account
accountService.upsertAccount(INTEGRATIONS.NEW_INTEGRATION, {
  newintegrationAccount: { id: accountId, nickname: name, ... },
  monarchAccount: selectedMonarchAccount,
  syncEnabled: true,
});

// Updating specific fields
accountService.updateAccountInList(INTEGRATIONS.NEW_INTEGRATION, accountId, {
  lastSyncDate: new Date().toISOString().split('T')[0],
  uploadedTransactions: [...existingTx, ...newTx],
});

// Getting last update date (uses utils.js helper)
import { getLastUpdateDate, saveLastUploadDate } from '../core/utils';
const lastDate = getLastUpdateDate(accountId, INTEGRATIONS.NEW_INTEGRATION);
saveLastUploadDate(accountId, INTEGRATIONS.NEW_INTEGRATION, newDate);
```

### 4. Settings UI Pattern

**All integrations MUST use `createGenericAccountCards()` for settings display:**

```javascript
// In settingsModal.js renderTab function
function renderNewIntegrationTab(container) {
  // Lookback Period Section (if applicable)
  const lookbackSection = createLookbackPeriodSection('newintegration');
  container.appendChild(lookbackSection);

  // Account Mappings Section
  const mappingsSection = createSection('Account Mappings', '🔗', 'Description');
  
  const accounts = accountService.getAccounts(INTEGRATIONS.NEW_INTEGRATION);
  const accountCards = createGenericAccountCards(
    INTEGRATIONS.NEW_INTEGRATION,
    accounts,
    () => renderTabContent(container, 'newintegration')
  );
  mappingsSection.appendChild(accountCards);
  
  container.appendChild(mappingsSection);

  // Category Mappings Section (if applicable)
  const categorySection = renderCategoryMappingsSectionIfEnabled(
    INTEGRATIONS.NEW_INTEGRATION,
    () => renderTabContent(container, 'newintegration')
  );
  container.appendChild(categorySection);
}
```

## Never Do: Legacy Storage Direct Access

**NEVER access legacy storage keys directly for lookups:**

```javascript
// ❌ DON'T: Direct legacy storage access
const mapping = GM_getValue(STORAGE.PREFIX + accountId);

// ❌ DON'T: Use monarchApi.resolveAccountMapping for existing integrations
const monarchAccount = await monarchApi.resolveAccountMapping(accountId, prefix, type);

// ✅ DO: Use accountService
const monarchAccount = accountService.getMonarchAccountMapping(
  INTEGRATIONS.YOUR_INTEGRATION,
  accountId
);
```

## Transaction Deduplication Pattern

**For integrations with deduplication:**

```javascript
// Store transaction IDs in consolidated account object
const accountData = accountService.getAccountData(integrationId, accountId);
const uploadedTransactions = accountData?.uploadedTransactions || [];

// Check for duplicates
const existingIds = new Set(uploadedTransactions.map(tx => tx.id));
const newTransactions = transactions.filter(tx => !existingIds.has(tx.id));

// After successful upload, save new IDs
const today = new Date().toISOString().split('T')[0];
const newEntries = newTransactions.map(tx => ({ id: tx.id, date: today }));
const updatedTransactions = [...uploadedTransactions, ...newEntries];

accountService.updateAccountInList(integrationId, accountId, {
  uploadedTransactions: updatedTransactions,
});
```

## Migration Requirements

When migrating from legacy storage to consolidated:

1. **Support both read paths** during migration period
2. **Write only to consolidated** storage
3. **Implement sync count tracking** for cleanup
4. **Clean up legacy storage** after 2+ successful syncs

```javascript
// Sync count tracking
const newSyncCount = accountService.incrementSyncCount(integrationId, accountId);
if (accountService.isReadyForLegacyCleanup(integrationId, accountId)) {
  accountService.cleanupLegacyStorage(integrationId, accountId);
}
```

## Checklist for Adding New Integrations

Before implementing a new integration, verify:

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

### Documentation
- [ ] Update `design/settings-unification-plan.md` if applicable
- [ ] Add integration-specific documentation if needed

## Storage Key Naming Convention

```
{integration}_{purpose}_{suffix}

Examples:
- wealthsimple_accounts_list        # Consolidated account data
- questrade_lookback_days           # Global setting
- rogersbank_category_mappings      # Category mapping storage
- canadalife_monarch_account_for_{id}  # Legacy (migration only)
```

## Account Entry Structure Reference

Each account in the consolidated list should have:

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
- **Test migration path** with existing users' data
- **Keep backward compatibility** during migration periods
