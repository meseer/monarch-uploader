import { debugLog } from '../../../../core/utils';
import type { SyncCallbacks, SyncHooks } from '../../../types';
import type { PcFinancialAccount, PcFinancialApiClient, PcFinancialTransaction } from '../../source/api';

export interface ProcessedPcFinancialTransaction extends Record<string, unknown> {
  date: string;
  merchant: string;
  originalStatement: string;
  amount: number;
  referenceNumber: string;
  isPending: false;
  pendingId: null;
  autoCategory: null;
}

/**
 * Convert a posted PC Financial transaction to the shared sync shape.
 *
 * @param tx - Raw posted transaction from PC Financial
 * @returns Normalized transaction for Monarch upload
 */
export function processTransaction(tx: PcFinancialTransaction): ProcessedPcFinancialTransaction {
  const date = tx.postedDate;
  const merchant = tx.merchantName || tx.description || 'Unknown merchant';
  return {
    date,
    merchant,
    originalStatement: tx.description || merchant,
    amount: tx.signedFinalAmount,
    referenceNumber: tx.transactionId,
    isPending: false,
    pendingId: null,
    autoCategory: null,
  };
}

const syncHooks: SyncHooks = {
  async fetchTransactions(api: unknown, accountId: string, fromDate: string, { onProgress }: SyncCallbacks) {
    onProgress('Fetching posted transactions...');
    const client = api as PcFinancialApiClient;
    return { settled: await client.getPostedTransactions(accountId, fromDate), pending: [], metadata: {} };
  },
  processTransactions(settled: unknown[]) {
    return { settled: (settled as PcFinancialTransaction[]).map(processTransaction), pending: [] };
  },
  getSettledRefId(tx: Record<string, unknown>) {
    return tx.referenceNumber as string;
  },
  getPendingRefId() {
    return '';
  },
  async resolveCategories(transactions: unknown[]) {
    return transactions;
  },
  buildTransactionNotes(
    tx: Record<string, unknown>,
    { storeTransactionDetailsInNotes = false }: { storeTransactionDetailsInNotes?: boolean } = {},
  ) {
    return storeTransactionDetailsInNotes && tx.referenceNumber ? String(tx.referenceNumber) : '';
  },
  async suggestStartDate(api: unknown, accountId: string) {
    try {
      const client = api as PcFinancialApiClient;
      const dateOpened = await client.getAccountOpenedDate(accountId);
      if (dateOpened) {
        return { date: dateOpened, description: 'Account opening date' };
      }
    } catch (error) {
      debugLog('[PC Financial hooks] Could not fetch account opening date:', (error as Error).message);
    }
    return null;
  },
  buildAccountEntry(account: Record<string, unknown>) {
    const pcAccount = account as PcFinancialAccount;
    return {
      id: pcAccount.accountId,
      accountId: pcAccount.accountId,
      accountType: pcAccount.accountType,
      accountSubtype: pcAccount.accountSubtype,
      productType: pcAccount.productType,
      productCode: pcAccount.productCode,
      ...(pcAccount.maskedCardNumber ? { maskedCardNumber: pcAccount.maskedCardNumber, endingIn: pcAccount.maskedCardNumber } : {}),
      ...(pcAccount.dateOpened ? { dateOpened: pcAccount.dateOpened } : {}),
      nickname: pcAccount.displayName,
      displayName: pcAccount.displayName,
    };
  },
};

export default syncHooks;
