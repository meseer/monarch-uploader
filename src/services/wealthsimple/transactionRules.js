/**
 * Wealthsimple Transaction Rules Engine
 * Handles automatic categorization and field mapping for different transaction types
 *
 * This file contains rules for processing Wealthsimple CASH account transactions.
 * Each rule defines:
 * - match: A function that returns true if the rule applies to a transaction
 * - process: A function that extracts/generates the transaction fields
 *
 * Rules are evaluated in order - first matching rule wins.
 */

import { debugLog } from '../../core/utils';
import { STORAGE } from '../../core/config';
import { applyMerchantMapping } from '../../mappers/merchant';

/**
 * Get account name from the cached Wealthsimple accounts list by account ID
 * Used for looking up opposing account names in internal transfers
 * @param {string} accountId - Wealthsimple account ID
 * @returns {string} Account nickname or 'Unknown Account' if not found
 */
export function getAccountNameById(accountId) {
  if (!accountId) {
    return 'Unknown Account';
  }

  try {
    const accountsJson = GM_getValue(STORAGE.WEALTHSIMPLE_ACCOUNTS_LIST, '[]');
    const accounts = JSON.parse(accountsJson);

    const account = accounts.find((acc) => acc.wealthsimpleAccount?.id === accountId);
    if (account && account.wealthsimpleAccount?.nickname) {
      return account.wealthsimpleAccount.nickname;
    }

    return 'Unknown Account';
  } catch (error) {
    debugLog('Error looking up account by ID:', error);
    return 'Unknown Account';
  }
}

/**
 * AFT transaction type to Monarch category mapping
 * These are known AFT types that map directly to specific categories
 */
const AFT_TYPE_CATEGORY_MAP = {
  payroll_deposit: 'Paychecks',
  insurance: 'Healthcare',
  misc_payments: 'Reimbursement',
};

/**
 * Get category for AFT transaction based on aftTransactionType
 * @param {string} aftTransactionType - The AFT transaction type from Wealthsimple
 * @returns {string|null} Monarch category name or null if needs mapping
 */
function getAftCategory(aftTransactionType) {
  if (!aftTransactionType) {
    return null;
  }
  return AFT_TYPE_CATEGORY_MAP[aftTransactionType] || null;
}

/**
 * Get display name for e-transfer participant
 * Falls back to email, then "Unknown" if both are missing
 * @param {Object} transaction - Raw transaction object
 * @returns {string} Display name
 */
function getETransferDisplayName(transaction) {
  if (transaction.eTransferName) {
    return transaction.eTransferName;
  }
  if (transaction.eTransferEmail) {
    return transaction.eTransferEmail;
  }
  return 'Unknown';
}

/**
 * Extract Interac memo from funding intent data
 * For incoming transfers (e_transfer_receive): memo is in transferMetadata.memo
 * For outgoing transfers (e_transfer_send): memo is in transferMetadata.message or transferMetadata.memo
 *
 * @param {Object|null} fundingIntent - Funding intent data from FetchFundingIntent API
 * @returns {string} Memo text or empty string if not found
 */
export function extractInteracMemo(fundingIntent) {
  if (!fundingIntent || !fundingIntent.transferMetadata) {
    return '';
  }

  const metadata = fundingIntent.transferMetadata;

  // Incoming e-transfers use 'memo' field
  if (metadata.memo) {
    return metadata.memo;
  }

  // Outgoing e-transfers use 'message' field
  if (metadata.message) {
    return metadata.message;
  }

  return '';
}

/**
 * Extract outgoing e-transfer details from funding intent data
 * For outgoing transfers: extracts autoDeposit status and network payment reference ID
 *
 * @param {Object|null} fundingIntent - Funding intent data from FetchFundingIntent API
 * @returns {Object} Object with { autoDeposit: string|null, networkPaymentRefId: string|null }
 */
export function extractOutgoingETransferDetails(fundingIntent) {
  const result = {
    autoDeposit: null,
    networkPaymentRefId: null,
  };

  if (!fundingIntent || !fundingIntent.transferMetadata) {
    return result;
  }

  const metadata = fundingIntent.transferMetadata;

  // Extract auto-deposit status (convert boolean to Yes/No)
  if (typeof metadata.autoDeposit === 'boolean') {
    result.autoDeposit = metadata.autoDeposit ? 'Yes' : 'No';
  }

  // Extract network payment reference ID
  if (metadata.networkPaymentRefId) {
    result.networkPaymentRefId = metadata.networkPaymentRefId;
  }

  return result;
}

