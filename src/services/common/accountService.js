/**
 * Unified Account Service
 *
 * Provides a common interface for account operations across all integrations.
 * Handles backward compatibility with legacy prefix-based storage and
 * migration to the consolidated account list structure.
 */

import { debugLog } from '../../core/utils';
import { STORAGE } from '../../core/config';
import {
  INTEGRATIONS,
  getAccountKeyName,
  getDefaultSettings,
} from '../../core/integrationCapabilities';

/**
 * Storage key mapping for each integration's consolidated account list
 */
const ACCOUNT_LIST_STORAGE_KEYS = {
  [INTEGRATIONS.WEALTHSIMPLE]: STORAGE.WEALTHSIMPLE_ACCOUNTS_LIST,
  [INTEGRATIONS.QUESTRADE]: STORAGE.ACCOUNTS_LIST, // Legacy key name
  [INTEGRATIONS.CANADALIFE]: STORAGE.CANADALIFE_ACCOUNTS_LIST,
  [INTEGRATIONS.ROGERSBANK]: STORAGE.ROGERSBANK_ACCOUNTS_LIST,
};

/**
 * Legacy storage prefix mapping for each integration
 */
const LEGACY_MAPPING_PREFIXES = {
  [INTEGRATIONS.WEALTHSIMPLE]: null, // Wealthsimple already uses consolidated
  [INTEGRATIONS.QUESTRADE]: STORAGE.QUESTRADE_ACCOUNT_MAPPING_PREFIX,
  [INTEGRATIONS.CANADALIFE]: STORAGE.CANADALIFE_ACCOUNT_MAPPING_PREFIX,
  [INTEGRATIONS.ROGERSBANK]: STORAGE.ROGERSBANK_ACCOUNT_MAPPING_PREFIX,
};

/**
 * Legacy last upload date prefix mapping
 */
const LEGACY_LAST_UPLOAD_PREFIXES = {
  [INTEGRATIONS.WEALTHSIMPLE]: null, // Stored in account object
  [INTEGRATIONS.QUESTRADE]: STORAGE.QUESTRADE_LAST_UPLOAD_DATE_PREFIX,
  [INTEGRATIONS.CANADALIFE]: STORAGE.CANADALIFE_LAST_UPLOAD_DATE_PREFIX,
  [INTEGRATIONS.ROGERSBANK]: STORAGE.ROGERSBANK_LAST_UPLOAD_DATE_PREFIX,
};

/**
 * Legacy uploaded transactions/orders prefix mapping
 * For integrations with deduplication, this is where transaction IDs are stored
 */
const LEGACY_UPLOADED_TRANSACTIONS_PREFIXES = {
  [INTEGRATIONS.WEALTHSIMPLE]: null, // Stored in account object (uploadedTransactions)
  [INTEGRATIONS.QUESTRADE]: STORAGE.QUESTRADE_UPLOADED_ORDERS_PREFIX,
  [INTEGRATIONS.CANADALIFE]: null, // CanadaLife doesn't have deduplication
  [INTEGRATIONS.ROGERSBANK]: STORAGE.ROGERSBANK_UPLOADED_REFS_PREFIX,
};

/**
 * Get the storage key for an integration's account list
 * @param {string} integrationId - Integration identifier
 * @returns {string|null} Storage key or null if not found
 */
export function getStorageKey(integrationId) {
  return ACCOUNT_LIST_STORAGE_KEYS[integrationId] || null;
}

/**
 * Detect if stored data is stale raw cache from old Questrade API format
 * Before v5.58.2, Questrade API incorrectly wrote raw account cache to ACCOUNTS_LIST.
 * Raw cache format: [{key, number, type, ...}] - has 'key' at root, no 'questradeAccount'
 * Consolidated format: [{questradeAccount: {...}, monarchAccount: {...}}]
 * @param {Array} accounts - Parsed accounts array
 * @param {string} integrationId - Integration identifier
 * @returns {boolean} True if this is stale raw cache that should be cleared
 */
