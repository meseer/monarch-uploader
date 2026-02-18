/**
 * Tests for MBNA Balance Reconstruction
 */

import { buildBalanceHistory } from '../../../src/integrations/mbna/balanceReconstruction';

describe('MBNA Balance Reconstruction', () => {
  describe('buildBalanceHistory', () => {
    it('should create entries from statement checkpoints', () => {
      const result = buildBalanceHistory({
        currentBalance: null,
        statements: [
          { closingDate: '2026-01-14', statementBalance: 158.41, transactions: [] },
          { closingDate: '2025-12-15', statementBalance: 200.00, transactions: [] },
        ],
        currentCycleSettled: null,
        startDate: '2025-12-01',
      });

      expect(result.length).toBeGreaterThanOrEqual(2);
      const dates = result.map((e) => e.date);
      expect(dates).toContain('2026-01-14');
      expect(dates).toContain('2025-12-15');

      const jan14 = result.find((e) => e.date === '2026-01-14');
      expect(jan14.balance).toBe(158.41);
    });

    it('should filter entries by startDate', () => {
      const result = buildBalanceHistory({
        currentBalance: null,
        statements: [
          { closingDate: '2026-01-14', statementBalance: 100, transactions: [] },
          { closingDate: '2025-11-14', statementBalance: 50, transactions: [] },
        ],
        currentCycleSettled: null,
        startDate: '2025-12-01',
      });

      const dates = result.map((e) => e.date);
      expect(dates).toContain('2026-01-14');
      expect(dates).not.toContain('2025-11-14');
    });

    it('should reconstruct balances from transactions within a statement period', () => {
      const result = buildBalanceHistory({
        currentBalance: null,
        statements: [
          {
            closingDate: '2026-01-14',
            statementBalance: 100,
            transactions: [
              { transactionDate: '2026-01-10', amount: 50 },
              { transactionDate: '2026-01-05', amount: 30 },
            ],
          },
        ],
        currentCycleSettled: null,
        startDate: '2025-12-01',
      });

      expect(result.length).toBeGreaterThanOrEqual(3);

      const closing = result.find((e) => e.date === '2026-01-14');
      expect(closing.balance).toBe(100);
    });

    it('should include current balance as today entry', () => {
      const today = new Date().toISOString().split('T')[0];

      const result = buildBalanceHistory({
        currentBalance: 93.12,
        statements: [],
        currentCycleSettled: [],
        startDate: '2025-12-01',
      });

      const todayEntry = result.find((e) => e.date === today);
      expect(todayEntry).toBeDefined();
      expect(todayEntry.balance).toBe(93.12);
    });

    it('should handle empty statements', () => {
      const result = buildBalanceHistory({
        currentBalance: 50,
        statements: [],
        currentCycleSettled: [],
        startDate: '2025-01-01',
      });

      expect(result.length).toBeGreaterThanOrEqual(1);
    });

    it('should sort results oldest first', () => {
      const result = buildBalanceHistory({
        currentBalance: 50,
        statements: [
          { closingDate: '2026-01-14', statementBalance: 100, transactions: [] },
          { closingDate: '2025-12-15', statementBalance: 200, transactions: [] },
        ],
        currentCycleSettled: [],
        startDate: '2025-12-01',
      });

      for (let i = 1; i < result.length; i += 1) {
        expect(result[i].date >= result[i - 1].date).toBe(true);
      }
    });

    it('should handle statements with null statementBalance', () => {
      const result = buildBalanceHistory({
        currentBalance: null,
        statements: [
          { closingDate: '2026-01-14', statementBalance: null, transactions: [] },
          { closingDate: '2025-12-15', statementBalance: 100, transactions: [] },
        ],
        currentCycleSettled: null,
        startDate: '2025-12-01',
      });

      const jan14 = result.find((e) => e.date === '2026-01-14');
      expect(jan14).toBeUndefined();

      const dec15 = result.find((e) => e.date === '2025-12-15');
      expect(dec15.balance).toBe(100);
    });

    it('should round balances to avoid floating point issues', () => {
      const result = buildBalanceHistory({
        currentBalance: null,
        statements: [
          {
            closingDate: '2026-01-14',
            statementBalance: 100.10,
            transactions: [
              { transactionDate: '2026-01-10', amount: 33.33 },
              { transactionDate: '2026-01-10', amount: 33.33 },
            ],
          },
        ],
        currentCycleSettled: null,
        startDate: '2025-12-01',
      });

      for (const entry of result) {
        const decimals = entry.balance.toString().split('.')[1] || '';
        expect(decimals.length).toBeLessThanOrEqual(2);
      }
    });
  });
});