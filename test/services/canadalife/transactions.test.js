/**
 * Tests for Canada Life Transaction Service
 */

import {
  isPendingActivity,
  sanitizeInvestmentVehicleName,
  mapActivityToCategory,
  generateActivityHash,
  processCanadaLifeActivity,
  processActivities,
  generateDateChunks,
} from '../../../src/services/canadalife/transactions';

describe('Canada Life Transaction Service', () => {
  describe('isPendingActivity', () => {
    test('returns true for known pending activity type', () => {
      expect(isPendingActivity('New contribution  - awaiting investment')).toBe(true);
    });

    test('returns false for known settled activity types', () => {
      expect(isPendingActivity('New contribution')).toBe(false);
      expect(isPendingActivity('New contribution (reversed)')).toBe(false);
      expect(isPendingActivity('You switched from another subgroup/plan')).toBe(false);
      expect(isPendingActivity('You switched to another subgroup/plan')).toBe(false);
      expect(isPendingActivity('You switched from another investment')).toBe(false);
      expect(isPendingActivity('You switched to another investment')).toBe(false);
    });

    test('returns false for unknown activity types', () => {
      expect(isPendingActivity('Unknown Activity')).toBe(false);
      expect(isPendingActivity('')).toBe(false);
    });

    test('returns false for null/undefined', () => {
      expect(isPendingActivity(null)).toBe(false);
      expect(isPendingActivity(undefined)).toBe(false);
    });
  });

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

    test('maps pending activity to Buy', () => {
      expect(mapActivityToCategory('New contribution  - awaiting investment')).toBe('Buy');
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
    test('generates hash with cl-tx: prefix', async () => {
      const activity = {
        Date: '2024-01-15',
        Activity: 'New contribution',
        Amount: 100.50,
        Units: 5.123,
        InvestmentVehicleAndAccountLongName: 'Test Fund',
      };

      const hash = await generateActivityHash(activity);
      expect(hash).toMatch(/^cl-tx:[a-f0-9]{16}$/);
    });

    test('does NOT use old cl- prefix format', async () => {
      const activity = {
        Date: '2024-01-15',
        Activity: 'New contribution',
        Amount: 100.50,
        Units: 5.123,
        InvestmentVehicleAndAccountLongName: 'Test Fund',
      };

      const hash = await generateActivityHash(activity);
      expect(hash).not.toMatch(/^cl-[a-f0-9]{16}$/);
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
      expect(hash).toMatch(/^cl-tx:[a-f0-9]{16}$/);
    });

    test('pending activity (Units=null) generates different hash than settled', async () => {
      const pendingActivity = {
        Date: '2024-01-15',
        Activity: 'New contribution  - awaiting investment',
        Amount: 100.50,
        Units: null,
        InvestmentVehicleAndAccountLongName: 'Test Fund',
      };

      const settledActivity = {
        Date: '2024-01-15',
        Activity: 'New contribution',
        Amount: 100.50,
        Units: 5.123,
        InvestmentVehicleAndAccountLongName: 'Test Fund',
      };

      const pendingHash = await generateActivityHash(pendingActivity);
      const settledHash = await generateActivityHash(settledActivity);
      expect(pendingHash).not.toBe(settledHash);
    });
  });

  describe('processCanadaLifeActivity', () => {
    test('processes a settled activity correctly', async () => {
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
      expect(transaction.id).toMatch(/^cl-tx:[a-f0-9]{16}$/);
      expect(transaction.isPending).toBe(false);
      expect(transaction.pendingId).toMatch(/^cl-tx:[a-f0-9]{16}$/);
    });

    test('processes a pending activity correctly', async () => {
      const activity = {
        Date: '2024-01-15T00:00:00',
        Activity: 'New contribution  - awaiting investment',
        Amount: 200.00,
        Units: null,
        InterestRateOrUnitPrice: null,
        InvestmentVehicleAndAccountLongName: 'Canadian Equity Index (TDAM)-Member',
      };

      const transaction = await processCanadaLifeActivity(activity, 'Test Account');

      expect(transaction.isPending).toBe(true);
      expect(transaction.category).toBe('Buy');
      expect(transaction.id).toMatch(/^cl-tx:[a-f0-9]{16}$/);
      expect(transaction.pendingId).toBe(transaction.id);
      expect(transaction.notes).toContain('Pending - awaiting investment');
      // Should NOT contain unit/price info for pending
      expect(transaction.notes).not.toContain('Bought');
      expect(transaction.notes).not.toContain('Sold');
    });

    test('pending activity notes do not include Units or price', async () => {
      const activity = {
        Date: '2024-01-15',
        Activity: 'New contribution  - awaiting investment',
        Amount: 100.00,
        Units: null,
        InterestRateOrUnitPrice: null,
        InvestmentVehicleAndAccountLongName: 'Test Fund-Member',
      };

      const transaction = await processCanadaLifeActivity(activity, 'Account');
      expect(transaction.notes).toBe('New contribution  - awaiting investment: Pending - awaiting investment');
    });

    test('unknown activity appends activity type to notes', async () => {
      const activity = {
        Date: '2024-01-15',
        Activity: 'Some Unknown Activity Type',
        Amount: 50.00,
        Units: 1.5,
        InterestRateOrUnitPrice: 33.33,
        InvestmentVehicleAndAccountLongName: 'Test Fund',
      };

      const transaction = await processCanadaLifeActivity(activity, 'Account');

      expect(transaction.category).toBe('Uncategorized');
      expect(transaction.notes).toContain("'Some Unknown Activity Type'");
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
      expect(transaction.isPending).toBe(false);
    });
  });

  describe('processActivities', () => {
    test('processes multiple activities and returns sorted transactions', async () => {
      const activities = [
        {
          Date: '2024-01-20',
          Activity: 'New contribution',
          Amount: 200,
          Units: 10,
          InvestmentVehicleAndAccountLongName: 'Fund A',
        },
        {
          Date: '2024-01-15',
          Activity: 'New contribution',
          Amount: 100,
          Units: 5,
          InvestmentVehicleAndAccountLongName: 'Fund A',
        },
      ];

      const transactions = await processActivities(activities, 'Test Account');
      expect(transactions).toHaveLength(2);
      // Should be sorted oldest first
      expect(transactions[0].date).toBe('2024-01-15');
      expect(transactions[1].date).toBe('2024-01-20');
    });

    test('skips already uploaded transactions', async () => {
      const activity = {
        Date: '2024-01-15',
        Activity: 'New contribution',
        Amount: 100,
        Units: 5,
        InvestmentVehicleAndAccountLongName: 'Fund A',
      };

      // First, get the hash to use as an uploaded ID
      const { generateActivityHash: getHash } = await import('../../../src/services/canadalife/transactions');
      const hash = await getHash(activity);

      const transactions = await processActivities([activity], 'Account', {
        uploadedTransactionIds: new Set([hash]),
      });

      expect(transactions).toHaveLength(0);
    });

    test('skips pending transactions when includePendingTransactions is false', async () => {
      const activities = [
        {
          Date: '2024-01-15',
          Activity: 'New contribution  - awaiting investment',
          Amount: 100,
          Units: null,
          InvestmentVehicleAndAccountLongName: 'Fund A',
        },
        {
          Date: '2024-01-16',
          Activity: 'New contribution',
          Amount: 200,
          Units: 10,
          InvestmentVehicleAndAccountLongName: 'Fund A',
        },
      ];

      const transactions = await processActivities(activities, 'Account', {
        includePendingTransactions: false,
      });

      expect(transactions).toHaveLength(1);
      expect(transactions[0].isPending).toBe(false);
    });

    test('includes pending transactions when includePendingTransactions is true (default)', async () => {
      const activities = [
        {
          Date: '2024-01-15',
          Activity: 'New contribution  - awaiting investment',
          Amount: 100,
          Units: null,
          InvestmentVehicleAndAccountLongName: 'Fund A',
        },
        {
          Date: '2024-01-16',
          Activity: 'New contribution',
          Amount: 200,
          Units: 10,
          InvestmentVehicleAndAccountLongName: 'Fund A',
        },
      ];

      const transactions = await processActivities(activities, 'Account');

      expect(transactions).toHaveLength(2);
      expect(transactions.some((t) => t.isPending)).toBe(true);
    });

    test('returns empty array for empty activities', async () => {
      const transactions = await processActivities([], 'Account');
      expect(transactions).toHaveLength(0);
    });

    test('returns empty array for null activities', async () => {
      const transactions = await processActivities(null, 'Account');
      expect(transactions).toHaveLength(0);
    });
  });

  describe('generateDateChunks', () => {
    test('returns single chunk for period under 365 days', () => {
      const chunks = generateDateChunks('2024-01-01', '2024-06-01');
      expect(chunks).toHaveLength(1);
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
      const chunks = generateDateChunks('2024-01-15', '2024-01-16');
      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toEqual({
        start: '2024-01-15',
        end: '2024-01-16',
      });
    });
  });
});