/**
 * Format outgoing e-transfer details as a string for notes
 * Format: "Auto Deposit: Yes; Reference Number: CAkJgEwf"
 *
 * @param {Object} details - Object from extractOutgoingETransferDetails
 * @returns {string} Formatted string or empty if no details available
 */
export function formatOutgoingETransferDetails(details) {
  if (!details) {
    return '';
  }

  const parts = [];

  if (details.autoDeposit !== null) {
    parts.push(`Auto Deposit: ${details.autoDeposit}`);
  }

  if (details.networkPaymentRefId !== null) {
    parts.push(`Reference Number: ${details.networkPaymentRefId}`);
  }

  return parts.join('; ');
}

/**
 * Extract annotation (user note) from internal transfer data
 *
 * @param {Object|null} internalTransfer - Internal transfer data from FetchInternalTransfer API
 * @returns {string} Annotation text or empty string if not found
 */
export function extractInternalTransferAnnotation(internalTransfer) {
  if (!internalTransfer) {
    return '';
  }

  return internalTransfer.annotation || '';
}

/**
 * Transaction rules for CASH accounts
 * Each rule has:
 * - id: Unique identifier for the rule
 * - match: Function (transaction) => boolean - returns true if rule applies
 * - process: Function (transaction, fundingIntentMap) => Object - returns processed fields
 *
 * Processed fields include:
 * - category: Monarch category name
 * - merchant: Merchant name for display
 * - originalStatement: Original statement text
 * - notes: Optional notes (memo only, e.g., Interac memo from funding intent)
 * - technicalDetails: Optional technical details (e.g., auto-deposit status, reference number)
 */
