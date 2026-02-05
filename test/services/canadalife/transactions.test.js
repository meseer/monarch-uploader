/**
 * Tests for Canada Life Transaction Service
 */

import {
  sanitizeInvestmentVehicleName,
  mapActivityToCategory,
  generateActivityHash,
  processCanadaLifeActivity,
  generateDateChunks,
  convertTransactionsToCSV,
} from '../../../src/services/canadalife/transactions';

describe('Canada Life Transaction Service', () => {
  describe('sanitizeInvestmentVehicleName', () => {
    test('removes -Member suffix from investment name', () => {
      expect(sanitizeInvestmentVehicleName('Sun Life MFS Global Growth Fund-Member')).toBe('Sun Life MFS Global Growth Fund');
    });

    test('removes -Employer suffix from investment name', () => {
      expect(sanitizeInvestmentVehicleName('BlackRock Canadian Equity Fund-Employer')).toBe('BlackRock Canadian Equity Fund');
    });

    test('keeps name unchanged when no suffix present', () => {
      expect(sanitizeInvestmentVehicleName('Regular Fund Name')).toBe('Regular Fund Name');
    });

    test('handles empty string', () => {
      expect(sanitizeInvestmentVehicleName('')).toBe('');
    });

    test('handles null/undefined input', () => {
      expect(sanitizeInvestmentVehicleName(null)).toBe('');
      expect(sanitizeInvestmentVehicleName(undefined)).toBe('');
    });

    test('handles name with -Member in the middle', () => {
      // Only suffix should be removed
      expect(sanitizeInvestmentVehicleName('Fund-Member Growth-Member')).toBe('Fund-Member Growth');
    });

    test('handles case sensitivity for suffix', () => {
      // The implementation uses lowercase comparison
      expect(sanitizeInvestmentVehicleName('Fund Name-member')).toBe('Fund Name');
      expect(sanitizeInvestmentVehicleName('Fund Name-MEMBER')).toBe('Fund Name');
    });
  });

  describe('mapActivityToCategory', () => {
    test('maps New contribution to Buy', () => {
      expect(mapActivityToCategory('New contribution')).toBe('Buy');
    });

    test('maps New contribution (reversed) to Sell', () => {
      expect(mapActivityToCategory('New contribution (reversed)')).toBe('Sell');
    });

    test('maps switch from another subgroup/plan to Buy', () => {
      expect(mapActivityToCategory('You switched from another subgroup/plan')).toBe('Buy');
    });

    test('maps switch to another subgroup/plan to Sell', () => {
      expect(mapActivityToCategory('You switched to another subgroup/plan')).toBe('Sell');
    });

    test('maps switch from another investment to Buy', () => {
      expect(mapActivityToCategory('You switched from another investment')).toBe('Buy');
    });

    test('maps switch to another investment to Sell', () => {
      expect(mapActivityToCategory('You switched to another investment')).toBe('Sell');
    });

    test('returns Uncategorized for unknown activity types', () => {
      expect(mapActivityToCategory('Unknown Activity')).toBe('Uncategorized');
      expect(mapActivityToCategory('Random Type')).toBe('Uncategorized');
      expect(mapActivityToCategory('')).toBe('Uncategorized');
    });

    test('handles null/undefined activity type', () => {
      expect(mapActivityToCategory(null)).toBe('Uncategorized');
      expect(mapActivityToCategory(undefined)).toBe('Uncategorized');
    });
  });

  describe('generateActivityHash', () => {
    test('generates hash with cl- prefix', async () => {
      // Use correct field names matching the implementation
      const activity = {
        Date: '2024-01-15',
        Activity: 'New contribution',
        Amount: 100.50,
        Units: 5.123,
        InvestmentVehicleAndAccountLongName: 'Test Fund',
      };

      const hash = await generateActivityHash(activity);
      expect(hash).toMatch(/^cl-[a-f0-9]{16}$/);
    });

    test('generates consistent hash for same activity', async () => {
      const activity = {
        Date: '2024-01-15',
        Activity: 'New contribution',
        Amount: 100.50,
        Units: 5.123,
        InvestmentVehicleAndAccountLongName: 'Test Fund',
      };

      const hash1 = await generateActivityHash(activity);
      const hash2 = await generateActivityHash(activity);
      expect(hash1).toBe(hash2);
    });

    test('generates different hashes for different activities', async () => {
      const activity1 = {
        Date: '2024-01-15',
        Activity: 'New contribution',
        Amount: 100.50,
        Units: 5.123,
        InvestmentVehicleAndAccountLongName: 'Test Fund',
      };

      const activity2 = {
        Date: '2024-01-16',
        Activity: 'New contribution',
        Amount: 100.50,
        Units: 5.123,
        InvestmentVehicleAndAccountLongName: 'Test Fund',
      };

      const hash1 = await generateActivityHash(activity1);
      const hash2 = await generateActivityHash(activity2);
      expect(hash1).not.toBe(hash2);
    });

    test('handles missing fields with fallback values', async () => {
      const activity = {
        Date: '2024-01-15',
      };

      const hash = await generateActivityHash(activity);
      expect(hash).toMatch(/^cl-[a-f0-9]{16}$/);
    });
  });

  describe('processCanadaLifeActivity', () => {
    test('processes a valid activity correctly', async () => {
      // Use correct field names matching the implementation
      const activity = {
        Date: '2024-01-15T00:00:00',
        Activity: 'New contribution',
        Amount: 100.50,
        Units: 5.123456,
        InterestRateOrUnitPrice: 19.62,
        InvestmentVehicleAndAccountLongName: 'Sun Life MFS Global Growth Fund-Member',
      };

      const transaction = await processCanadaLifeActivity(activity, 'Test Account');

      expect(transaction.date).toBe('2024-01-15');
      expect(transaction.merchant).toBe('Sun Life MFS Global Growth Fund');
      expect(transaction.category).toBe('Buy');
      expect(transaction.amount).toBe(100.5);
      expect(transaction.notes).toContain('New contribution');
      expect(transaction.notes).toContain('Sun Life MFS Global Growth Fund');
      expect(transaction.account).toBe('Test Account');
      expect(transaction.id).toMatch(/^cl-[a-f0-9]{16}$/);
    });

    test('handles date-only format', async () => {
      const activity = {
        Date: '2024-01-15',
        Activity: 'New contribution',
        Amount: 50.00,
        Units: 2.5,
        InvestmentVehicleAndAccountLongName: 'Test Fund',
      };

      const transaction = await processCanadaLifeActivity(activity, 'Account');
      expect(transaction.date).toBe('2024-01-15');
    });

    test('handles zero amount', async () => {
      const activity = {
        Date: '2024-01-15',
        Activity: 'New contribution',
        Amount: 0,
        Units: 0,
        InvestmentVehicleAndAccountLongName: 'Test Fund',
      };

      const transaction = await processCanadaLifeActivity(activity, 'Account');
      expect(transaction.amount).toBe(0);
    });

    test('handles missing optional fields', async () => {
      const activity = {
        Date: '2024-01-15',
        Activity: 'Unknown Type',
      };

      const transaction = await processCanadaLifeActivity(activity, 'Account');
      expect(transaction.date).toBe('2024-01-15');
      expect(transaction.category).toBe('Uncategorized');
      expect(transaction.amount).toBe(0);
      expect(transaction.merchant).toBe('');
    });
  });

  describe('generateDateChunks', () => {
    test('returns single chunk for period under 365 days', () => {
      const chunks = generateDateChunks('2024-01-01', '2024-06-01');
      expect(chunks).toHaveLength(1);
      // Implementation uses 'start' and 'end' not 'startDate' and 'endDate'
      expect(chunks[0]).toEqual({
        start: '2024-01-01',
        end: '2024-06-01',
      });
    });

    test('splits period into multiple chunks for over 365 days', () => {
      const chunks = generateDateChunks('2022-01-01', '2024-01-01');
      expect(chunks.length).toBeGreaterThan(1);

      // First chunk should start at the original start date
      expect(chunks[0].start).toBe('2022-01-01');

      // Last chunk should end at the original end date
      expect(chunks[chunks.length - 1].end).toBe('2024-01-01');

      // Each chunk should be at most 365 days
      chunks.forEach((chunk) => {
        const start = new Date(chunk.start);
        const end = new Date(chunk.end);
        const diffDays = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
        expect(diffDays).toBeLessThanOrEqual(365);
      });
    });

    test('handles exact 365-day period', () => {
      // Use a non-leap year (2023 has 365 days)
      const chunks = generateDateChunks('2023-01-01', '2023-12-31');
      expect(chunks).toHaveLength(1);
    });

    test('chunks are contiguous', () => {
      const chunks = generateDateChunks('2022-01-01', '2024-06-01');

      for (let i = 1; i < chunks.length; i++) {
        const prevEnd = new Date(chunks[i - 1].end);
        const currStart = new Date(chunks[i].start);
        const dayAfterPrevEnd = new Date(prevEnd);
        dayAfterPrevEnd.setDate(dayAfterPrevEnd.getDate() + 1);

        expect(currStart.toISOString().split('T')[0]).toBe(dayAfterPrevEnd.toISOString().split('T')[0]);
      }
    });

    test('handles start date before end date with single day', () => {
      // When start equals end (same day), the while loop condition (currentStart < end) is false
      // so no chunks are generated. This is edge case behavior.
      const chunks = generateDateChunks('2024-01-15', '2024-01-16');
      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toEqual({
        start: '2024-01-15',
        end: '2024-01-16',
      });
    });
  });

  describe('convertTransactionsToCSV', () => {
    test('converts transactions to CSV format with header', () => {
      const transactions = [
        {
          date: '2024-01-15',
          merchant: 'Test Fund',
          category: 'Buy',
          amount: 100.50,
          notes: 'Test note',
          account: 'Test Account',
          originalMerchant: 'Test Fund-Member',
        },
      ];

      const csv = convertTransactionsToCSV(transactions);
      const lines = csv.trim().split('\n');

      // Implementation uses this column order
      expect(lines[0]).toBe('"Date","Merchant","Category","Account","Original Statement","Notes","Amount"');
      expect(lines[1]).toBe('"2024-01-15","Test Fund","Buy","Test Account","Test Fund-Member","Test note","100.50"');
    });

    test('escapes double quotes in values', () => {
      const transactions = [
        {
          date: '2024-01-15',
          merchant: 'Fund "Special" Edition',
          category: 'Buy',
          amount: 100,
          notes: 'Note with "quotes"',
          account: 'Account',
          originalMerchant: 'Original',
        },
      ];

      const csv = convertTransactionsToCSV(transactions);
      expect(csv).toContain('Fund ""Special"" Edition');
      expect(csv).toContain('Note with ""quotes""');
    });

    test('handles multiple transactions', () => {
      const transactions = [
        {
          date: '2024-01-15',
          merchant: 'Fund A',
          category: 'Buy',
          amount: 100,
          notes: 'Note 1',
          account: 'Account',
          originalMerchant: 'Fund A',
        },
        {
          date: '2024-01-16',
          merchant: 'Fund B',
          category: 'Sell',
          amount: 50,
          notes: 'Note 2',
          account: 'Account',
          originalMerchant: 'Fund B',
        },
      ];

      const csv = convertTransactionsToCSV(transactions);
      const lines = csv.trim().split('\n');

      expect(lines).toHaveLength(3); // Header + 2 transactions
    });

    test('throws error for empty transaction array', () => {
      expect(() => convertTransactionsToCSV([])).toThrow('No transactions to convert');
    });

    test('throws error for null transactions', () => {
      expect(() => convertTransactionsToCSV(null)).toThrow('No transactions to convert');
    });

    test('formats amount with 2 decimal places', () => {
      const transactions = [
        {
          date: '2024-01-15',
          merchant: 'Fund',
          category: 'Buy',
          amount: 100,
          notes: '',
          account: 'Account',
          originalMerchant: 'Fund',
        },
        {
          date: '2024-01-16',
          merchant: 'Fund',
          category: 'Buy',
          amount: 99.994, // Should round to 99.99
          notes: '',
          account: 'Account',
          originalMerchant: 'Fund',
        },
      ];

      const csv = convertTransactionsToCSV(transactions);
      expect(csv).toContain('"100.00"');
      expect(csv).toContain('"99.99"');
    });
  });
});
