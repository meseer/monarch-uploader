/**
 * Wealthsimple Transaction Rules Engine
 * Handles automatic categorization and field mapping for different transaction types
 *
 * This is the main entry point that re-exports all rules and helpers.
 * Rules are split across files:
 * - transactionRulesHelpers.js: Shared utility functions
 * - transactionRulesInvestment.js: Investment account rules
 * - transactionRules.js (this file): Cash account rules + orchestration
 */

import { debugLog } from '../../core/utils';
import { applyMerchantMapping } from '../../mappers/merchant';

// Import from helpers (used locally in CASH rules and re-exported)
import {
  formatSpendNotes,
  formatTransferNotes,
  formatPrettyDate,
  toSentenceCase,
  formatInvestmentOrderNotes,
  formatManagedOrderNotes,
  formatOptionsOrderNotes,
  getTransactionId,
  formatOriginalStatement,
  formatAftOriginalStatement,
  getAccountNameById,
  getAccountNameByType,
  getAftCategoryKey,
  getAftCategory,
  getETransferDisplayName,
  extractStatusSummaryAnnotation,
  extractInteracMemo,
  extractOutgoingETransferDetails,
  formatOutgoingETransferDetails,
  extractInternalTransferAnnotation,
  extractFundsTransferAnnotation,
  getExternalBankAccountDisplayName,
} from './transactionRulesHelpers';

// Import from investment rules (re-exported for consumers)
import {
  INVESTMENT_FEE_TRANSACTION_RULES,
  INVESTMENT_REFUND_TRANSACTION_RULES,
  INVESTMENT_INSTITUTIONAL_TRANSFER_RULES,
  INVESTMENT_DEPOSIT_TRANSACTION_RULES,
  formatNumberWithPrecision,
  formatDividendNotes,
  INVESTMENT_DIVIDEND_TRANSACTION_RULES,
  INVESTMENT_INTEREST_TRANSACTION_RULES,
  formatCorporateActionNotes,
  INVESTMENT_CORPORATE_ACTION_TRANSACTION_RULES,
  formatShortOptionExpiryNotes,
  INVESTMENT_RESP_GRANT_TRANSACTION_RULES,
  INVESTMENT_NON_RESIDENT_TAX_TRANSACTION_RULES,
  INVESTMENT_REIMBURSEMENT_TRANSACTION_RULES,
  formatCryptoOrderNotes,
  formatCryptoSwapNotes,
  INVESTMENT_BUY_SELL_TRANSACTION_RULES,
} from './transactionRulesInvestment';

// Re-export helpers for consumers
export {
  formatSpendNotes,
  formatTransferNotes,
  formatPrettyDate,
  toSentenceCase,
  formatInvestmentOrderNotes,
  formatManagedOrderNotes,
  formatOptionsOrderNotes,
  getTransactionId,
  formatOriginalStatement,
  formatAftOriginalStatement,
  getAccountNameById,
  getAccountNameByType,
  extractStatusSummaryAnnotation,
  extractInteracMemo,
  extractOutgoingETransferDetails,
  formatOutgoingETransferDetails,
  extractInternalTransferAnnotation,
  extractFundsTransferAnnotation,
  getExternalBankAccountDisplayName,
};

// Re-export investment rules for consumers
export {
  INVESTMENT_FEE_TRANSACTION_RULES,
  INVESTMENT_REFUND_TRANSACTION_RULES,
  INVESTMENT_INSTITUTIONAL_TRANSFER_RULES,
  INVESTMENT_DEPOSIT_TRANSACTION_RULES,
  formatNumberWithPrecision,
  formatDividendNotes,
  INVESTMENT_DIVIDEND_TRANSACTION_RULES,
  INVESTMENT_INTEREST_TRANSACTION_RULES,
  formatCorporateActionNotes,
  INVESTMENT_CORPORATE_ACTION_TRANSACTION_RULES,
  formatShortOptionExpiryNotes,
  INVESTMENT_RESP_GRANT_TRANSACTION_RULES,
  INVESTMENT_NON_RESIDENT_TAX_TRANSACTION_RULES,
  INVESTMENT_REIMBURSEMENT_TRANSACTION_RULES,
  formatCryptoOrderNotes,
  formatCryptoSwapNotes,
  INVESTMENT_BUY_SELL_TRANSACTION_RULES,
};

