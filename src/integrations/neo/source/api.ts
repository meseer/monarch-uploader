/** Neo Financial GraphQL API client. */

import type { HttpClient } from '../../../core/httpClient';
import { formatDate } from '../../../core/utils';

const API_URL = 'https://api.production.neofinancial.com/graphql';
const REQUEST_HEADERS = {
  Accept: 'application/json',
  'Content-Type': 'application/json',
  'x-client-locale': 'en-CA',
};

type NeoAccountType = 'credit' | 'depository';

export interface NeoAccount extends Record<string, unknown> {
  accountId: string;
  accountType: NeoAccountType;
  accountSubtype: 'credit_card' | 'checking' | 'savings';
  category: string;
  productName: string;
  displayName: string;
}

export interface NeoTransaction extends Record<string, unknown> {
  id: string;
  description: string;
  type: 'CREDIT' | 'DEBIT';
  status: string;
  amountCents: number;
  authorizationProcessedAt?: string;
  completedAt?: string | null;
}

interface GraphQLResult<T> {
  data: T;
  errors?: unknown[];
}

interface NeoAccountsResponse {
  user: {
    creditAccounts: Array<{
      id: string;
      status: string;
      card: { last4: string };
      creditProduct: { brandName: string };
    }>;
    savingsAccountsList: {
      results: Array<{
        id: string;
        category: string;
        status: string;
        program: { productName: string };
        card: { last4: string };
      }>;
    };
  };
}

interface NeoTransactionPage {
  primaryCursor: { cursor: string | null };
  hasNextPage: boolean;
  results: NeoTransaction[];
}

interface NeoCreditBalanceResponse {
  user: {
    creditAccount: { balances: { totalCreditBalanceCents: number } } | null;
  };
}

interface NeoSavingsBalanceResponse {
  user: {
    savingsAccount: { balances: { currentBalanceCents: number } } | null;
  };
}

interface NeoCreditLimitResponse {
  user: {
    creditAccount: { creditLimitCents: number } | null;
  };
}

interface NeoCreditTransactionsResponse {
  user: {
    creditAccount: { creditAccountTransactions: NeoTransactionPage } | null;
  };
}

interface NeoSavingsTransactionsResponse {
  user: {
    savingsAccount: { savingsAccountTransactions: NeoTransactionPage } | null;
  };
}

const ACCOUNTS_QUERY = `query NeoAccounts {
  user {
    creditAccounts {
      id
      status
      card { last4 }
      creditProduct { brandName }
    }
    savingsAccountsList(input: { limit: 100, filter: [] }) {
      results {
        id
        category
        status
        program { productName }
        card { last4 }
      }
    }
  }
}`;

const CREDIT_BALANCE_QUERY = `query NeoCreditBalance($id: ObjectID!) {
  user {
    creditAccount(id: $id) {
      balances { totalCreditBalanceCents }
    }
  }
}`;

const SAVINGS_BALANCE_QUERY = `query NeoSavingsBalance($id: ObjectID!) {
  user {
    savingsAccount(id: $id) {
      balances { currentBalanceCents }
    }
  }
}`;

const CREDIT_LIMIT_QUERY = `query NeoCreditLimit($id: ObjectID!) {
  user { creditAccount(id: $id) { creditLimitCents } }
}`;

const CREDIT_TRANSACTIONS_QUERY = `query NeoCreditTransactions($creditAccountId: ObjectID!, $input: CreditAccountTransactionsRelativeQueryInput!) {
  user {
    creditAccount(id: $creditAccountId) {
      creditAccountTransactions(input: $input) {
        primaryCursor { cursor }
        hasNextPage
        results {
          id
          description
          type
          status
          amountCents
          completedAt
          authorizationProcessedAt
        }
      }
    }
  }
}`;

