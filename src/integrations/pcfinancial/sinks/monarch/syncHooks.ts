import type { SyncHooks } from '../../../types';
import type { PcFinancialTransaction } from '../../source/api';

interface ProcessedTransaction {
  date: string;
  merchant: string;
  originalStatement: string;
  amount: number;
  referenceNumber: string;
  isPending: false;
  pendingId: null;
  autoCategory: null;
}

/** Convert a posted PC Financial transaction to the shared sync shape. */
export function processTransaction(tx: PcFinancialTransaction): ProcessedTransaction {
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
  async fetchTransactions(api, accountId, fromDate, { onProgress }) {
    onProgress('Fetching posted transactions...');
    const client = api as unknown as { getPostedTransactions: (id: string, date: string) => Promise<PcFinancialTransaction[]> };
    return { settled: await client.getPostedTransactions(accountId, fromDate), pending: [], metadata: {} };
  },
  processTransactions(settled) {
    return { settled: (settled as PcFinancialTransaction[]).map(processTransaction), pending: [] };
  },
  getSettledRefId(tx) {
    return tx.referenceNumber as string;
  },
  getPendingRefId() {
    return '';
  },
  async resolveCategories(transactions) {
    return transactions;
  },
  buildTransactionNotes() {
    return '';
  },
  buildAccountEntry(account) {
    return { id: account.accountId, nickname: account.displayName };
  },
};

export default syncHooks;
