/**
 * Tests for MBNA Transaction Processing Service
 */

import {
  processMbnaTransactions,
  filterDuplicateSettledTransactions,
} from '../../../src/services/mbna/transactions';

describe('MBNA Transaction Processing', () => {
  describe('processMbnaTransactions', () => {
    const sampleSettled = [
      {
        transactionDate: '2026-02-15',
        description: 'Amazon.ca*RA6HH70U3 TORONTO ON',
        referenceNumber: '55490535351206796539264',
        amount: 77.82,
        endingIn: '4201',
      },
      {
        transactionDate: '2026-02-10',
        description: 'PAYMENT',
        referenceNumber: '03000306013000455833905',
        amount: -13.32,
        endingIn: '4201',
      },
    ];

    const samplePending = [
      {
        transactionDate: '2026-02-17',
        description: 'UBER *EATS HELP.UBER.COM ON',
        referenceNumber: 'TEMP',
        amount: 25.50,
        endingIn: '4201',
        generatedId: 'mbna-tx:abc123def456ab78',
        isPending: true,
      },
    ];

    it('should process settled transactions with merchant mapping', () => {
      const result = processMbnaTransactions(sampleSettled, []);

      expect(result.settled).toHaveLength(2);
      expect(result.pending).toHaveLength(0);
      expect(result.all).toHaveLength(2);

      // Amazon.ca*RA6HH70U3 TORONTO ON → "Amazon.ca" (asterisk stripped, then title case)
      expect(result.settled[0].merchant).toBe('Amazon.ca');
      expect(result.settled[0].originalStatement).toBe('Amazon.ca*RA6HH70U3 TORONTO ON');
      expect(result.settled[0].date).toBe('2026-02-15');
      expect(result.settled[0].amount).toBe(77.82);
      expect(result.settled[0].isPending).toBe(false);
    });

    it('should auto-categorize PAYMENT transactions', () => {
      const result = processMbnaTransactions(sampleSettled, []);

      const paymentTx = result.settled.find((tx) => tx.originalStatement === 'PAYMENT');
      expect(paymentTx.autoCategory).toBe('Credit Card Payment');
      expect(paymentTx.merchant).toBe('MBNA Credit Card Payment');
    });

    it('should not auto-categorize non-PAYMENT transactions', () => {
      const result = processMbnaTransactions(sampleSettled, []);

      const amazonTx = result.settled.find((tx) => tx.originalStatement === 'Amazon.ca*RA6HH70U3 TORONTO ON');
      expect(amazonTx.autoCategory).toBeNull();
    });

    it('should process pending transactions with generatedId', () => {
      const result = processMbnaTransactions([], samplePending);

      expect(result.pending).toHaveLength(1);
      expect(result.pending[0].isPending).toBe(true);
      expect(result.pending[0].pendingId).toBe('mbna-tx:abc123def456ab78');
      // Non-Amazon merchant: asterisk is NOT stripped, full title case applied
      expect(result.pending[0].merchant).toBe('Uber *eats Help.uber.com on');
    });

    it('should exclude pending when includePending is false', () => {
      const result = processMbnaTransactions(sampleSettled, samplePending, { includePending: false });

      expect(result.settled).toHaveLength(2);
      expect(result.pending).toHaveLength(0);
      expect(result.all).toHaveLength(2);
    });

    it('should combine settled and pending in all array', () => {
      const result = processMbnaTransactions(sampleSettled, samplePending);

      expect(result.all).toHaveLength(3);
      expect(result.all.filter((tx) => tx.isPending)).toHaveLength(1);
      expect(result.all.filter((tx) => !tx.isPending)).toHaveLength(2);
    });

    it('should handle empty inputs', () => {
      const result = processMbnaTransactions([], []);
      expect(result.settled).toHaveLength(0);
      expect(result.pending).toHaveLength(0);
      expect(result.all).toHaveLength(0);
    });

    it('should keep amount signs as-is', () => {
      const result = processMbnaTransactions(sampleSettled, []);

      const charge = result.settled.find((tx) => tx.amount > 0);
      const payment = result.settled.find((tx) => tx.amount < 0);
      expect(charge.amount).toBe(77.82);
      expect(payment.amount).toBe(-13.32);
    });
  });

  describe('filterDuplicateSettledTransactions', () => {
    const transactions = [
      { referenceNumber: 'REF1', date: '2026-02-10', amount: 10 },
      { referenceNumber: 'REF2', date: '2026-02-11', amount: 20 },
      { referenceNumber: 'REF3', date: '2026-02-12', amount: 30 },
    ];

    it('should filter out already uploaded transactions', () => {
      const uploaded = [
        { id: 'REF1', date: '2026-02-10' },
        { id: 'REF2', date: '2026-02-11' },
      ];

      const result = filterDuplicateSettledTransactions(transactions, uploaded);

      expect(result.newTransactions).toHaveLength(1);
      expect(result.newTransactions[0].referenceNumber).toBe('REF3');
      expect(result.duplicateCount).toBe(2);
    });

    it('should return all when no uploaded history', () => {
      const result = filterDuplicateSettledTransactions(transactions, []);
      expect(result.newTransactions).toHaveLength(3);
      expect(result.duplicateCount).toBe(0);
    });

    it('should return all when uploaded is null', () => {
      const result = filterDuplicateSettledTransactions(transactions, null);
      expect(result.newTransactions).toHaveLength(3);
      expect(result.duplicateCount).toBe(0);
    });

    it('should handle empty transaction list', () => {
      const result = filterDuplicateSettledTransactions([], [{ id: 'REF1' }]);
      expect(result.newTransactions).toHaveLength(0);
      expect(result.duplicateCount).toBe(0);
    });
  });
});