function isStaleRawCache(accounts, integrationId) {
  if (integrationId !== INTEGRATIONS.QUESTRADE) {
    return false;
  }
  if (!Array.isArray(accounts) || accounts.length === 0) {
    return false;
  }

  // Check first item - if it has 'key' at root but no 'questradeAccount', it's stale cache
  const firstAccount = accounts[0];
  return Boolean(firstAccount.key && !firstAccount.questradeAccount);
}

/**
 * Get all accounts for an integration
 * Attempts to read from consolidated storage first, then migrates from legacy if needed
 * @param {string} integrationId - Integration identifier
 * @returns {Array} Array of consolidated account objects
 */
export function getAccounts(integrationId) {
  try {
    const storageKey = getStorageKey(integrationId);
    if (!storageKey) {
      debugLog(`Unknown integration: ${integrationId}`);
      return [];
    }

    // Try to read from consolidated storage
    const stored = GM_getValue(storageKey, '[]');
    let accounts = [];

    try {
      accounts = JSON.parse(stored);
    } catch (e) {
      debugLog(`Error parsing accounts for ${integrationId}:`, e);
      accounts = [];
    }

    // Detect and clear stale raw cache data (from pre-v5.58.2 bug)
    // This was caused by Questrade API writing raw cache to ACCOUNTS_LIST key
    if (isStaleRawCache(accounts, integrationId)) {
      debugLog(`Detected stale raw cache in ${storageKey}, clearing to trigger migration...`);
      GM_setValue(storageKey, '[]');
      accounts = [];
    }

    // If consolidated storage is empty, try to migrate from legacy
    if (accounts.length === 0 && hasLegacyData(integrationId)) {
      debugLog(`Migrating legacy data for ${integrationId}`);
      accounts = migrateFromLegacyStorage(integrationId);
    }

    // Check for and merge legacy transaction data if uploadedTransactions is missing
    // This handles accounts that were migrated before transaction migration was added
    const uploadedTransactionsPrefix = LEGACY_UPLOADED_TRANSACTIONS_PREFIXES[integrationId];
    if (uploadedTransactionsPrefix && accounts.length > 0) {
      const accountKeyName = getAccountKeyName(integrationId);
      let needsSave = false;

      accounts = accounts.map((account) => {
        // Skip if already has uploadedTransactions
        if (account.uploadedTransactions && account.uploadedTransactions.length > 0) {
          return account;
        }

        const accountId = account[accountKeyName]?.id;
        if (!accountId) {
          return account;
        }

        // Check for legacy transaction data
        const legacyTransactions = GM_getValue(`${uploadedTransactionsPrefix}${accountId}`, null);
        if (legacyTransactions) {
          try {
            const parsed = Array.isArray(legacyTransactions)
              ? legacyTransactions
              : JSON.parse(legacyTransactions);

            // Normalize to array of objects with id and optional date
            const uploadedTransactions = parsed.map((item) => {
              if (typeof item === 'string') {
                return { id: item, date: null };
              }
              return item;
            });

            if (uploadedTransactions.length > 0) {
              debugLog(`Merged ${uploadedTransactions.length} legacy transactions for ${accountId}`);
              needsSave = true;
              return { ...account, uploadedTransactions };
            }
          } catch (e) {
            debugLog(`Error parsing legacy transactions for ${accountId}:`, e);
          }
        }

        return account;
      });

      // Save the updated accounts if we merged any transactions
      if (needsSave) {
        saveAccounts(integrationId, accounts);
      }
    }

    return accounts;
  } catch (error) {
    debugLog(`Error getting accounts for ${integrationId}:`, error);
    return [];
  }
}

/**
 * Get single account data by ID
 * @param {string} integrationId - Integration identifier
 * @param {string} accountId - Account ID
 * @returns {Object|null} Consolidated account object or null
 */