export const CASH_TRANSACTION_RULES = [
  {
    id: 'e-transfer',
    description: 'Interac e-Transfer transactions (incoming and outgoing)',
    match: (tx) => tx.subType === 'E_TRANSFER',
    process: (tx, fundingIntentMap) => {
      const displayName = getETransferDisplayName(tx);
      const email = tx.eTransferEmail || '';

      // Generate merchant and original statement based on transaction type
      let merchant;
      let originalStatement;

      if (tx.type === 'WITHDRAWAL') {
        merchant = `e-Transfer to ${displayName}`;
        originalStatement = email
          ? `Interac e-Transfer to ${displayName} (${email})`
          : `Interac e-Transfer to ${displayName}`;
      } else {
        // DEPOSIT or other types - treat as incoming
        merchant = `e-Transfer from ${displayName}`;
        originalStatement = email
          ? `Interac e-Transfer from ${displayName} (${email})`
          : `Interac e-Transfer from ${displayName}`;
      }

      // Extract Interac memo and additional details from funding intent data if available
      let notes = '';
      let technicalDetails = '';
      if (fundingIntentMap && tx.externalCanonicalId) {
        const fundingIntent = fundingIntentMap.get(tx.externalCanonicalId);
        if (fundingIntent) {
          // Extract memo for all e-transfers
          const memo = extractInteracMemo(fundingIntent);
          if (memo) {
            debugLog(`Found Interac memo for ${tx.externalCanonicalId}: "${memo}"`);
            notes = memo;
          }

          // For outgoing transfers, also extract auto-deposit and reference number
          if (tx.type === 'WITHDRAWAL') {
            const outgoingDetails = extractOutgoingETransferDetails(fundingIntent);
            const formattedDetails = formatOutgoingETransferDetails(outgoingDetails);

            if (formattedDetails) {
              debugLog(`Found outgoing e-transfer details for ${tx.externalCanonicalId}: "${formattedDetails}"`);
              technicalDetails = formattedDetails;
            }
          }
        }
      }

      return {
        category: 'Transfer',
        merchant,
        originalStatement,
        notes,
        technicalDetails,
      };
    },
  },
  {
    id: 'spend-prepaid',
    description: 'Prepaid card spending transactions (debit-style purchases in CASH account)',
    match: (tx) => tx.type === 'SPEND' && tx.subType === 'PREPAID',
    /**
     * Process SPEND/PREPAID transactions
     * These are debit-style purchases that use the 'status' field (like credit cards)
     * instead of 'unifiedStatus' (like other CASH transactions).
     *
     * Status mapping:
     * - 'settled': Final transaction (sync as normal)
     * - 'authorized': Pending transaction (sync with Pending tag)
     * - Other statuses: Rejected (exclude from sync)
     *
     * @param {Object} tx - Raw transaction
     * @returns {Object} Processed transaction fields
     */
    process: (tx) => {
      const originalMerchant = tx.spendMerchant || 'Unknown Merchant';
      const cleanedMerchant = applyMerchantMapping(originalMerchant, { stripStoreNumbers: true });

      return {
        // Category will be resolved via user category mapping (like credit cards)
        category: null, // null indicates needs category mapping
        merchant: cleanedMerchant,
        originalStatement: originalMerchant,
        notes: '',
        technicalDetails: '',
        // Flag to indicate this transaction needs category resolution
        needsCategoryMapping: true,
        // Store the category key for mapping (merchant name)
        categoryKey: cleanedMerchant,
      };
    },
  },
  {
    id: 'deposit-aft',
    description: 'AFT (Automated Funds Transfer) deposit transactions - payroll, insurance, etc.',
    match: (tx) => tx.type === 'DEPOSIT' && tx.subType === 'AFT',
    /**
     * Process DEPOSIT/AFT transactions
     * AFT transactions have additional metadata:
     * - aftTransactionCategory: General category (e.g., "payroll", "insurance")
     * - aftTransactionType: Specific type (e.g., "payroll_deposit", "insurance", "misc_payments")
     * - aftOriginatorName: Name of the organization that initiated the transfer
     *
     * Category mapping:
     * - Known types (payroll_deposit, insurance, misc_payments): Auto-categorized
     * - Unknown types: User maps via category selector, saved for future transactions
     *
     * @param {Object} tx - Raw transaction
     * @returns {Object} Processed transaction fields
     */
    process: (tx) => {
      const originatorName = tx.aftOriginatorName || 'Unknown AFT';
      const aftTransactionType = tx.aftTransactionType || '';
      const aftTransactionCategory = tx.aftTransactionCategory || '';

      // Try to get automatic category mapping
      const autoCategory = getAftCategory(aftTransactionType);

      if (autoCategory) {
        // Known AFT type - auto-categorize
        debugLog(`AFT transaction auto-categorized: ${aftTransactionType} -> ${autoCategory}`);
        return {
          category: autoCategory,
          merchant: originatorName,
          originalStatement: originatorName,
          notes: '',
          technicalDetails: '',
          needsCategoryMapping: false,
        };
      }

      // Unknown AFT type - needs category mapping
      // Use aftTransactionType as the category key for mapping/saving
      debugLog(`AFT transaction needs mapping: ${aftTransactionType}`);
      return {
        category: null,
        merchant: originatorName,
        originalStatement: originatorName,
        notes: '',
        technicalDetails: '',
        needsCategoryMapping: true,
        // Use aftTransactionType as category key for similarity matching and saving
        categoryKey: aftTransactionType || originatorName,
        // Store AFT details for category selector display
        aftDetails: {
          aftTransactionCategory,
          aftTransactionType,
          aftOriginatorName: originatorName,
        },
      };
    },
  },
  {
    id: 'internal-transfer',
    description: 'Internal transfers between Wealthsimple accounts (SOURCE and DESTINATION)',
    match: (tx) => tx.type === 'INTERNAL_TRANSFER' && (tx.subType === 'SOURCE' || tx.subType === 'DESTINATION'),
    /**
     * Process INTERNAL_TRANSFER transactions
     * These are transfers between Wealthsimple accounts, showing both sides:
     * - DESTINATION: Money coming into the current account
     * - SOURCE: Money leaving the current account
     *
     * Uses opposingAccountId to look up the name of the other account involved.
     * Uses internalTransferMap to fetch annotation (user note) for the transfer.
     *
     * @param {Object} tx - Raw transaction
     * @param {Map<string, Object>} internalTransferMap - Optional map of internal transfer ID to details
     * @returns {Object} Processed transaction fields
     */
    process: (tx, internalTransferMap) => {
      // Look up the opposing account name from the cached accounts list
      const opposingName = getAccountNameById(tx.opposingAccountId);
      // Look up the current account name as well
      const accountName = getAccountNameById(tx.accountId);

      let merchant;
      let originalStatement;

      if (tx.subType === 'DESTINATION') {
        // Money coming INTO this account - format: "Transfer In: ${accountName} ← ${opposingName}"
        merchant = `Transfer In: ${accountName} ← ${opposingName}`;
        originalStatement = `Transfer In: ${accountName} ← ${opposingName}`;
      } else {
        // SOURCE - Money leaving this account - format: "Transfer Out: ${accountName} → ${opposingName}"
        merchant = `Transfer Out: ${accountName} → ${opposingName}`;
        originalStatement = `Transfer Out: ${accountName} → ${opposingName}`;
      }

      // Extract annotation from internal transfer data if available
      let notes = '';
      if (internalTransferMap && tx.externalCanonicalId) {
        const internalTransfer = internalTransferMap.get(tx.externalCanonicalId);
        if (internalTransfer) {
          const annotation = extractInternalTransferAnnotation(internalTransfer);
          if (annotation) {
            debugLog(`Found internal transfer annotation for ${tx.externalCanonicalId}: "${annotation}"`);
            notes = annotation;
          }
        }
      }

      return {
        category: 'Transfer',
        merchant,
        originalStatement,
        notes,
        technicalDetails: '',
      };
    },
  },
  {
    id: 'withdrawal-bill-pay',
    description: 'Bill payment transactions',
    match: (tx) => tx.type === 'WITHDRAWAL' && tx.subType === 'BILL_PAY',
    /**
     * Process WITHDRAWAL/BILL_PAY transactions
     * These are bill payments that have additional metadata:
     * - billPayCompanyName: The company receiving the payment (e.g., "BC Hydro")
     * - billPayPayeeNickname: User's nickname for the payee (e.g., "Home Electricity")
     * - redactedExternalAccountNumber: Partially redacted account number (e.g., "****1234")
     *
     * Category is determined by user via category mapper based on billPayPayeeNickname.
     * The category selector displays all three fields to help user identify the payment.
     *
     * @param {Object} tx - Raw transaction
     * @returns {Object} Processed transaction fields
     */
    process: (tx) => {
      const billPayCompanyName = tx.billPayCompanyName || 'Unknown Company';
      const billPayPayeeNickname = tx.billPayPayeeNickname || 'Unknown Payee';
      const redactedExternalAccountNumber = tx.redactedExternalAccountNumber || '';

      return {
        category: null, // User selects via category mapper
        merchant: billPayPayeeNickname,
        originalStatement: `${billPayCompanyName} (${redactedExternalAccountNumber})`,
        notes: '',
        technicalDetails: '',
        needsCategoryMapping: true,
        categoryKey: billPayPayeeNickname,
        // Store bill pay details for category selector display
        billPayDetails: {
          billPayCompanyName,
          billPayPayeeNickname,
          redactedExternalAccountNumber,
        },
      };
    },
  },
  {
    id: 'interest',
    description: 'Interest transactions (earned on cash accounts)',
    match: (tx) => tx.type === 'INTEREST',
    /**
     * Process INTEREST transactions
     * These are interest payments earned on CASH accounts.
     * The subType is ignored as all INTEREST transactions are treated the same.
     *
     * @param {Object} tx - Raw transaction
     * @returns {Object} Processed transaction fields
     */
    process: (tx) => {
      // Look up the account name from the cached accounts list
      const accountName = getAccountNameById(tx.accountId);
      const displayText = `Interest: ${accountName}`;

      return {
        category: 'Interest',
        merchant: displayText,
        originalStatement: displayText,
        notes: '',
        technicalDetails: '',
      };
    },
  },
  // TODO: Add more rules here as needed (17+ rules planned)
  // Examples of future rules:
  // - DIVIDEND
  // - FEE
  // - etc.
];

