import type { HttpClient } from '../../../core/httpClient';
import type { StorageAdapter } from '../../../core/storageAdapter';
import { getSession, SESSION_KEY } from './session';

const BASE_URL = 'https://app.pcfinancial.ca/inet/banking/v2.0/accounts';
const PAGE_SIZE = 20;

export interface PcFinancialTransaction {
  accountId: string;
  transactionId: string;
  postedDate: string;
  debitCredit: 'DEBIT' | 'CREDIT';
  currencyCode: string;
  merchantName?: string;
  description?: string;
  signedFinalAmount: number;
}

interface TransactionPage {
  transactions: PcFinancialTransaction[];
  pagination: { totalCount: number; freezeMarker?: string };
}

/** Validate the response before any transaction can reach Monarch. */
export function parseTransactionPage(value: unknown, accountId: string): TransactionPage {
  const page = value as Partial<TransactionPage>;
  if (!page || !Array.isArray(page.transactions)
      || !Number.isInteger(page.pagination?.totalCount)
      || (page.pagination?.totalCount ?? -1) < 0) {
    throw new Error('Unexpected PC Financial transaction response: transactions or pagination missing');
  }

  for (const transaction of page.transactions) {
    if (transaction.accountId !== accountId
        || !transaction.transactionId
        || !/^\d{4}-\d{2}-\d{2}$/.test(transaction.postedDate)
        || typeof transaction.signedFinalAmount !== 'number'
        || !Number.isFinite(transaction.signedFinalAmount)
        || transaction.currencyCode !== 'CAD'
        || !['DEBIT', 'CREDIT'].includes(transaction.debitCredit)
        || (transaction.debitCredit === 'DEBIT' && transaction.signedFinalAmount > 0)
        || (transaction.debitCredit === 'CREDIT' && transaction.signedFinalAmount < 0)) {
      throw new Error('Unexpected PC Financial transaction fields; sync stopped before upload');
    }
  }
  return page as TransactionPage;
}

/** Create the PC Financial API client using captured browser session headers. */
export function createApi(httpClient: HttpClient, storage: StorageAdapter) {
  async function getPage(accountId: string, offset: number, limit: number, freezeMarker?: string): Promise<TransactionPage> {
    const session = getSession(storage);
    if (!session?.accountIds.includes(accountId) || !session.headers.authorization) {
      throw new Error('Open PC Financial transactions to capture a current session');
    }

    const query = new URLSearchParams({
      offset: String(offset),
      limit: String(limit),
      sortField: 'TRANSACTION_DATE',
      orderDirection: 'DESCENDING',
    });
    if (freezeMarker) query.set('freezeMarker', freezeMarker);
    const requestHeaders = {
      ...session.headers,
      'x-nonce': crypto.randomUUID(),
      'uservice-message-id': crypto.randomUUID().replace(/-/g, ''),
      'uservice-traceability-id': crypto.randomUUID().replace(/-/g, ''),
    };
    const response = await httpClient.request({
      method: 'GET',
      url: `${BASE_URL}/${encodeURIComponent(accountId)}/posted-transactions?${query}`,
      headers: {
        accept: 'application/json',
        origin: 'https://secure.pcfinancial.ca',
        referer: 'https://secure.pcfinancial.ca/',
        ...requestHeaders,
      },
    });

    if (response.status === 401 || response.status === 403) {
      storage.delete(SESSION_KEY);
      throw new Error('PC Financial session expired; reopen transactions and try again');
    }
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`PC Financial transactions request failed: HTTP ${response.status}`);
    }

    let data: unknown;
    try {
      data = JSON.parse(response.responseText);
    } catch (error) {
      throw new Error('PC Financial returned invalid JSON', { cause: error });
    }
    return parseTransactionPage(data, accountId);
  }

  return {
    /** List accounts observed in successful account requests during this session. */
    async getAccountsSummary(): Promise<Array<{ accountId: string; displayName: string }>> {
      const session = getSession(storage);
      if (!session?.accountIds.length) {
        throw new Error('Open a PC Financial account transaction page first');
      }
      await getPage(session.accountIds[0], 0, PAGE_SIZE);
      return session.accountIds.map((accountId) => ({
        accountId,
        displayName: `PC Financial (${accountId.slice(-6)})`,
      }));
    },

    /** Fetch all posted transactions in the selected date range, oldest first. */
    async getPostedTransactions(accountId: string, fromDate: string): Promise<PcFinancialTransaction[]> {
      const transactions: PcFinancialTransaction[] = [];
      let offset = 0;
      let totalCount: number;
      let freezeMarker: string | undefined;

      do {
        const page = await getPage(accountId, offset, PAGE_SIZE, freezeMarker);
        transactions.push(...page.transactions);
        totalCount = page.pagination.totalCount;
        freezeMarker = page.pagination.freezeMarker;
        offset += page.transactions.length;
        if (page.transactions.length === 0 && offset < totalCount) {
          throw new Error('PC Financial returned an empty page before all transactions were fetched');
        }
      } while (offset < totalCount);

      return transactions
        .filter((tx) => tx.postedDate >= fromDate)
        .reverse();
    },
  };
}