export function getAccountData(integrationId, accountId) {
  const accounts = getAccounts(integrationId);
  const accountKeyName = getAccountKeyName(integrationId);

  if (!accountKeyName) {
    return null;
  }

  return accounts.find((acc) => acc[accountKeyName]?.id === accountId) || null;
}

/**
 * Save accounts list for an integration
 * @param {string} integrationId - Integration identifier
 * @param {Array} accounts - Array of consolidated account objects
 * @returns {boolean} Success status
 */
export function saveAccounts(integrationId, accounts) {
  try {
    const storageKey = getStorageKey(integrationId);
    if (!storageKey) {
      debugLog(`Unknown integration: ${integrationId}`);
      return false;
    }

    GM_setValue(storageKey, JSON.stringify(accounts));
    debugLog(`Saved ${accounts.length} accounts for ${integrationId}`);
    return true;
  } catch (error) {
    debugLog(`Error saving accounts for ${integrationId}:`, error);
    return false;
  }
}

/**
 * Update specific account properties in the consolidated list
 * @param {string} integrationId - Integration identifier
 * @param {string} accountId - Account ID
 * @param {Object} updates - Properties to update
 * @returns {boolean} Success status
 */
export function updateAccountInList(integrationId, accountId, updates) {
  try {
    const accounts = getAccounts(integrationId);
    const accountKeyName = getAccountKeyName(integrationId);

    if (!accountKeyName) {
      debugLog(`Unknown account key name for ${integrationId}`);
      return false;
    }

    const accountIndex = accounts.findIndex(
      (acc) => acc[accountKeyName]?.id === accountId,
    );

    if (accountIndex === -1) {
      debugLog(`Account ${accountId} not found in ${integrationId} list`);
      return false;
    }

    // Merge updates
    accounts[accountIndex] = {
      ...accounts[accountIndex],
      ...updates,
    };

    return saveAccounts(integrationId, accounts);
  } catch (error) {
    debugLog(`Error updating account ${accountId} in ${integrationId}:`, error);
    return false;
  }
}

/**
 * Add or update an account in the consolidated list
 * If account exists, updates it; otherwise adds new
 * @param {string} integrationId - Integration identifier
 * @param {Object} accountData - Full account data object
 * @returns {boolean} Success status
 */
export function upsertAccount(integrationId, accountData) {
  try {
    const accounts = getAccounts(integrationId);
    const accountKeyName = getAccountKeyName(integrationId);

    if (!accountKeyName) {
      return false;
    }

    const accountId = accountData[accountKeyName]?.id;
    if (!accountId) {
      debugLog('Account data missing ID');
      return false;
    }

    const existingIndex = accounts.findIndex(
      (acc) => acc[accountKeyName]?.id === accountId,
    );

    if (existingIndex >= 0) {
      // Update existing
      accounts[existingIndex] = {
        ...accounts[existingIndex],
        ...accountData,
      };
    } else {
      // Add new with defaults
      const defaults = getDefaultSettings(integrationId);
      accounts.push({
        syncEnabled: true,
        ...defaults,
        ...accountData,
      });
    }

    return saveAccounts(integrationId, accounts);
  } catch (error) {
    debugLog(`Error upserting account in ${integrationId}:`, error);
    return false;
  }
}

/**
 * Remove an account from the consolidated list
 * @param {string} integrationId - Integration identifier
 * @param {string} accountId - Account ID to remove
 * @returns {boolean} Success status
 */
export function removeAccount(integrationId, accountId) {
  try {
    const accounts = getAccounts(integrationId);
    const accountKeyName = getAccountKeyName(integrationId);

    if (!accountKeyName) {
      return false;
    }

    const filteredAccounts = accounts.filter(
      (acc) => acc[accountKeyName]?.id !== accountId,
    );

    if (filteredAccounts.length === accounts.length) {
      debugLog(`Account ${accountId} not found in ${integrationId}`);
      return false;
    }

    return saveAccounts(integrationId, filteredAccounts);
  } catch (error) {
    debugLog(`Error removing account ${accountId} from ${integrationId}:`, error);
    return false;
  }
}

