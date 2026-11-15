import { createApi, parseTransactionPage, LATE_POSTING_BUFFER_DAYS } from '../../../src/integrations/pcfinancial/source/api';

const accountId = 's1d-2fa3128fa6544bd68806c3686d24a53a';

const transaction = (id, date, amount, extra = {}) => ({
  accountId,
  transactionId: id,
  transactionTimestamp: `${date}T12:00:00Z`,
  postedDate: date,
  debitCredit: amount < 0 ? 'DEBIT' : 'CREDIT',
  currencyCode: 'CAD',
  merchantName: 'Example',
  description: 'Example purchase',
  signedFinalAmount: amount,
  ...extra,
});

const page = (transactions, totalCount, freezeMarker) => ({
  transactions,
  pagination: {
    totalCount,
    ...(freezeMarker ? { freezeMarker } : {}),
  },
});

function jsonResponse(data, status = 200) {
  return {
    status,
    responseText: JSON.stringify(data),
    responseHeaders: '',
    response: null,
  };
}

describe('PC Financial API client', () => {
  let httpClient;
  let api;

  beforeEach(() => {
    window.sessionStorage.clear();
    window.sessionStorage.setItem('CREDENTIALS', JSON.stringify({
      access_token: 'test-access-token',
      x_pcf_csrf_token: 'test-csrf-token',
    }));
    window.sessionStorage.setItem('UVCRLID', 'test-correlation-id');
    httpClient = { request: vi.fn() };
    api = createApi(httpClient);
  });

  it('discovers credit card and PC Money accounts via /config, /cards, and /details', async () => {
    httpClient.request
      .mockResolvedValueOnce(jsonResponse({
        accountConfigurationList: [
          { accountId, pastDueFlag: false },
          { accountId: 's1d-money-9876', pastDueFlag: false },
        ],
      }))
      .mockResolvedValueOnce(jsonResponse({
        numRetrieved: 1,
        cards: [{
          accountId,
          maskedCardNumber: '5570',
          productType: 'CREDIT-CARD',
          productCode: 'MX-PCE',
        }],
      }))
      .mockResolvedValueOnce(jsonResponse({
        accountId,
        productType: 'CREDIT-CARD',
        productCode: 'MX-PCE',
        maskedCardNumber: '5570',
        dateOpened: '2026-11-14',
        balance: 142.75,
        currency: 'CAD',
        creditLimit: 15000,
      }))
      .mockResolvedValueOnce(jsonResponse({
        accountId: 's1d-money-9876',
        productType: 'PC-MONEY',
        productCode: 'PCM',
        balance: 850.25,
        currency: 'CAD',
      }));

    const accounts = await api.getAccountsSummary();

    expect(accounts).toEqual([
      {
        accountId,
        accountType: 'credit',
        accountSubtype: 'credit_card',
        productType: 'CREDIT-CARD',
        productCode: 'MX-PCE',
        maskedCardNumber: '5570',
        endingIn: '5570',
        dateOpened: '2026-11-14',
        displayName: 'PC Mastercard (5570)',
      },
      {
        accountId: 's1d-money-9876',
        accountType: 'depository',
        accountSubtype: 'checking',
        productType: 'PC-MONEY',
        productCode: 'PCM',
        displayName: 'PC Money (9876)',
      },
    ]);

    // Subsequent balance, credit limit, and dateOpened calls reuse cached details from discovery
    await expect(api.getAccountOpenedDate(accountId)).resolves.toBe('2026-11-14');
    await expect(api.getAccountOpenedDate('s1d-money-9876')).resolves.toBeNull();
    await expect(api.getBalance(accountId)).resolves.toEqual({ currentBalance: 142.75, currency: 'CAD' });
    await expect(api.getCreditLimit(accountId)).resolves.toBe(15000);
    await expect(api.getBalance('s1d-money-9876')).resolves.toEqual({ currentBalance: 850.25, currency: 'CAD' });
    await expect(api.getCreditLimit('s1d-money-9876')).resolves.toBeNull();
    expect(httpClient.request).toHaveBeenCalledTimes(4);
  });

  it('fetches balance and credit limit directly when not yet cached', async () => {
    httpClient.request.mockResolvedValueOnce(jsonResponse({
      accountId,
      productType: 'CREDIT-CARD',
      maskedCardNumber: '5570',
      balance: 0,
      currency: 'CAD',
      creditLimit: 15000,
    }));

    await expect(api.getBalance(accountId)).resolves.toEqual({ currentBalance: 0, currency: 'CAD' });
    await expect(api.getCreditLimit(accountId)).resolves.toBe(15000);
    expect(httpClient.request).toHaveBeenCalledTimes(1);
  });

  it('sends required sessionStorage headers and fresh per-request identifiers', async () => {
    const seenIds = new Set();
    httpClient.request.mockImplementation(async ({ headers }) => {
      expect(headers.authorization).toBe('Bearer test-access-token');
      expect(headers['x-pcf-csrf-token']).toBe('test-csrf-token');
      expect(headers['uservice-correlation-id']).toBe('test-correlation-id');
      expect(headers['uservice-api-version']).toBe('1');
      expect(headers['uservice-channel-type']).toBe('DESKTOP_WEB');
      expect(headers.language).toBe('en');
      expect(headers['channel-timezone-name']).toBeTruthy();

      for (const key of ['x-nonce', 'uservice-message-id', 'uservice-traceability-id']) {
        expect(headers[key]).toBeTruthy();
        expect(seenIds.has(headers[key])).toBe(false);
        seenIds.add(headers[key]);
      }

      return jsonResponse(page([transaction('1', '2026-09-20', -10)], 1));
    });

    await api.getPostedTransactions(accountId, '2026-09-01');
    await api.getPostedTransactions(accountId, '2026-09-01');
    expect(httpClient.request).toHaveBeenCalledTimes(2);
  });

  it('retries transient HTTP 400 invalid_verifier responses with a fresh nonce', async () => {
    httpClient.request
      .mockResolvedValueOnce(jsonResponse({
        error: 'invalid_verifier',
        error_description: 'A verifier has already been set.',
      }, 400))
      .mockResolvedValueOnce(jsonResponse({
        accountId,
        productType: 'CREDIT-CARD',
        balance: 25.5,
        currency: 'CAD',
      }));

    await expect(api.getBalance(accountId)).resolves.toEqual({ currentBalance: 25.5, currency: 'CAD' });
    expect(httpClient.request).toHaveBeenCalledTimes(2);
    expect(httpClient.request.mock.calls[0][0].headers['x-nonce'])
      .not.toBe(httpClient.request.mock.calls[1][0].headers['x-nonce']);
  });

  it('paginates with freezeMarker and stops early once postedDate is before the late-posting buffer', async () => {
    expect(LATE_POSTING_BUFFER_DAYS).toBe(7);

    // fromDate is 2026-09-20, so cutoffDate is 2026-09-13.
    // Page 1 ends at 2026-09-15 (>= cutoffDate), so it fetches Page 2.
    // Page 2 includes a late-posted item (posted 2026-09-21) and ends at 2026-09-10 (< cutoffDate),
    // so pagination stops without requesting Page 3 even though totalCount is 60.
    httpClient.request
      .mockResolvedValueOnce(jsonResponse(page([
        transaction('newest', '2026-09-23', -10),
        transaction('within-buffer', '2026-09-15', -20),
      ], 60, 'freeze-abc')))
      .mockResolvedValueOnce(jsonResponse(page([
        transaction('late-posting', '2026-09-21', 5),
        transaction('before-cutoff', '2026-09-10', -15),
      ], 60, 'freeze-abc')));

    const result = await api.getPostedTransactions(accountId, '2026-09-20');

    expect(result.map((tx) => tx.transactionId)).toEqual(['late-posting', 'newest']);
    expect(httpClient.request).toHaveBeenCalledTimes(2);
    const secondUrl = new URL(httpClient.request.mock.calls[1][0].url);
    expect(secondUrl.searchParams.get('offset')).toBe('2');
    expect(secondUrl.searchParams.get('freezeMarker')).toBe('freeze-abc');
  });

  it('rejects missing credentials, expired sessions, invalid JSON, and empty pages before totalCount', async () => {
    window.sessionStorage.clear();
    await expect(api.getAccounts()).rejects.toThrow('PC Financial session not found');

    window.sessionStorage.setItem('CREDENTIALS', JSON.stringify({
      access_token: 'test-access-token',
      x_pcf_csrf_token: 'test-csrf-token',
    }));

    httpClient.request.mockResolvedValueOnce({ status: 401, responseText: '', responseHeaders: '', response: null });
    await expect(api.getAccounts()).rejects.toThrow('PC Financial session expired');

    httpClient.request.mockResolvedValueOnce({ status: 200, responseText: '<html>error</html>', responseHeaders: '', response: null });
    await expect(api.getAccounts()).rejects.toThrow('PC Financial API Error: AccountsConfig');

    httpClient.request.mockResolvedValueOnce(jsonResponse(page([], 10)));
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
    expect(() => parseTransactionPage(page([transaction('1', '2026-09-23', 10, { accountId: 'other' })], 1), accountId))
      .toThrow('transaction fields');
    expect(() => parseTransactionPage(page([transaction('1', '2026-09-23', 10, { debitCredit: 'DEBIT' })], 1), accountId))
      .toThrow('transaction fields');
  });
});
