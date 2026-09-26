import { createApi } from '../../../src/integrations/neo/source/api';

const accountsResponse = {
  user: {
    creditAccounts: [
      {
        id: 'credit-1',
        status: 'OPEN',
        card: { last4: '1234' },
        creditProduct: { brandName: 'Neo Mastercard' },
      },
      {
        id: 'closed-credit',
        status: 'CLOSED',
        card: { last4: '5678' },
        creditProduct: { brandName: 'Neo Mastercard' },
      },
    ],
    savingsAccountsList: {
      results: [
        {
          id: 'everyday-1',
          category: 'EVERYDAY',
          status: 'OPEN',
          program: { productName: 'EVERYDAY' },
          card: { last4: '2468' },
        },
        {
          id: 'savings-1',
          category: 'HISA',
          status: 'OPEN',
          program: { productName: 'SAVINGS' },
          card: { last4: '1357' },
        },
        {
          id: 'closed-savings',
          category: 'HISA',
          status: 'CLOSED',
          program: { productName: 'HISA' },
          card: { last4: '9753' },
        },
      ],
    },
  },
};

function graphqlResponse(data) {
  return {
    status: 200,
    responseText: JSON.stringify([{ data }]),
    responseHeaders: '',
    response: null,
  };
}

function operationFromRequest(request) {
  return JSON.parse(request.data)[0];
}