/**
 * Mark account as skipped or unskip it (updates syncEnabled flag)
 * @param {string} integrationId - Integration identifier
 * @param {string} accountId - Account ID
 * @param {boolean} skipped - Whether to skip this account (inverts to syncEnabled)
 * @returns {boolean} Success status
 */
export function markAccountAsSkipped(integrationId, accountId, skipped = true) {
  const success = updateAccountInList(integrationId, accountId, {
    syncEnabled: !skipped,
  });
  if (success) {
    const action = skipped ? 'disabled' : 'enabled';
    debugLog(`Account ${accountId} sync ${action} for ${integrationId}`);
  }
  return success;
}

/**
 * Check if an account is marked as skipped (checks syncEnabled flag)
 * @param {string} integrationId - Integration identifier
 * @param {string} accountId - Account ID
 * @returns {boolean} True if account sync is disabled
 */
export function isAccountSkipped(integrationId, accountId) {
  const accountData = getAccountData(integrationId, accountId);
  return accountData ? !accountData.syncEnabled : false;
}

/**
 * Get a specific setting value for an account
 * @param {string} integrationId - Integration identifier
 * @param {string} accountId - Account ID
 * @param {string} settingKey - Setting key
 * @returns {*} Setting value or undefined
 */
export function getAccountSetting(integrationId, accountId, settingKey) {
  const accountData = getAccountData(integrationId, accountId);
  if (!accountData) {
    return undefined;
  }

  // Return value if set, otherwise return default from capabilities
  if (accountData[settingKey] !== undefined) {
    return accountData[settingKey];
  }

  const defaults = getDefaultSettings(integrationId);
  return defaults[settingKey];
}

/**
 * Set a specific setting value for an account
 * @param {string} integrationId - Integration identifier
 * @param {string} accountId - Account ID
 * @param {string} settingKey - Setting key
 * @param {*} value - Value to set
 * @returns {boolean} Success status
 */
export function setAccountSetting(integrationId, accountId, settingKey, value) {
  return updateAccountInList(integrationId, accountId, {
    [settingKey]: value,
  });
}

/**
 * Check if legacy prefix-based data exists for an integration
 * @param {string} integrationId - Integration identifier
 * @returns {boolean} True if legacy data exists
 */
export function hasLegacyData(integrationId) {
  const prefix = LEGACY_MAPPING_PREFIXES[integrationId];
  if (!prefix) {
    return false;
  }

  try {
    const allKeys = GM_listValues();
    return allKeys.some((key) => key.startsWith(prefix));
  } catch (error) {
    debugLog(`Error checking legacy data for ${integrationId}:`, error);
    return false;
  }
}

/**
 * Detect if stored data is a raw source account (e.g., Questrade account) vs a Monarch mapping
 * @param {Object} data - Parsed JSON data from storage
 * @param {string} integrationId - Integration identifier
 * @returns {boolean} True if this is raw source account data
 */
function isSourceAccountData(data, integrationId) {
  if (!data || typeof data !== 'object') {
    return false;
  }

  // Questrade accounts have distinctive fields like 'number', 'accountDetailType', 'productType'
  if (integrationId === INTEGRATIONS.QUESTRADE) {
    return Boolean(data.number || data.accountDetailType || data.productType || data.accountStatus);
  }

  // CanadaLife accounts have 'id' and usually 'nickname' but no 'displayName' at root
  if (integrationId === INTEGRATIONS.CANADALIFE) {
    // If it has canadalifAccount nested, it's already in consolidated format
    if (data.canadalifAccount) {
      return false;
    }
    // If it has displayName at root, it's likely a Monarch mapping
    return !data.displayName && (data.id || data.nickname);
  }

  // Rogers Bank similar pattern
  if (integrationId === INTEGRATIONS.ROGERSBANK) {
    // Monarch accounts have displayName, source accounts might have accountNumber
    return !data.displayName && (data.accountNumber || data.accountId);
  }

  // Default: assume Monarch mapping if it has displayName
  return !data.displayName;
}