const SAVINGS_TRANSACTIONS_QUERY = `query NeoSavingsTransactions($id: ObjectID!, $input: SavingsAccountTransactionsRelativeQueryInput!) {
  user {
    savingsAccount(id: $id) {
      savingsAccountTransactions(input: $input) {
        primaryCursor { cursor }
        hasNextPage
        results {
          id
          description
          type
          amountCents
          status
          authorizationProcessedAt
        }
      }
    }
  }
}`;

function transactionDate(transaction: NeoTransaction): string {
  const timestamp = transaction.authorizationProcessedAt || transaction.completedAt;
  if (!timestamp) {
    throw new Error('Neo transaction is missing its activity date');
  }
  return formatDate(new Date(timestamp));
}

function getProductName(productName: string): string {
  switch (productName) {
  case 'EVERYDAY':
    return 'Neo Everyday';
  case 'SAVINGS':
    return 'Neo Savings';
  case 'HISA':
    return 'Neo High-Interest Savings';
  default:
    throw new Error(`Unsupported Neo savings product: ${productName}`);
  }
}

export interface NeoApiClient {
  getAccounts(): Promise<NeoAccount[]>;
  getAccountsSummary(): Promise<NeoAccount[]>;
  getBalance(accountId: string): Promise<{ currentBalance: number; currency: string }>;
  getCreditLimit(accountId: string): Promise<number | null>;
  getTransactions(accountId: string, startDate: string, endDate: string): Promise<NeoTransaction[]>;
}

