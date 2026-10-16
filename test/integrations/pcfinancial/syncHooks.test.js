import syncHooks, { processTransaction } from '../../../src/integrations/pcfinancial/sinks/monarch/syncHooks';

describe('PC Financial Monarch transaction mapping', () => {
  it('uses the signed amount and stable transaction ID', () => {
    const result = processTransaction({
      transactionId: 'tx-1',
      transactionTimestamp: '2026-09-23T12:00:00',
      postedDate: '2026-09-24',
      merchantName: 'Shop',
      description: 'Shop description',
      signedFinalAmount: -12.34,
    });
    expect(result).toMatchObject({
      date: '2026-09-24', merchant: 'Shop', originalStatement: 'Shop description',
      amount: -12.34, referenceNumber: 'tx-1', isPending: false,
    });
    expect(syncHooks.getSettledRefId(result)).toBe('tx-1');
  });
});
