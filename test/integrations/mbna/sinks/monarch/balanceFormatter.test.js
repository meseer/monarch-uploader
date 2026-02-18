/**
 * Tests for MBNA → Monarch Balance Formatting
 */

import { formatBalanceHistoryForMonarch } from '../../../../../src/integrations/mbna/sinks/monarch/balanceFormatter';

describe('MBNA → Monarch Balance Formatting', () => {
  describe('formatBalanceHistoryForMonarch', () => {
    it('should negate balance values for Monarch (MBNA positive=owed → Monarch negative=liability)', () => {
      const history = [
        { date: '2025-12-15', balance: 200 },
        { date: '2026-01-14', balance: 100 },
      ];

      const result = formatBalanceHistoryForMonarch(history);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ date: '2025-12-15', amount: -200 });
      expect(result[1]).toEqual({ date: '2026-01-14', amount: -100 });
    });

    it('should negate negative balances (MBNA credit/overpayment → Monarch positive)', () => {
      const history = [
        { date: '2025-12-15', balance: -50 },
      ];

      const result = formatBalanceHistoryForMonarch(history);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ date: '2025-12-15', amount: 50 });
    });

    it('should handle empty array', () => {
      const result = formatBalanceHistoryForMonarch([]);
      expect(result).toEqual([]);
    });
  });
});