export const CASH_TRANSACTION_RULES = [
  {
    id: 'e-transfer',
    description: 'Interac e-Transfer transactions (incoming and outgoing)',
    match: (tx) => tx.subType === 'E_TRANSFER',
    process: (tx, enrichmentMap) => {
      const displayName = getETransferDisplayName(tx);
      const email = tx.eTransferEmail || '';

      // Generate merchant and original statement based on transaction type
      let merchant;
      let statementText;

      if (tx.type === 'WITHDRAWAL') {
        merchant = `e-Transfer to ${displayName}`;
        statementText = email
          ? `Interac e-Transfer to ${displayName} (${email})`
          : `Interac e-Transfer to ${displayName}`;
      } else {
        // DEPOSIT or other types - treat as incoming
        merchant = `e-Transfer from ${displayName}`;
        statementText = email
          ? `Interac e-Transfer from ${displayName} (${email})`
          : `Interac e-Transfer from ${displayName}`;
      }

      // Extract annotation/memo from enrichment data
      // Priority:
      // 1. FetchFundingIntentStatusSummary annotation (primary, added 2026-03-06)
      // 2. FetchFundingIntent transferMetadata memo (deprecated fallback, see extractInteracMemo)
      let notes = '';
      let technicalDetails = '';
      if (enrichmentMap && tx.externalCanonicalId) {
        // 2026-03-06: Primary source — FetchFundingIntentStatusSummary annotation
        const statusSummary = enrichmentMap.get(`status-summary:${tx.externalCanonicalId}`);
        const statusAnnotation = extractStatusSummaryAnnotation(statusSummary);
        if (statusAnnotation) {
          debugLog(`Found status summary annotation for ${tx.externalCanonicalId}: "${statusAnnotation}"`);
          notes = statusAnnotation;
        }

        // Deprecated fallback (2026-03-06): FetchFundingIntent transferMetadata memo
        // The memo field is no longer populated by the Wealthsimple API.
        // Kept for backward compatibility; marked for removal in a future version.
        if (!notes) {
          const fundingIntent = enrichmentMap.get(tx.externalCanonicalId);
          if (fundingIntent) {
            const memo = extractInteracMemo(fundingIntent);
            if (memo) {
              debugLog(`Found Interac memo (deprecated path) for ${tx.externalCanonicalId}: "${memo}"`);
              notes = memo;
            }
          }
        }

        // For outgoing transfers, also extract auto-deposit and reference number
        // from the FetchFundingIntent data (these fields are still populated)
        if (tx.type === 'WITHDRAWAL') {
          const fundingIntent = enrichmentMap.get(tx.externalCanonicalId);
          if (fundingIntent) {
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
        originalStatement: formatOriginalStatement(tx.type, tx.subType, statementText),
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
     * Enrichment data:
     * - Spend details are available via enrichmentMap with key "spend:{externalCanonicalId}"
     * - If isForeign: adds foreign currency info to notes
     * - If hasReward: adds reward info to notes
     *
     * @param {Object} tx - Raw transaction
     * @param {Map<string, Object>} enrichmentMap - Map containing spend details (keyed by "spend:{id}")
     * @returns {Object} Processed transaction fields
     */
    process: (tx, enrichmentMap) => {
      const originalMerchant = tx.spendMerchant || 'Unknown Merchant';
      const cleanedMerchant = applyMerchantMapping(originalMerchant, { stripStoreNumbers: true });

      // Look up spend details from enrichment map
      const spendDetails = enrichmentMap?.get(`spend:${tx.externalCanonicalId}`) || null;

      // Format notes from spend details (foreign currency and reward info)
      const notes = formatSpendNotes(spendDetails);

      return {
        // Category will be resolved via user category mapping (like credit cards)
        category: null, // null indicates needs category mapping
        merchant: cleanedMerchant,
        originalStatement: formatOriginalStatement(tx.type, tx.subType, originalMerchant),
        notes,
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
     * - payroll_deposit: Auto-categorized to "Paychecks"
     * - Other types (insurance, misc_payments, etc.): Manual categorization based on
     *   "aftTransactionType:aftOriginatorName" key - saved for future transactions
     *
     * @param {Object} tx - Raw transaction
     * @returns {Object} Processed transaction fields
     */
    process: (tx) => {
      const originatorName = tx.aftOriginatorName || 'Unknown AFT';
      const aftTransactionType = tx.aftTransactionType || '';
      const aftTransactionCategory = tx.aftTransactionCategory || '';

      // Try to get automatic category mapping (only payroll_deposit is auto-mapped)
      const autoCategory = getAftCategory(aftTransactionType);

      if (autoCategory) {
        // Known AFT type - auto-categorize
        debugLog(`AFT transaction auto-categorized: ${aftTransactionType} -> ${autoCategory}`);
        return {
          category: autoCategory,
          merchant: applyMerchantMapping(originatorName),
          originalStatement: formatAftOriginalStatement(tx.type, tx.subType, aftTransactionCategory, aftTransactionType, originatorName),
          notes: '',
          technicalDetails: '',
          needsCategoryMapping: false,
        };
      }

      // Unknown AFT type (including insurance, misc_payments) - needs category mapping
      // Use "type:subType:aftTransactionType:aftOriginatorName" as the category key for mapping/saving
      const categoryKey = getAftCategoryKey(tx.type, tx.subType, aftTransactionType, originatorName);
      debugLog(`AFT transaction needs mapping: ${categoryKey}`);
      return {
        category: null,
        merchant: applyMerchantMapping(originatorName),
        originalStatement: formatAftOriginalStatement(tx.type, tx.subType, aftTransactionCategory, aftTransactionType, originatorName),
        notes: '',
        technicalDetails: '',
        needsCategoryMapping: true,
        // Use "type:subType:aftTransactionType:aftOriginatorName" as category key for saving
        categoryKey,
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
    id: 'withdrawal-aft',
    description: 'AFT (Automated Funds Transfer) withdrawal transactions - payments, transfers out, etc.',
    match: (tx) => tx.type === 'WITHDRAWAL' && tx.subType === 'AFT',
    /**
     * Process WITHDRAWAL/AFT transactions
     * AFT withdrawal transactions have additional metadata:
     * - aftTransactionCategory: General category (e.g., "government", "misc")
     * - aftTransactionType: Specific type (e.g., "tax_payment", "misc_payments")
     * - aftOriginatorName: Name of the organization receiving the transfer
     *
     * All WITHDRAWAL/AFT transactions require user mapping. The category key uses
     * "aftTransactionType:aftOriginatorName" format (same as DEPOSIT/AFT) so that
     * mappings can be shared between deposits and withdrawals from the same originator.
     *
     * @param {Object} tx - Raw transaction
     * @returns {Object} Processed transaction fields
     */
    process: (tx) => {
      const originatorName = tx.aftOriginatorName || 'Unknown AFT';
      const aftTransactionType = tx.aftTransactionType || '';
      const aftTransactionCategory = tx.aftTransactionCategory || '';

      // All WITHDRAWAL/AFT transactions need category mapping
      // Use "type:subType:aftTransactionType:aftOriginatorName" as the category key for mapping/saving
      const categoryKey = getAftCategoryKey(tx.type, tx.subType, aftTransactionType, originatorName);
      debugLog(`WITHDRAWAL/AFT transaction needs mapping: ${categoryKey}`);

      return {
        category: null,
        merchant: applyMerchantMapping(originatorName),
        originalStatement: formatAftOriginalStatement(tx.type, tx.subType, aftTransactionCategory, aftTransactionType, originatorName),
        notes: '',
        technicalDetails: '',
        needsCategoryMapping: true,
        // Use "type:subType:aftTransactionType:aftOriginatorName" as category key for saving
        categoryKey,
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
      let statementText;

      if (tx.subType === 'DESTINATION') {
        // Money coming INTO this account - format: "Transfer In: ${accountName} ← ${opposingName}"
        merchant = `Transfer In: ${accountName} ← ${opposingName}`;
        statementText = `Transfer In: ${accountName} ← ${opposingName}`;
      } else {
        // SOURCE - Money leaving this account - format: "Transfer Out: ${accountName} → ${opposingName}"
        merchant = `Transfer Out: ${accountName} → ${opposingName}`;
        statementText = `Transfer Out: ${accountName} → ${opposingName}`;
      }

      // Extract annotation from internal transfer data if available
      let annotation = '';
      if (internalTransferMap && tx.externalCanonicalId) {
        const internalTransfer = internalTransferMap.get(tx.externalCanonicalId);
        if (internalTransfer) {
          const extractedAnnotation = extractInternalTransferAnnotation(internalTransfer);
          if (extractedAnnotation) {
            debugLog(`Found internal transfer annotation for ${tx.externalCanonicalId}: "${extractedAnnotation}"`);
            annotation = extractedAnnotation;
          }
        }
      }

      // Use only the annotation as notes (no transfer amount)
      const notes = annotation;

      return {
        category: 'Transfer',
        merchant,
        originalStatement: formatOriginalStatement(tx.type, tx.subType, statementText),
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

      // Build categoryKey: "type:subType:merchantName"
      const categoryKey = `${tx.type}:${tx.subType}:${billPayPayeeNickname}`;

      const statementText = `${billPayCompanyName} (${redactedExternalAccountNumber})`;

      return {
        category: null, // User selects via category mapper
        merchant: billPayPayeeNickname,
        originalStatement: formatOriginalStatement(tx.type, tx.subType, statementText),
        notes: '',
        technicalDetails: '',
        needsCategoryMapping: true,
        categoryKey,
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
        originalStatement: formatOriginalStatement(tx.type, tx.subType, displayText),
        notes: '',
        technicalDetails: '',
      };
    },
  },
  {
    id: 'credit-card-payment',
    description: 'Credit card payment transactions',
    match: (tx) => tx.type === 'CREDIT_CARD_PAYMENT',
    /**
     * Process CREDIT_CARD_PAYMENT transactions
     * These are payments made to the Wealthsimple credit card.
     * The subType is ignored as all credit card payments are treated the same.
     *
     * Merchant and originalStatement are set to the credit card account name,
     * looked up by type 'CREDIT_CARD' in the accounts list.
     * Falls back to 'Wealthsimple Credit Card' if no credit card account is found.
     *
     * @param {Object} tx - Raw transaction
     * @returns {Object} Processed transaction fields
     */
    process: (tx) => {
      // Look up the credit card account name by type
      const creditCardName = getAccountNameByType('CREDIT_CARD') || 'Wealthsimple Credit Card';

      return {
        category: 'Credit Card Payment',
        merchant: creditCardName,
        originalStatement: formatOriginalStatement(tx.type, tx.subType, creditCardName),
        notes: '',
        technicalDetails: '',
      };
    },
  },
  {
    id: 'promotion-incentive-bonus',
    description: 'Promotional incentive bonus transactions (e.g., sign-up bonuses)',
    match: (tx) => tx.type === 'PROMOTION' && tx.subType === 'INCENTIVE_BONUS',
    /**
     * Process PROMOTION/INCENTIVE_BONUS transactions
     * These are promotional bonuses (e.g., sign-up bonuses, referral bonuses).
     * Applies to all account types (cash and investment).
     * Category is auto-assigned to "Promotion".
     *
     * @param {Object} tx - Raw transaction
     * @returns {Object} Processed transaction fields
     */
    process: (tx) => ({
      category: 'Promotion',
      merchant: 'Wealthsimple Incentive Bonus',
      originalStatement: formatOriginalStatement(tx.type, tx.subType, 'Wealthsimple Incentive Bonus'),
      notes: '',
      technicalDetails: '',
    }),
  },
  {
    id: 'reimbursement-cashback',
    description: 'Cashback reward reimbursement transactions',
    match: (tx) => tx.type === 'REIMBURSEMENT' && tx.subType === 'CASHBACK',
    /**
     * Process REIMBURSEMENT/CASHBACK transactions
     * These are cashback rewards deposited from credit card spending.
     * Category is auto-set to "Cash Back".
     *
     * @param {Object} tx - Raw transaction
     * @returns {Object} Processed transaction fields
     */
    process: (tx) => ({
      category: 'Cash Back',
      merchant: 'Wealthsimple Cashback',
      originalStatement: formatOriginalStatement(tx.type, tx.subType, tx.rewardProgram || 'Wealthsimple Cashback'),
      notes: '',
      technicalDetails: '',
    }),
  },
  {
    id: 'reimbursement-atm',
    description: 'ATM fee reimbursement transactions',
    match: (tx) => tx.type === 'REIMBURSEMENT' && tx.subType === 'ATM',
    /**
     * Process REIMBURSEMENT/ATM transactions
     * These are ATM fee reimbursements from Wealthsimple.
     * Note: status for these transactions is null, handled specially in filtering.
     * Category is auto-set to "Cash & ATM".
     *
     * @param {Object} _tx - Raw transaction (unused but required by interface)
     * @returns {Object} Processed transaction fields
     */
    process: (tx) => ({
      category: 'Cash & ATM',
      merchant: 'ATM Fee Reimbursement',
      originalStatement: formatOriginalStatement(tx.type, tx.subType, 'ATM Fee Reimbursement'),
      notes: '',
      technicalDetails: '',
    }),
  },
  {
    id: 'p2p-payment',
    description: 'P2P payments (person-to-person transfers via handle)',
    match: (tx) => tx.type === 'P2P_PAYMENT' && (tx.subType === 'SEND' || tx.subType === 'SEND_RECEIVED'),
    /**
     * Process P2P_PAYMENT transactions
     * These are person-to-person transfers using Wealthsimple handles.
     *
     * For SEND: Money going out to another user
     * For SEND_RECEIVED: Money coming in from another user
     *
     * Uses p2pHandle to identify the other party.
     * Uses p2pMessage for notes.
     *
     * Category is determined by user via category mapper based on categoryKey format:
     * "${type}:${subType}:${p2pHandle}" (e.g., "P2P_PAYMENT:SEND:@username")
     *
     * @param {Object} tx - Raw transaction
     * @returns {Object} Processed transaction fields
     */
    process: (tx) => {
      const p2pHandle = tx.p2pHandle || 'Unknown';
      const p2pMessage = tx.p2pMessage || '';

      // Generate merchant based on transaction direction
      let merchant;
      let statementText;

      if (tx.subType === 'SEND') {
        merchant = `Transfer to ${p2pHandle}`;
        statementText = `Transfer to ${p2pHandle}`;
      } else {
        // SEND_RECEIVED
        merchant = `Transfer from ${p2pHandle}`;
        statementText = `Transfer from ${p2pHandle}`;
      }

      // Build categoryKey: "type:subType:p2pHandle"
      const categoryKey = `${tx.type}:${tx.subType}:${p2pHandle}`;

      return {
        category: null, // User selects via category mapper
        merchant,
        originalStatement: formatOriginalStatement(tx.type, tx.subType, statementText),
        notes: p2pMessage,
        technicalDetails: '',
        needsCategoryMapping: true,
        categoryKey,
        // Store P2P details for category selector display
        p2pDetails: {
          type: tx.type,
          subType: tx.subType,
          p2pHandle,
        },
      };
    },
  },
  {
    id: 'eft-transfer',
    description: 'EFT transfers between Wealthsimple and external bank accounts (including recurring)',
    match: (tx) => tx.subType === 'EFT' || tx.subType === 'EFT_RECURRING',
    /**
     * Process EFT (Electronic Funds Transfer) transactions
     * These are transfers between Wealthsimple CASH accounts and external bank accounts.
     * Transaction details (bank account info) are fetched via FetchFundsTransfer API.
     *
     * For DEPOSIT: External bank is source, Wealthsimple account is destination
     * For WITHDRAWAL: Wealthsimple account is source, external bank is destination
     *
     * Pending status handling:
     * - status="processing" (unifiedStatus: "IN_PROGRESS") maps to Pending
     * - status="completed" (unifiedStatus: "COMPLETED") maps to completed
     * - Other statuses map to rejected/cancelled
     *
     * @param {Object} tx - Raw transaction
     * @param {Map<string, Object>} fundsTransferMap - Optional map of funds transfer ID to details
     * @returns {Object} Processed transaction fields
     */
    process: (tx, fundsTransferMap) => {
      // Look up the Wealthsimple account name
      const accountName = getAccountNameById(tx.accountId);

      // Get funds transfer details from enrichmentMap
      const fundsTransfer = fundsTransferMap?.get(tx.externalCanonicalId);

      // Determine external bank account (source for DEPOSIT, destination for WITHDRAWAL)
      let bankAccount;
      if (tx.type === 'DEPOSIT') {
        bankAccount = fundsTransfer?.source?.bankAccount;
      } else {
        // WITHDRAWAL
        bankAccount = fundsTransfer?.destination?.bankAccount;
      }

      // Build bank account display
      const institutionName = bankAccount?.institutionName || 'Unknown Bank';
      const accountDisplay = getExternalBankAccountDisplayName(bankAccount);
      const accountNumber = bankAccount?.accountNumber || '';

      // Original statement format: institutionName:accountDisplay (accountNumber)
      const statementText = accountNumber
        ? `${institutionName}:${accountDisplay} (${accountNumber})`
        : `${institutionName}:${accountDisplay}`;

      // Generate merchant based on transaction type
      // For EFT_RECURRING, add frequency prefix if available (e.g., "Monthly transfer in: ...")
      let merchant;
      let frequencyPrefix = '';
      if (tx.subType === 'EFT_RECURRING' && tx.frequency) {
        // Capitalize frequency (API returns all-caps like "MONTHLY")
        const capitalizedFrequency = tx.frequency.charAt(0).toUpperCase() + tx.frequency.slice(1).toLowerCase();
        frequencyPrefix = `${capitalizedFrequency} `;
      }

      if (tx.type === 'DEPOSIT') {
        // Money coming in from external bank
        merchant = `${frequencyPrefix}Transfer In: ${accountName} ← ${institutionName}/${accountDisplay}`;
      } else {
        // WITHDRAWAL - Money going out to external bank
        merchant = `${frequencyPrefix}Transfer Out: ${accountName} → ${institutionName}/${accountDisplay}`;
      }

      // Extract annotation (user note) from funds transfer data
      const notes = extractFundsTransferAnnotation(fundsTransfer);
      if (notes) {
        debugLog(`Found EFT annotation for ${tx.externalCanonicalId}: "${notes}"`);
      }

      return {
        category: 'Transfer',
        merchant,
        originalStatement: formatOriginalStatement(tx.type, tx.subType, statementText),
        notes,
        technicalDetails: '',
      };
    },
  },
  // TODO: Add more rules here as needed
  // Examples of future rules:
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
  const transactionId = getTransactionId(transaction);

  for (const rule of CASH_TRANSACTION_RULES) {
    if (rule.match(transaction)) {
      debugLog(`Transaction ${transactionId} matched rule: ${rule.id}`);
      const result = rule.process(transaction, fundingIntentMap);
      return {
        ...result,
        ruleId: rule.id,
      };
    }
  }

  debugLog(`No rule matched for transaction ${transactionId}`, {
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
  INVESTMENT_FEE_TRANSACTION_RULES,
  INVESTMENT_DEPOSIT_TRANSACTION_RULES,
  INVESTMENT_DIVIDEND_TRANSACTION_RULES,
  INVESTMENT_INTEREST_TRANSACTION_RULES,
  INVESTMENT_RESP_GRANT_TRANSACTION_RULES,
  INVESTMENT_NON_RESIDENT_TAX_TRANSACTION_RULES,
  INVESTMENT_REIMBURSEMENT_TRANSACTION_RULES,
  applyTransactionRule,
  hasRuleForTransaction,
  getETransferDisplayName,
  getTransactionId,
};
