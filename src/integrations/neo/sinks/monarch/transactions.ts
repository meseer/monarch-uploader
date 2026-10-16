import { applyMerchantMapping } from '../../../../mappers/merchant';
import { formatDate } from '../../../../core/utils';
import type { NeoTransaction } from '../../source/api';

export interface ProcessedNeoTransaction extends Record<string, unknown> {
  date: string;
  merchant: string;
  originalStatement: string;
  amount: number;
  referenceNumber: string;
  isPending: false;
  pendingId: null;
  autoCategory: null;
}

export function processNeoTransactions(transactions: NeoTransaction[]): ProcessedNeoTransaction[] {
  return transactions.map((transaction) => {
    const description = transaction.description;
    const timestamp = transaction.authorizationProcessedAt || transaction.completedAt;

    if (!timestamp) {
      throw new Error(`Neo transaction ${transaction.id} is missing its activity date`);
    }

    return {
      date: formatDate(new Date(timestamp)),
      merchant: applyMerchantMapping(description),
      originalStatement: description,
      amount: transaction.amountCents / 100 * (transaction.type === 'DEBIT' ? -1 : 1),
      referenceNumber: transaction.id,
      isPending: false,
      pendingId: null,
      autoCategory: null,
    };
  });
}