/**
 * Migrate from legacy prefix-based storage to consolidated structure
 * Does NOT delete legacy data (safety rule)
 * @param {string} integrationId - Integration identifier
 * @returns {Array} Migrated accounts array
 */
export function migrateFromLegacyStorage(integrationId) {
  const prefix = LEGACY_MAPPING_PREFIXES[integrationId];
  const lastUploadPrefix = LEGACY_LAST_UPLOAD_PREFIXES[integrationId];
  const uploadedTransactionsPrefix = LEGACY_UPLOADED_TRANSACTIONS_PREFIXES[integrationId];
  const accountKeyName = getAccountKeyName(integrationId);

  if (!prefix || !accountKeyName) {
    debugLog(`Cannot migrate ${integrationId}: missing prefix or key name`);
    return [];
  }

  try {
    const allKeys = GM_listValues();
    const accountMappingKeys = allKeys.filter((key) => key.startsWith(prefix));

    if (accountMappingKeys.length === 0) {
      return [];
    }

    debugLog(`Found ${accountMappingKeys.length} legacy accounts for ${integrationId}`);

    const migratedAccounts = [];
    const defaults = getDefaultSettings(integrationId);

    for (const key of accountMappingKeys) {
      try {
        const accountId = key.replace(prefix, '');
        const storedJson = GM_getValue(key, null);

        if (!storedJson) {
          continue;
        }

        const storedData = JSON.parse(storedJson);

        // Get last upload date from legacy storage
        let lastSyncDate = null;
        if (lastUploadPrefix) {
          lastSyncDate = GM_getValue(`${lastUploadPrefix}${accountId}`, null);
        }

        // Get uploaded transactions from legacy storage (for deduplication)
        let uploadedTransactions = [];
        if (uploadedTransactionsPrefix) {
          const legacyTransactions = GM_getValue(`${uploadedTransactionsPrefix}${accountId}`, null);
          if (legacyTransactions) {
            try {
              // Legacy format could be array of strings or already array of objects
              const parsed = Array.isArray(legacyTransactions)
                ? legacyTransactions
                : JSON.parse(legacyTransactions);

              // Normalize to array of objects with id and optional date
              uploadedTransactions = parsed.map((item) => {
                if (typeof item === 'string') {
                  return { id: item, date: null }; // Legacy string format
                }
                return item; // Already in object format
              });
              debugLog(`Migrated ${uploadedTransactions.length} uploaded transactions for ${accountId}`);
            } catch (e) {
              debugLog(`Error parsing legacy transactions for ${accountId}:`, e);
            }
          }
        }

        let consolidatedAccount;

        // Detect if stored data is source account data or Monarch mapping
        if (isSourceAccountData(storedData, integrationId)) {
          // Stored data is the raw source account (e.g., Questrade account)
          // Use stored data as the source account, no Monarch mapping yet
          debugLog(`Detected source account data for ${accountId} in ${integrationId}`);

          consolidatedAccount = {
            // Source account from stored data
            [accountKeyName]: {
              id: storedData.key || storedData.id || accountId,
              nickname: storedData.nickname || storedData.name || accountId,
              // Preserve additional source account fields
              ...(storedData.number && { number: storedData.number }),
              ...(storedData.type && { type: storedData.type }),
              ...(storedData.accountDetailType && { accountDetailType: storedData.accountDetailType }),
              ...(storedData.accountType && { accountType: storedData.accountType }),
              ...(storedData.productType && { productType: storedData.productType }),
              ...(storedData.accountStatus && { accountStatus: storedData.accountStatus }),
            },
            // No Monarch mapping - will be created on next sync
            monarchAccount: null,
            // Sync state
            syncEnabled: true,
            lastSyncDate,
            // Uploaded transactions for deduplication
            uploadedTransactions,
            // Default settings
            ...defaults,
          };
        } else {
          // Stored data is a Monarch account mapping (has displayName, etc.)
          // This is the original expected format
          debugLog(`Detected Monarch mapping data for ${accountId} in ${integrationId}`);

          consolidatedAccount = {
            // Source account (minimal info from legacy - just ID)
            [accountKeyName]: {
              id: accountId,
              nickname: storedData.displayName || accountId,
            },
            // Monarch mapping
            monarchAccount: storedData,
            // Sync state
            syncEnabled: true,
            lastSyncDate,
            // Uploaded transactions for deduplication
            uploadedTransactions,
            // Default settings
            ...defaults,
          };
        }

        migratedAccounts.push(consolidatedAccount);
        debugLog(`Migrated account ${accountId} for ${integrationId}`);
      } catch (e) {
        debugLog(`Error migrating account from key ${key}:`, e);
      }
    }

    // Save migrated accounts to consolidated storage
    if (migratedAccounts.length > 0) {
      saveAccounts(integrationId, migratedAccounts);
      debugLog(`Saved ${migratedAccounts.length} migrated accounts for ${integrationId}`);
    }

    return migratedAccounts;
  } catch (error) {
    debugLog(`Error during migration for ${integrationId}:`, error);
    return [];
  }
}

