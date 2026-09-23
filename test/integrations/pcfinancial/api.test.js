import { createApi, parseTransactionPage } from '../../../src/integrations/pcfinancial/source/api';
import { createMemoryStorageAdapter } from '../../../src/core/storageAdapter';
import { SESSION_KEY } from '../../../src/integrations/pcfinancial/source/session';

const accountId = 'sample-account';
const transaction = (id, date, amount) => ({
  accountId,
  transactionId: id,
  transactionTimestamp: '2026-09-20T12:00:00Z',
  postedDate: date,
  debitCredit: amount < 0 ? 'DEBIT' : 'CREDIT',
  currencyCode: 'CAD',
  merchantName: 'Example',
  description: 'Example purchase',
  signedFinalAmount: amount,
});
const page = (transactions, totalCount) => ({ transactions, pagination: { totalCount } });

describe('PC Financial posted transaction API', () => {
  let storage;
  let httpClient;
  let api;

  beforeEach(() => {
    storage = createMemoryStorageAdapter({
      [SESSION_KEY]: { accountIds: [accountId], headers: { authorization: 'Bearer test', mcid: 'test' } },
    });
    httpClient = { request: jest.fn() };
    api = createApi(httpClient, storage);
  });

  it('paginates oldest first and preserves signed amounts', async () => {
    httpClient.request
      .mockResolvedValueOnce({ status: 200, responseText: JSON.stringify(page([
        transaction('3', '2026-09-23', -10), transaction('2', '2026-09-22', 20),
      ], 3)) })
      .mockResolvedValueOnce({ status: 200, responseText: JSON.stringify(page([
        transaction('1', '2026-09-21', -5),
      ], 3)) });

    const result = await api.getPostedTransactions(accountId, '2026-09-21');
    expect(result.map((tx) => tx.transactionId)).toEqual(['1', '2', '3']);
    expect(result.map((tx) => tx.signedFinalAmount)).toEqual([-5, 20, -10]);
    expect(httpClient.request.mock.calls[1][0].url).toContain('offset=2');
    expect(httpClient.request.mock.calls[0][0].headers.authorization).toBe('Bearer test');
  });

  it('filters by posted date after fetching every page', async () => {
    httpClient.request
      .mockResolvedValueOnce({ status: 200, responseText: JSON.stringify(page([
        transaction('new', '2026-09-23', -10), transaction('old', '2026-09-01', 2),
      ], 3)) })
      .mockResolvedValueOnce({ status: 200, responseText: JSON.stringify(page([
        transaction('late-posting', '2026-09-21', 5),
      ], 3)) });

    const result = await api.getPostedTransactions(accountId, '2026-09-20');
    expect(result.map((tx) => tx.transactionId)).toEqual(['late-posting', 'new']);
    expect(httpClient.request).toHaveBeenCalledTimes(2);
  });

  it('clears expired credentials', async () => {
    httpClient.request.mockResolvedValue({ status: 401, responseText: '' });
    await expect(api.getAccountsSummary()).rejects.toThrow('session expired');
    expect(storage.get(SESSION_KEY)).toBeUndefined();
  });

  it('rejects an empty page before the reported total', async () => {
    httpClient.request.mockResolvedValue({ status: 200, responseText: JSON.stringify(page([], 10)) });
    await expect(api.getPostedTransactions(accountId, '2026-09-01')).rejects.toThrow('empty page');
  });
});

describe('PC Financial response validation', () => {
  it('rejects missing pagination and transaction IDs', () => {
    expect(() => parseTransactionPage({ transactions: [] }, accountId)).toThrow('pagination missing');
    expect(() => parseTransactionPage(page([{ postedDate: '2026-09-23', signedFinalAmount: 10 }], 1), accountId))
      .toThrow('transaction fields');
  });

  it('rejects missing signed amount rather than guessing its direction', () => {
    expect(() => parseTransactionPage(page([{
      ...transaction('1', '2026-09-23', 10), signedFinalAmount: undefined, originalAmount: 10,
    }], 1), accountId)).toThrow('transaction fields');
  });

  it('rejects mismatched accounts and amount direction', () => {
    expect(() => parseTransactionPage(page([{ ...transaction('1', '2026-09-23', 10), accountId: 'other' }], 1), accountId))
      .toThrow('transaction fields');
    expect(() => parseTransactionPage(page([{ ...transaction('1', '2026-09-23', 10), debitCredit: 'DEBIT' }], 1), accountId))
      .toThrow('transaction fields');
  });
});