/**
 * Find and apply the matching rule for a transaction
 * @param {Object} transaction - Raw transaction from Wealthsimple API
 * @param {Map<string, Object>} fundingIntentMap - Optional map of funding intent ID to details
 * @returns {Object|null} Processed rule result or null if no rule matches
 */
export function applyTransactionRule(transaction, fundingIntentMap = null) {
  for (const rule of CASH_TRANSACTION_RULES) {
    if (rule.match(transaction)) {
      debugLog(`Transaction ${transaction.externalCanonicalId} matched rule: ${rule.id}`);
      const result = rule.process(transaction, fundingIntentMap);
      return {
        ...result,
        ruleId: rule.id,
      };
    }
  }

  debugLog(`No rule matched for transaction ${transaction.externalCanonicalId}`, {
    type: transaction.type,
    subType: transaction.subType,
  });
  return null;
}

/**
 * Check if a transaction type/subType combination is supported by any rule
 * @param {string} type - Transaction type
 * @param {string} subType - Transaction subType
 * @returns {boolean} True if at least one rule might match
 */
export function hasRuleForTransaction(type, subType) {
  // Quick check without running full match logic
  const mockTx = { type, subType };
  return CASH_TRANSACTION_RULES.some((rule) => {
    try {
      return rule.match(mockTx);
    } catch {
      return false;
    }
  });
}

export default {
  CASH_TRANSACTION_RULES,
  applyTransactionRule,
  hasRuleForTransaction,
  getETransferDisplayName,
};
