import syncHooks, { processTransaction } from '../../../src/integrations/pcfinancial/sinks/monarch/syncHooks';

describe('PC Financial sync hooks', () => {
  it('fetches and processes posted transactions', async () => {
    const raw = {
      accountId: 'acc-1',
      transactionId: 'tx-1',
      postedDate: '2026-09-23',
      debitCredit: 'DEBIT',
      currencyCode: 'CAD',
      merchantName: 'NO FRILLS',
      description: 'NO FRILLS #123',
      signedFinalAmount: -24.5,
    };
    const api = { getPostedTransactions: vi.fn().mockResolvedValue([raw]) };
    const onProgress = vi.fn();

    const fetched = await syncHooks.fetchTransactions(api, 'acc-1', '2026-09-01', { onProgress });
    const processed = syncHooks.processTransactions(fetched.settled, fetched.pending, { includePending: false });

    expect(onProgress).toHaveBeenCalledWith('Fetching posted transactions...');
    expect(processed.settled).toEqual([{
      date: '2026-09-23',
      merchant: 'NO FRILLS',
      originalStatement: 'NO FRILLS #123',
      amount: -24.5,
      referenceNumber: 'tx-1',
      isPending: false,
      pendingId: null,
      autoCategory: null,
    }]);
    expect(syncHooks.getSettledRefId(processed.settled[0])).toBe('tx-1');
    expect(syncHooks.getPendingRefId()).toBe('');
    await expect(syncHooks.resolveCategories(processed.settled, 'acc-1')).resolves.toEqual(processed.settled);
  });

  it('falls back to description or Unknown merchant when merchantName is absent', () => {
    expect(processTransaction({
      accountId: 'acc-1',
      transactionId: 'tx-2',
      postedDate: '2026-09-24',
      debitCredit: 'CREDIT',
      currencyCode: 'CAD',
      description: 'PAYMENT THANK YOU',
      signedFinalAmount: 100,
    })).toMatchObject({
      merchant: 'PAYMENT THANK YOU',
      originalStatement: 'PAYMENT THANK YOU',
      amount: 100,
    });

    expect(processTransaction({
      accountId: 'acc-1',
      transactionId: 'tx-3',
      postedDate: '2026-09-25',
      debitCredit: 'DEBIT',
      currencyCode: 'CAD',
      signedFinalAmount: -5,
    })).toMatchObject({
      merchant: 'Unknown merchant',
      originalStatement: 'Unknown merchant',
    });
  });

  it('includes transaction reference in notes only when storeTransactionDetailsInNotes is enabled', () => {
    const tx = { referenceNumber: 'tx-99', isPending: false };
    expect(syncHooks.buildTransactionNotes(tx, { storeTransactionDetailsInNotes: false })).toBe('');
    expect(syncHooks.buildTransactionNotes(tx, { storeTransactionDetailsInNotes: true })).toBe('tx-99');
  });

  it('suggests the account dateOpened for first sync when available', async () => {
    const api = { getAccountOpenedDate: vi.fn().mockResolvedValueOnce('2026-11-14') };
    await expect(syncHooks.suggestStartDate(api, 's1d-1234')).resolves.toEqual({
      date: '2026-11-14',
      description: 'Account opening date',
    });

    api.getAccountOpenedDate.mockResolvedValueOnce(null);
    await expect(syncHooks.suggestStartDate(api, 's1d-1234')).resolves.toBeNull();
  });

  it('builds consolidated account storage entry from discovered account metadata', () => {
    expect(syncHooks.buildAccountEntry({
      accountId: 's1d-1234',
      accountType: 'credit',
      accountSubtype: 'credit_card',
      productType: 'CREDIT-CARD',
      productCode: 'MX-PCE',
      maskedCardNumber: '5570',
      dateOpened: '2026-11-14',
      displayName: 'PC Mastercard (5570)',
    })).toEqual({
      id: 's1d-1234',
      accountId: 's1d-1234',
      accountType: 'credit',
      accountSubtype: 'credit_card',
      productType: 'CREDIT-CARD',
      productCode: 'MX-PCE',
      maskedCardNumber: '5570',
      endingIn: '5570',
      dateOpened: '2026-11-14',
      nickname: 'PC Mastercard (5570)',
      displayName: 'PC Mastercard (5570)',
    });
  });
});