export function createApi(httpClient: HttpClient, _auth: unknown): NeoApiClient {
  const accountTypes = new Map<string, NeoAccountType>();

  async function query<T>(operationName: string, queryText: string, variables: Record<string, unknown> = {}): Promise<T> {
    const response = await httpClient.request({
      method: 'POST',
      url: API_URL,
      headers: REQUEST_HEADERS,
      data: JSON.stringify([{ operationName, query: queryText, variables }]),
    });

    if (response.status === 401 || response.status === 403) {
      throw new Error('Neo session expired. Please refresh the page and log in again.');
    }
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Neo API error: HTTP ${response.status}`);
    }

    const [result] = JSON.parse(response.responseText) as GraphQLResult<T>[];
    if (result.errors?.length) {
      throw new Error(`Neo GraphQL query failed: ${operationName}`);
    }
    return result.data;
  }

  function accountTypeFor(accountId: string): NeoAccountType {
    const accountType = accountTypes.get(accountId);
    if (!accountType) {
      throw new Error('Neo account type is unavailable. Refresh the account list and try again.');
    }
    return accountType;
  }

  async function fetchCreditTransactionPage(accountId: string, cursor: string | null): Promise<NeoTransactionPage> {
    const data = await query<NeoCreditTransactionsResponse>('NeoCreditTransactions', CREDIT_TRANSACTIONS_QUERY, {
      creditAccountId: accountId,
      input: {
        primaryCursor: {
          field: 'authorizationProcessedAt',
          sort: 'DESC',
          type: 'DATE',
          ...(cursor ? { cursor } : {}),
        },
        limit: 10,
        filter: [],
      },
    });
    const transactions = data.user.creditAccount?.creditAccountTransactions;
    if (!transactions) {
      throw new Error('Neo credit account transactions were not returned');
    }
    return transactions;
  }

  async function fetchSavingsTransactionPage(accountId: string, cursor: string | null): Promise<NeoTransactionPage> {
    const data = await query<NeoSavingsTransactionsResponse>('NeoSavingsTransactions', SAVINGS_TRANSACTIONS_QUERY, {
      id: accountId,
      input: {
        primaryCursor: {
          field: 'authorizationProcessedAt',
          sort: 'DESC',
          type: 'DATE',
          ...(cursor ? { cursor } : {}),
        },
        limit: 20,
      },
    });
    const transactions = data.user.savingsAccount?.savingsAccountTransactions;
    if (!transactions) {
      throw new Error('Neo savings account transactions were not returned');
    }
    return transactions;
  }

  async function fetchTransactions(
    accountId: string,
    startDate: string,
    endDate: string,
    fetchPage: (id: string, cursor: string | null) => Promise<NeoTransactionPage>,
  ): Promise<NeoTransaction[]> {
    const transactions: NeoTransaction[] = [];
    let cursor: string | null = null;
    let hasNextPage = true;

    while (hasNextPage) {
      const page = await fetchPage(accountId, cursor);
      transactions.push(...page.results.filter((transaction) => {
        const date = transactionDate(transaction);
        return date >= startDate && date <= endDate;
      }));

      const lastTransaction = page.results.at(-1);
      if (lastTransaction && transactionDate(lastTransaction) < startDate) {
        break;
      }

      hasNextPage = page.hasNextPage;
      cursor = page.primaryCursor.cursor;
      if (hasNextPage && !cursor) {
        throw new Error('Neo transaction pagination is missing its next cursor');
      }
    }

    return transactions;
  }

  async function getAccounts(): Promise<NeoAccount[]> {
    const data = await query<NeoAccountsResponse>('NeoAccounts', ACCOUNTS_QUERY);
    const creditAccounts: NeoAccount[] = data.user.creditAccounts
      .filter((account) => account.status === 'OPEN')
      .map((account) => ({
        accountId: account.id,
        accountType: 'credit',
        accountSubtype: 'credit_card',
        category: 'CREDIT',
        productName: account.creditProduct.brandName,
        displayName: `${account.creditProduct.brandName} (${account.card.last4})`,
      }));
    const savingsAccounts: NeoAccount[] = data.user.savingsAccountsList.results
      .filter((account) => account.status === 'OPEN')
      .map((account) => ({
        accountId: account.id,
        accountType: 'depository',
        accountSubtype: account.category === 'EVERYDAY' ? 'checking' : 'savings',
        category: account.category,
        productName: account.program.productName,
        displayName: `${getProductName(account.program.productName)} (${account.card.last4})`,
      }));

    accountTypes.clear();
    creditAccounts.forEach((account) => accountTypes.set(account.accountId, 'credit'));
    savingsAccounts.forEach((account) => accountTypes.set(account.accountId, 'depository'));

    return [...creditAccounts, ...savingsAccounts];
  }

  return {
    getAccounts,
    getAccountsSummary: getAccounts,

    async getBalance(accountId: string): Promise<{ currentBalance: number; currency: string }> {
      if (accountTypeFor(accountId) === 'credit') {
        const data = await query<NeoCreditBalanceResponse>('NeoCreditBalance', CREDIT_BALANCE_QUERY, { id: accountId });
        const balance = data.user.creditAccount?.balances.totalCreditBalanceCents;
        if (balance === undefined) {
          throw new Error('Neo credit account balance was not returned');
        }
        return { currentBalance: balance / 100, currency: 'CAD' };
      }

      const data = await query<NeoSavingsBalanceResponse>('NeoSavingsBalance', SAVINGS_BALANCE_QUERY, { id: accountId });
      const balance = data.user.savingsAccount?.balances.currentBalanceCents;
      if (balance === undefined) {
        throw new Error('Neo savings account balance was not returned');
      }
      return { currentBalance: balance / 100, currency: 'CAD' };
    },

    async getCreditLimit(accountId: string): Promise<number | null> {
      if (accountTypeFor(accountId) !== 'credit') {
        return null;
      }
      const data = await query<NeoCreditLimitResponse>('NeoCreditLimit', CREDIT_LIMIT_QUERY, { id: accountId });
      const limit = data.user.creditAccount?.creditLimitCents;
      if (limit === undefined) {
        throw new Error('Neo credit limit was not returned');
      }
      return limit / 100;
    },

    async getTransactions(accountId: string, startDate: string, endDate: string): Promise<NeoTransaction[]> {
      const fetchPage = accountTypeFor(accountId) === 'credit'
        ? fetchCreditTransactionPage
        : fetchSavingsTransactionPage;
      return fetchTransactions(accountId, startDate, endDate, fetchPage);
    },
  };
}
