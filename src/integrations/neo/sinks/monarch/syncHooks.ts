import { getTodayLocal } from '../../../../core/utils';
import type { SyncCallbacks, SyncHooks } from '../../../types';
import type { NeoAccount, NeoApiClient, NeoTransaction } from '../../source/api';
import { processNeoTransactions, type ProcessedNeoTransaction } from './transactions';

async function fetchTransactions(
  api: NeoApiClient,
  accountId: string,
  fromDate: string,
  { onProgress }: SyncCallbacks,
): Promise<{ settled: NeoTransaction[]; pending: []; metadata: Record<string, never> }> {
  onProgress('Fetching Neo transactions...');
  const transactions = await api.getTransactions(accountId, fromDate, getTodayLocal());
  const settled = transactions
    .filter((transaction) => transaction.status === 'CONFIRMED')
    .reverse();

  return { settled, pending: [], metadata: {} };
}

function processTransactions(
  settled: NeoTransaction[],
  _pending: unknown[],
  _options: { includePending: boolean },
): { settled: ProcessedNeoTransaction[]; pending: [] } {
  return { settled: processNeoTransactions(settled), pending: [] };
}

function getSettledRefId(transaction: Record<string, unknown>): string {
  return transaction.referenceNumber as string;
}

function getPendingRefId(transaction: Record<string, unknown>): string {
  return transaction.referenceNumber as string;
}

async function resolveCategories(transactions: unknown[]): Promise<unknown[]> {
  return transactions;
}

function buildTransactionNotes(
  transaction: Record<string, unknown>,
  { storeTransactionDetailsInNotes }: { storeTransactionDetailsInNotes: boolean },
): string {
  return storeTransactionDetailsInNotes ? transaction.referenceNumber as string : '';
}

function buildAccountEntry(account: NeoAccount): Record<string, unknown> {
  return {
    accountId: account.accountId,
    accountType: account.accountType,
    accountSubtype: account.accountSubtype,
    category: account.category,
    productName: account.productName,
    displayName: account.displayName,
  };
}

const syncHooks: SyncHooks = {
  fetchTransactions,
  processTransactions,
  getSettledRefId,
  getPendingRefId,
  resolveCategories,
  buildTransactionNotes,
  buildAccountEntry,
};

export default syncHooks;
