/**
 * Wealthsimple Transaction Rules Engine
 * Cash account rules + orchestration. Re-exports helpers and investment rules.
 */

import { debugLog } from '../../core/utils';
import { applyMerchantMapping } from '../../mappers/merchant';

import {
  formatSpendNotes,
  formatTransferNotes,
  formatPrettyDate,
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
  type WealthsimpleTransaction,
  type StatusSummary,
  type FundingIntent,
  type InternalTransfer,
  type FundsTransfer,
  type SpendDetails,
} from './transactionRulesHelpers';

import {
  INVESTMENT_FEE_TRANSACTION_RULES,
  INVESTMENT_REFUND_TRANSACTION_RULES,
  INVESTMENT_INSTITUTIONAL_TRANSFER_RULES,
  INVESTMENT_DEPOSIT_TRANSACTION_RULES,
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

export {
  formatSpendNotes,
  formatTransferNotes,
  formatPrettyDate,

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

};

export {
  INVESTMENT_FEE_TRANSACTION_RULES,
  INVESTMENT_REFUND_TRANSACTION_RULES,
  INVESTMENT_INSTITUTIONAL_TRANSFER_RULES,
  INVESTMENT_DEPOSIT_TRANSACTION_RULES,

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

interface TransactionRuleResult {
  category: string | null;
  merchant: string;
  originalStatement: string;
  notes: string;
  technicalDetails: string;
  needsCategoryMapping?: boolean;
  categoryKey?: string;
  aftDetails?: { aftTransactionCategory: string; aftTransactionType: string; aftOriginatorName: string };
  billPayDetails?: { billPayCompanyName: string; billPayPayeeNickname: string; redactedExternalAccountNumber: string };
  p2pDetails?: { type: string; subType: string; p2pHandle: string };
}

interface CashTransactionRule {
  id: string;
  description: string;
  match: (tx: WealthsimpleTransaction) => boolean;
  process: (tx: WealthsimpleTransaction, enrichmentMap?: Map<string, unknown> | null) => TransactionRuleResult;
}

export const CASH_TRANSACTION_RULES: CashTransactionRule[] = [
  {
    id: 'e-transfer',
    description: 'Interac e-Transfer transactions (incoming and outgoing)',
    match: (tx) => tx.subType === 'E_TRANSFER',
    process: (tx, enrichmentMap) => {
      const displayName = getETransferDisplayName(tx);
      const email = tx.eTransferEmail || '';
      let merchant: string;
      let statementText: string;
      if (tx.type === 'WITHDRAWAL') {
        merchant = `e-Transfer to ${displayName}`;
        statementText = email ? `Interac e-Transfer to ${displayName} (${email})` : `Interac e-Transfer to ${displayName}`;
      } else {
        merchant = `e-Transfer from ${displayName}`;
        statementText = email ? `Interac e-Transfer from ${displayName} (${email})` : `Interac e-Transfer from ${displayName}`;
      }
      let notes = '';
      let technicalDetails = '';
      if (enrichmentMap && tx.externalCanonicalId) {
        const statusSummary = enrichmentMap.get(`status-summary:${tx.externalCanonicalId}`) as StatusSummary | undefined;
        const statusAnnotation = extractStatusSummaryAnnotation(statusSummary);
        if (statusAnnotation) {
          debugLog(`Found status summary annotation for ${tx.externalCanonicalId}: "${statusAnnotation}"`);
          notes = statusAnnotation;
        }
        if (!notes) {
          const fundingIntent = enrichmentMap.get(tx.externalCanonicalId) as FundingIntent | undefined;
          if (fundingIntent) {
            const memo = extractInteracMemo(fundingIntent);
            if (memo) {
              debugLog(`Found Interac memo (deprecated path) for ${tx.externalCanonicalId}: "${memo}"`);
              notes = memo;
            }
          }
        }
        if (tx.type === 'WITHDRAWAL') {
          const fundingIntent = enrichmentMap.get(tx.externalCanonicalId) as FundingIntent | undefined;
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
    process: (tx, enrichmentMap) => {
      const originalMerchant = (tx.spendMerchant as string | null | undefined) || 'Unknown Merchant';
      const cleanedMerchant = applyMerchantMapping(originalMerchant, { stripStoreNumbers: true });
      const spendDetails = (enrichmentMap?.get(`spend:${tx.externalCanonicalId}`) as SpendDetails | null) || null;
      const notes = formatSpendNotes(spendDetails);
      return {
        category: null,
        merchant: cleanedMerchant,
        originalStatement: formatOriginalStatement(tx.type, tx.subType, originalMerchant),
        notes,
        technicalDetails: '',
        needsCategoryMapping: true,
        categoryKey: cleanedMerchant,
      };
    },
  },
  {
    id: 'deposit-aft',
    description: 'AFT (Automated Funds Transfer) deposit transactions - payroll, insurance, etc.',
    match: (tx) => tx.type === 'DEPOSIT' && tx.subType === 'AFT',
    process: (tx) => {
      const originatorName = tx.aftOriginatorName || 'Unknown AFT';
      const aftTransactionType = tx.aftTransactionType || '';
      const aftTransactionCategory = tx.aftTransactionCategory || '';
      const autoCategory = getAftCategory(aftTransactionType);
      if (autoCategory) {
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
      const categoryKey = getAftCategoryKey(tx.type, tx.subType, aftTransactionType, originatorName);
      debugLog(`AFT transaction needs mapping: ${categoryKey}`);
      return {
        category: null,
        merchant: applyMerchantMapping(originatorName),
        originalStatement: formatAftOriginalStatement(tx.type, tx.subType, aftTransactionCategory, aftTransactionType, originatorName),
        notes: '',
        technicalDetails: '',
        needsCategoryMapping: true,
        categoryKey,
        aftDetails: { aftTransactionCategory, aftTransactionType, aftOriginatorName: originatorName },
      };
    },
  },
  {
    id: 'withdrawal-aft',
    description: 'AFT (Automated Funds Transfer) withdrawal transactions - payments, transfers out, etc.',
    match: (tx) => tx.type === 'WITHDRAWAL' && tx.subType === 'AFT',
    process: (tx) => {
      const originatorName = tx.aftOriginatorName || 'Unknown AFT';
      const aftTransactionType = tx.aftTransactionType || '';
      const aftTransactionCategory = tx.aftTransactionCategory || '';
      const categoryKey = getAftCategoryKey(tx.type, tx.subType, aftTransactionType, originatorName);
      debugLog(`WITHDRAWAL/AFT transaction needs mapping: ${categoryKey}`);
      return {
        category: null,
        merchant: applyMerchantMapping(originatorName),
        originalStatement: formatAftOriginalStatement(tx.type, tx.subType, aftTransactionCategory, aftTransactionType, originatorName),
        notes: '',
        technicalDetails: '',
        needsCategoryMapping: true,
        categoryKey,
        aftDetails: { aftTransactionCategory, aftTransactionType, aftOriginatorName: originatorName },
      };
    },
  },
  {
    id: 'internal-transfer',
    description: 'Internal transfers between Wealthsimple accounts (SOURCE and DESTINATION)',
    match: (tx) => tx.type === 'INTERNAL_TRANSFER' && (tx.subType === 'SOURCE' || tx.subType === 'DESTINATION'),
    process: (tx, internalTransferMap) => {
      const opposingName = getAccountNameById(tx.opposingAccountId);
      const accountName = getAccountNameById(tx.accountId);
      let merchant: string;
      let statementText: string;
      if (tx.subType === 'DESTINATION') {
        merchant = `Transfer In: ${accountName} \u2190 ${opposingName}`;
        statementText = `Transfer In: ${accountName} \u2190 ${opposingName}`;
      } else {
        merchant = `Transfer Out: ${accountName} \u2192 ${opposingName}`;
        statementText = `Transfer Out: ${accountName} \u2192 ${opposingName}`;
      }
      let annotation = '';
      if (internalTransferMap && tx.externalCanonicalId) {
        const internalTransfer = internalTransferMap.get(tx.externalCanonicalId) as InternalTransfer | undefined;
        if (internalTransfer) {
          const extractedAnnotation = extractInternalTransferAnnotation(internalTransfer);
          if (extractedAnnotation) {
            debugLog(`Found internal transfer annotation for ${tx.externalCanonicalId}: "${extractedAnnotation}"`);
            annotation = extractedAnnotation;
          }
        }
      }
      return {
        category: 'Transfer',
        merchant,
        originalStatement: formatOriginalStatement(tx.type, tx.subType, statementText),
        notes: annotation,
        technicalDetails: '',
      };
    },
  },
  {
    id: 'withdrawal-bill-pay',
    description: 'Bill payment transactions',
    match: (tx) => tx.type === 'WITHDRAWAL' && tx.subType === 'BILL_PAY',
    process: (tx, enrichmentMap) => {
      const billPayCompanyName = tx.billPayCompanyName || 'Unknown Company';
      const billPayPayeeNickname = tx.billPayPayeeNickname || 'Unknown Payee';
      const redactedExternalAccountNumber = tx.redactedExternalAccountNumber || '';
      const categoryKey = `${tx.type}:${tx.subType}:${billPayPayeeNickname}`;
      const statementText = `${billPayCompanyName} (${redactedExternalAccountNumber})`;

      let notes = '';
      if (enrichmentMap && tx.externalCanonicalId) {
        const statusSummary = enrichmentMap.get(`status-summary:${tx.externalCanonicalId}`) as StatusSummary | undefined;
        const statusAnnotation = extractStatusSummaryAnnotation(statusSummary);
        if (statusAnnotation) {
          debugLog(`Found bill payment annotation for ${tx.externalCanonicalId}: "${statusAnnotation}"`);
          notes = statusAnnotation;
        }
      }

      return {
        category: null,
        merchant: billPayPayeeNickname,
        originalStatement: formatOriginalStatement(tx.type, tx.subType, statementText),
        notes,
        technicalDetails: '',
        needsCategoryMapping: true,
        categoryKey,
        billPayDetails: { billPayCompanyName, billPayPayeeNickname, redactedExternalAccountNumber },
      };
    },
  },
  {
    id: 'interest',
    description: 'Interest transactions (earned on cash accounts)',
    match: (tx) => tx.type === 'INTEREST',
    process: (tx) => {
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
    process: (tx) => {
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
    process: (tx) => {
      const p2pHandle = tx.p2pHandle || 'Unknown';
      const p2pMessage = tx.p2pMessage || '';
      let merchant: string;
      let statementText: string;
      if (tx.subType === 'SEND') {
        merchant = `Transfer to ${p2pHandle}`;
        statementText = `Transfer to ${p2pHandle}`;
      } else {
        merchant = `Transfer from ${p2pHandle}`;
        statementText = `Transfer from ${p2pHandle}`;
      }
      const categoryKey = `${tx.type}:${tx.subType}:${p2pHandle}`;
      return {
        category: null,
        merchant,
        originalStatement: formatOriginalStatement(tx.type, tx.subType, statementText),
        notes: p2pMessage,
        technicalDetails: '',
        needsCategoryMapping: true,
        categoryKey,
        p2pDetails: { type: tx.type || '', subType: tx.subType || '', p2pHandle },
      };
    },
  },
  {
    id: 'eft-transfer',
    description: 'EFT transfers between Wealthsimple and external bank accounts (including recurring)',
    match: (tx) => tx.subType === 'EFT' || tx.subType === 'EFT_RECURRING',
    process: (tx, fundsTransferMap) => {
      const accountName = getAccountNameById(tx.accountId);
      const fundsTransfer = fundsTransferMap?.get(tx.externalCanonicalId) as
        | (FundsTransfer & { source?: { bankAccount?: Record<string, unknown> }; destination?: { bankAccount?: Record<string, unknown> } })
        | undefined;

      let bankAccount: Record<string, unknown> | undefined;
      if (tx.type === 'DEPOSIT') {
        bankAccount = fundsTransfer?.source?.bankAccount;
      } else {
        bankAccount = fundsTransfer?.destination?.bankAccount;
      }

      const institutionName = (bankAccount?.institutionName as string) || 'Unknown Bank';
      const accountDisplay = getExternalBankAccountDisplayName(bankAccount || null);
      const accountNumber = (bankAccount?.accountNumber as string) || '';
      const statementText = accountNumber
        ? `${institutionName}:${accountDisplay} (${accountNumber})`
        : `${institutionName}:${accountDisplay}`;

      let frequencyPrefix = '';
      if (tx.subType === 'EFT_RECURRING' && tx.frequency) {
        const capitalizedFrequency = tx.frequency.charAt(0).toUpperCase() + tx.frequency.slice(1).toLowerCase();
        frequencyPrefix = `${capitalizedFrequency} `;
      }

      let merchant: string;
      if (tx.type === 'DEPOSIT') {
        merchant = `${frequencyPrefix}Transfer In: ${accountName} \u2190 ${institutionName}/${accountDisplay}`;
      } else {
        merchant = `${frequencyPrefix}Transfer Out: ${accountName} \u2192 ${institutionName}/${accountDisplay}`;
      }

      const notes = extractFundsTransferAnnotation(fundsTransfer || null);
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
];

/**
 * Find and apply the matching rule for a transaction
 * @param transaction - Raw transaction from Wealthsimple API
 * @param fundingIntentMap - Optional map of funding intent ID to details
 * @returns Processed rule result or null if no rule matches
 */
export function applyTransactionRule(
  transaction: WealthsimpleTransaction,
  fundingIntentMap: Map<string, unknown> | null = null,
): (TransactionRuleResult & { ruleId: string }) | null {
  const transactionId = getTransactionId(transaction);

  for (const rule of CASH_TRANSACTION_RULES) {
    if (rule.match(transaction)) {
      debugLog(`Transaction ${transactionId} matched rule: ${rule.id}`);
      const result = rule.process(transaction, fundingIntentMap);
      return { ...result, ruleId: rule.id };
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
 * @param type - Transaction type
 * @param subType - Transaction subType
 * @returns True if at least one rule might match
 */
export function hasRuleForTransaction(type: string, subType: string): boolean {
  const mockTx = { type, subType } as WealthsimpleTransaction;
  return CASH_TRANSACTION_RULES.some((rule) => {
    try {
      return rule.match(mockTx);
    } catch {
      return false;
    }
  });
}

