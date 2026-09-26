jest.mock('../../../src/core/utils', () => ({
  debugLog: jest.fn(),
  formatDate: jest.fn((date) => date.toISOString().slice(0, 10)),
  getTodayLocal: jest.fn(() => '2026-01-31'),
}));

import syncHooks from '../../../src/integrations/neo/sinks/monarch/syncHooks';

describe('Neo sync hooks', () => {
  it('returns confirmed transactions oldest-first and excludes declined activity', async () => {
    const api = {
      getTransactions: jest.fn().mockResolvedValue([
        { id: 'new', status: 'CONFIRMED', authorizationProcessedAt: '2026-01-20T12:00:00Z' },
        { id: 'declined', status: 'DECLINED', authorizationProcessedAt: '2026-01-15T12:00:00Z' },
        { id: 'old', status: 'CONFIRMED', authorizationProcessedAt: '2026-01-02T12:00:00Z' },
      ]),
    };

    const result = await syncHooks.fetchTransactions(api, 'account-1', '2026-01-01', { onProgress: jest.fn() });

    expect(api.getTransactions).toHaveBeenCalledWith('account-1', '2026-01-31');
    expect(result.settled.map((transaction) => transaction.id)).toEqual(['old', 'new']);
    expect(result.pending).toEqual([]);
  });

  it('maps debit and credit cents to Monarch transaction signs', () => {
    const result = syncHooks.processTransactions([
      {
        id: 'debit-1',
        description: 'Unique Neo Merchant',
        type: 'DEBIT',
        status: 'CONFIRMED',
        amountCents: 1823,
        authorizationProcessedAt: '2026-01-10T12:00:00Z',
      },
      {
        id: 'credit-1',
        description: 'Neo Payment',
        type: 'CREDIT',
        status: 'CONFIRMED',
        amountCents: 850,
        authorizationProcessedAt: '2026-01-11T12:00:00Z',
      },
    ], [], { includePending: true });

    expect(result.settled.map(({ amount, date, referenceNumber, isPending }) => ({
      amount, date, referenceNumber, isPending,
    }))).toEqual([
      { amount: -18.23, date: '2026-01-10', referenceNumber: 'debit-1', isPending: false },
      { amount: 8.5, date: '2026-01-11', referenceNumber: 'credit-1', isPending: false },
    ]);
    expect(result.pending).toEqual([]);
  });

  it('stores a settled transaction ID in notes only when requested', () => {
    const transaction = { referenceNumber: 'neo-tx-1', isPending: false };

    expect(syncHooks.buildTransactionNotes(transaction, { storeTransactionDetailsInNotes: false })).toBe('');
    expect(syncHooks.buildTransactionNotes(transaction, { storeTransactionDetailsInNotes: true })).toBe('neo-tx-1');
  });
});