describe('Neo API client', () => {
  it('discovers open and closed credit accounts with open deposits', async () => {
    const httpClient = {
      request: jest.fn().mockResolvedValue(graphqlResponse(accountsResponse)),
    };
    const api = createApi(httpClient, {});

    const accounts = await api.getAccountsSummary();

    expect(accounts).toEqual([
      {
        accountId: 'credit-1',
        accountType: 'credit',
        accountSubtype: 'credit_card',
        category: 'CREDIT',
        productName: 'Neo Mastercard',
        displayName: 'Neo Mastercard (1234)',
      },
      {
        accountId: 'closed-credit',
        accountType: 'credit',
        accountSubtype: 'credit_card',
        category: 'CREDIT',
        productName: 'Neo Mastercard',
        displayName: 'Neo Mastercard (5678)',
      },
      {
        accountId: 'everyday-1',
        accountType: 'depository',
        accountSubtype: 'checking',
        category: 'EVERYDAY',
        productName: 'EVERYDAY',
        displayName: 'Neo Everyday (2468)',
      },
      {
        accountId: 'savings-1',
        accountType: 'depository',
        accountSubtype: 'savings',
        category: 'HISA',
        productName: 'SAVINGS',
        displayName: 'Neo Savings (1357)',
      },
    ]);

    expect(httpClient.request).toHaveBeenCalledWith(expect.objectContaining({
      method: 'POST',
      url: 'https://api.production.neofinancial.com/graphql',
      headers: expect.objectContaining({ 'x-client-locale': 'en-CA' }),
    }));
    expect(JSON.parse(httpClient.request.mock.calls[0][0].data)).toHaveLength(1);
    expect(operationFromRequest(httpClient.request.mock.calls[0][0]).operationName).toBe('NeoAccounts');
  });

  it('discovers deposit accounts that do not have an associated card', async () => {
    const data = {
      user: {
        creditAccounts: [],
        savingsAccountsList: {
          results: [{
            id: 'savings-without-card',
            category: 'HISA',
            status: 'OPEN',
            program: { productName: 'SAVINGS' },
            card: null,
          }],
        },
      },
    };
    const httpClient = { request: jest.fn().mockResolvedValue(graphqlResponse(data)) };
    const api = createApi(httpClient, {});

    await expect(api.getAccountsSummary()).resolves.toEqual([{
      accountId: 'savings-without-card',
      accountType: 'depository',
      accountSubtype: 'savings',
      category: 'HISA',
      productName: 'SAVINGS',
      displayName: 'Neo Savings',
    }]);
  });

  it('converts current balances and credit limits from cents', async () => {
    const httpClient = {
      request: jest.fn()
        .mockResolvedValueOnce(graphqlResponse(accountsResponse))
        .mockResolvedValueOnce(graphqlResponse({
          user: { creditAccount: { balances: { totalCreditBalanceCents: 12345 } } },
        }))
        .mockResolvedValueOnce(graphqlResponse({
          user: { savingsAccount: { balances: { currentBalanceCents: 54321 } } },
        }))
        .mockResolvedValueOnce(graphqlResponse({ user: { creditAccount: { creditLimitCents: 800000 } } })),
    };
    const api = createApi(httpClient, {});
    await api.getAccounts();

    await expect(api.getBalance('credit-1')).resolves.toEqual({ currentBalance: 123.45, currency: 'CAD' });
    await expect(api.getBalance('everyday-1')).resolves.toEqual({ currentBalance: 543.21, currency: 'CAD' });
    await expect(api.getCreditLimit('credit-1')).resolves.toBe(8000);

    expect(operationFromRequest(httpClient.request.mock.calls[1][0]).operationName).toBe('NeoCreditBalance');
    expect(operationFromRequest(httpClient.request.mock.calls[2][0]).operationName).toBe('NeoSavingsBalance');
  });

  it('does not request a credit limit for a deposit account', async () => {
    const httpClient = {
      request: jest.fn().mockResolvedValue(graphqlResponse(accountsResponse)),
    };
    const api = createApi(httpClient, {});
    await api.getAccounts();

    await expect(api.getCreditLimit('everyday-1')).resolves.toBeNull();
    expect(httpClient.request).toHaveBeenCalledTimes(1);
  });

  it('paginates credit transactions through account history and excludes future transactions', async () => {
    const firstPage = {
      user: {
        creditAccount: {
          creditAccountTransactions: {
            primaryCursor: { cursor: 'next-page' },
            hasNextPage: true,
            results: [
              { id: 'after-range', authorizationProcessedAt: '2026-02-01T12:00:00Z' },
              { id: 'newer', authorizationProcessedAt: '2026-01-20T00:00:00Z' },
            ],
          },
        },
      },
    };
    const secondPage = {
      user: {
        creditAccount: {
          creditAccountTransactions: {
            primaryCursor: { cursor: 'oldest-page' },
            hasNextPage: true,
            results: [
              { id: 'older', authorizationProcessedAt: '2026-01-02T00:00:00Z' },
              { id: 'before-range', authorizationProcessedAt: '2025-12-31T12:00:00Z' },
            ],
          },
        },
      },
    };
    const thirdPage = {
      user: {
        creditAccount: {
          creditAccountTransactions: {
            primaryCursor: { cursor: null },
            hasNextPage: false,
            results: [
              { id: 'account-opening', authorizationProcessedAt: '2025-01-01T12:00:00Z' },
            ],
          },
        },
      },
    };
    const httpClient = {
      request: jest.fn()
        .mockResolvedValueOnce(graphqlResponse(accountsResponse))
        .mockResolvedValueOnce(graphqlResponse(firstPage))
        .mockResolvedValueOnce(graphqlResponse(secondPage))
        .mockResolvedValueOnce(graphqlResponse(thirdPage)),
    };
    const api = createApi(httpClient, {});
    await api.getAccounts();

    const transactions = await api.getTransactions('closed-credit', '2026-01-31');

    expect(transactions.map((tx) => tx.id)).toEqual(['newer', 'older', 'before-range', 'account-opening']);
    expect(httpClient.request).toHaveBeenCalledTimes(4);
    const nextRequest = operationFromRequest(httpClient.request.mock.calls[2][0]);
    const oldestRequest = operationFromRequest(httpClient.request.mock.calls[3][0]);
    expect(nextRequest.operationName).toBe('NeoCreditTransactions');
    expect(oldestRequest.operationName).toBe('NeoCreditTransactions');
    expect(operationFromRequest(httpClient.request.mock.calls[1][0]).query).toContain('status');
    expect(operationFromRequest(httpClient.request.mock.calls[1][0]).query).not.toContain('creditStatus');
    expect(nextRequest.variables.input.primaryCursor).toEqual({
      field: 'authorizationProcessedAt',
      sort: 'DESC',
      type: 'DATE',
      cursor: 'next-page',
    });
    expect(oldestRequest.variables.input.primaryCursor).toEqual({
      field: 'authorizationProcessedAt',
      sort: 'DESC',
      type: 'DATE',
      cursor: 'oldest-page',
    });
  });

  it('paginates savings transactions through account history', async () => {
    const transactions = [
      { id: 'recent-deposit-tx', authorizationProcessedAt: '2026-01-10T00:00:00Z' },
      { id: 'old-deposit-tx', authorizationProcessedAt: '2025-01-10T00:00:00Z' },
    ];
    const httpClient = {
      request: jest.fn()
        .mockResolvedValueOnce(graphqlResponse(accountsResponse))
        .mockResolvedValueOnce(graphqlResponse({
          user: { savingsAccount: { savingsAccountTransactions: {
            primaryCursor: { cursor: 'older-savings-page' }, hasNextPage: true, results: [transactions[0]],
          } } },
        }))
        .mockResolvedValueOnce(graphqlResponse({
          user: { savingsAccount: { savingsAccountTransactions: {
            primaryCursor: { cursor: null }, hasNextPage: false, results: [transactions[1]],
          } } },
        })),
    };
    const api = createApi(httpClient, {});
    await api.getAccounts();

    await expect(api.getTransactions('everyday-1', '2026-01-31')).resolves.toEqual(transactions);
    expect(operationFromRequest(httpClient.request.mock.calls[1][0]).operationName).toBe('NeoSavingsTransactions');
    expect(operationFromRequest(httpClient.request.mock.calls[2][0]).variables.input.primaryCursor).toEqual({
      field: 'authorizationProcessedAt',
      sort: 'DESC',
      type: 'DATE',
      cursor: 'older-savings-page',
    });
  });

  it('reports an expired Neo session on an unauthorized response', async () => {
    const httpClient = {
      request: jest.fn().mockResolvedValue({ status: 401, responseText: '', responseHeaders: '', response: null }),
    };
    const api = createApi(httpClient, {});

    await expect(api.getAccounts()).rejects.toThrow('Neo session expired');
  });
});
