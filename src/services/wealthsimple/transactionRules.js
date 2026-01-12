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
 * For outgoing transfers (e_transfer_send): memo is in transferMetadata.message
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
 * - notes: Optional notes (default empty, may include Interac memo)
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

      // Extract Interac memo from funding intent data if available
      let notes = '';
      if (fundingIntentMap && tx.externalCanonicalId) {
        const fundingIntent = fundingIntentMap.get(tx.externalCanonicalId);
        if (fundingIntent) {
          notes = extractInteracMemo(fundingIntent);
          if (notes) {
            debugLog(`Found Interac memo for ${tx.externalCanonicalId}: "${notes}"`);
          }
        }
      }

      return {
        category: 'Transfer',
        merchant,
        originalStatement,
        notes,
      };
    },
  },
  // TODO: Add more rules here as needed (17+ rules planned)
  // Examples of future rules:
  // - INTERNAL_TRANSFER
  // - INTEREST
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