/**
 * Get migration status for an integration
 * @param {string} integrationId - Integration identifier
 * @returns {Object} Migration status {hasConsolidated, hasLegacy, needsMigration}
 */
export function getMigrationStatus(integrationId) {
  const storageKey = getStorageKey(integrationId);
  let hasConsolidated = false;

  if (storageKey) {
    try {
      const stored = GM_getValue(storageKey, '[]');
      const accounts = JSON.parse(stored);
      hasConsolidated = accounts.length > 0;
    } catch (e) {
      hasConsolidated = false;
    }
  }

  const hasLegacy = hasLegacyData(integrationId);

  return {
    hasConsolidated,
    hasLegacy,
    needsMigration: hasLegacy && !hasConsolidated,
  };
}

/**
 * Clear all account data for an integration (use with caution!)
 * @param {string} integrationId - Integration identifier
 * @param {boolean} includeLegacy - Also clear legacy data
 * @returns {boolean} Success status
 */
export function clearAllAccounts(integrationId, includeLegacy = false) {
  try {
    // Clear consolidated storage
    const storageKey = getStorageKey(integrationId);
    if (storageKey) {
      GM_setValue(storageKey, '[]');
    }

    // Optionally clear legacy data
    if (includeLegacy) {
      const prefix = LEGACY_MAPPING_PREFIXES[integrationId];
      const lastUploadPrefix = LEGACY_LAST_UPLOAD_PREFIXES[integrationId];

      if (prefix || lastUploadPrefix) {
        const allKeys = GM_listValues();

        allKeys.forEach((key) => {
          if ((prefix && key.startsWith(prefix))
              || (lastUploadPrefix && key.startsWith(lastUploadPrefix))) {
            GM_deleteValue(key);
          }
        });
      }
    }

    debugLog(`Cleared accounts for ${integrationId} (includeLegacy: ${includeLegacy})`);
    return true;
  } catch (error) {
    debugLog(`Error clearing accounts for ${integrationId}:`, error);
    return false;
  }
}

export default {
  // Core CRUD operations
  getAccounts,
  getAccountData,
  saveAccounts,
  updateAccountInList,
  upsertAccount,
  removeAccount,

  // Sync state management
  markAccountAsSkipped,
  isAccountSkipped,

  // Settings helpers
  getAccountSetting,
  setAccountSetting,

  // Migration helpers
  hasLegacyData,
  migrateFromLegacyStorage,
  getMigrationStatus,
  clearAllAccounts,

  // Utilities
  getStorageKey,
};
