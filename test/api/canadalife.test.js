/**
 * Canada Life API Tests - Focus on loadAccountBalanceHistory last day processing
 */

import {
  loadAccountBalanceHistory,
} from '../../src/api/canadalife';

// Mock dependencies
jest.mock('../../src/core/state', () => ({
  getState: jest.fn().mockReturnValue({
    auth: {
      canadalife: {
        token: 'mock-aura-token',
      },
    },
  }),
}));

jest.mock('../../src/core/utils', () => ({
  debugLog: jest.fn(),
  parseLocalDate: jest.fn((dateString) => {
    const [year, month, day] = dateString.split('-').map(Number);
    return new Date(year, month - 1, day);
  }),
  formatDate: jest.fn((date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }),
}));

jest.mock('../../src/ui/toast', () => ({
  show: jest.fn(),
}));

// Mock GM functions
// eslint-disable-next-line no-global-assign
global.GM_getValue = jest.fn();
// eslint-disable-next-line no-global-assign
global.GM_setValue = jest.fn();
// eslint-disable-next-line no-global-assign
global.document = {
  cookie: 'mock-cookie=value',
};
// eslint-disable-next-line no-global-assign
global.fetch = jest.fn();

describe('Canada Life API - Last Day Processing Bug', () => {
  const mockAccount = {
    agreementId: 'test-agreement-123',
    EnglishShortName: 'TEST-RRSP',
    LongNameEnglish: 'Test RRSP Account',
  };

  // Helper to create mock balance API response
  const createMockBalanceResponse = (date, openingBalance, closingBalance) => ({
    IPResult: {
      Summary: {
        Total: { Value: closingBalance },
        Details: [
          {
            Description: `Value of this plan on ${date}`,
            Value: openingBalance,
          },
        ],
      },
    },
  });

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock fetch for makeAuraApiCall
    // eslint-disable-next-line no-global-assign
    global.fetch.mockImplementation(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        headers: {
          get: jest.fn((name) => {
            if (name === 'content-type') return 'application/json';
            if (name === 'content-length') return '1000';
            return null;
          }),
          entries: jest.fn(() => [
            ['content-type', 'application/json'],
            ['content-length', '1000'],
          ]),
        },
        text: () => Promise.resolve(`/*-secure-\n${JSON.stringify({
          actions: [{
            returnValue: {
              returnValue: JSON.stringify(createMockBalanceResponse('2024-01-15', 10000, 10100)),
            },
          }],
        })}\n*/`),
      }),
    );
  });

  describe('Business Days Generation', () => {
    test('should generate correct business days excluding weekends', () => {
      // Test actual dates that match real calendar
      // January 15, 2024 = Monday
      // January 19, 2024 = Friday
      
      // Mock the internal generateBusinessDays function behavior that matches the real implementation
      const generateBusinessDaysLocal = (startDate, endDate) => {
        const businessDays = [];
        // Use the exact same parsing logic as the real function
        const current = new Date(startDate + 'T00:00:00'); // Add time to avoid timezone issues
        const end = new Date(endDate + 'T00:00:00');

        while (current <= end) {
          const dayOfWeek = current.getDay();
          if (dayOfWeek !== 0 && dayOfWeek !== 6) { // Not Sunday or Saturday
            const year = current.getFullYear();
            const month = String(current.getMonth() + 1).padStart(2, '0');
            const day = String(current.getDate()).padStart(2, '0');
            businessDays.push(`${year}-${month}-${day}`);
          }
          current.setDate(current.getDate() + 1);
        }
        return businessDays;
      };

      // Test Monday to Friday (5 business days) - using actual 2024 calendar
      const businessDays = generateBusinessDaysLocal('2024-01-15', '2024-01-19'); // Mon-Fri
      expect(businessDays).toEqual([
        '2024-01-15', '2024-01-16', '2024-01-17', '2024-01-18', '2024-01-19',
      ]);
      expect(businessDays).toHaveLength(5);

      // Test single day
      const singleDay = generateBusinessDaysLocal('2024-01-15', '2024-01-15'); // Monday only
      expect(singleDay).toEqual(['2024-01-15']);
      expect(singleDay).toHaveLength(1);

      // Test weekend exclusion - Friday to Monday
      const withWeekend = generateBusinessDaysLocal('2024-01-12', '2024-01-15'); // Fri-Mon
      expect(withWeekend).toEqual(['2024-01-12', '2024-01-15']); // Excludes Sat/Sun
      expect(withWeekend).toHaveLength(2);
    });

    test('Real bug scenario: Today as end date should be included', () => {
      // This test replicates the user's exact scenario
      const generateBusinessDaysReal = (startDate, endDate) => {
        const businessDays = [];
        // Simulate the parseLocalDate function behavior
        const [startYear, startMonth, startDay] = startDate.split('-').map(Number);
        const [endYear, endMonth, endDay] = endDate.split('-').map(Number);
        
        const current = new Date(startYear, startMonth - 1, startDay);
        const end = new Date(endYear, endMonth - 1, endDay);

        while (current <= end) {
          const dayOfWeek = current.getDay();
          if (dayOfWeek !== 0 && dayOfWeek !== 6) { // Not Sunday or Saturday
            const year = current.getFullYear();
            const month = String(current.getMonth() + 1).padStart(2, '0');
            const day = String(current.getDate()).padStart(2, '0');
            businessDays.push(`${year}-${month}-${day}`);
          }
          current.setDate(current.getDate() + 1);
        }
        return businessDays;
      };

      // Test the exact scenario: user uploads at 1pm including today
      const today = '2024-10-11'; // Friday (the current date from environment)
      const yesterday = '2024-10-10'; // Thursday
      
      // Single day upload (today only) - this is the failing scenario
      const todayOnly = generateBusinessDaysReal(today, today);
      expect(todayOnly).toContain(today);
      expect(todayOnly).toHaveLength(1);

      // Two day upload ending on today
      const twoDays = generateBusinessDaysReal(yesterday, today);
      expect(twoDays).toContain(today);
      expect(twoDays).toContain(yesterday);
      expect(twoDays).toHaveLength(2);
    });
  });

  describe('loadAccountBalanceHistory - Weekend Extension', () => {
    test('Single day upload should include today in results', async () => {
      const today = '2024-01-15'; // Monday

      // Mock API response for today
      // eslint-disable-next-line no-global-assign
      global.fetch.mockImplementationOnce(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          headers: {
            get: jest.fn((name) => {
              if (name === 'content-type') return 'application/json';
              if (name === 'content-length') return '1000';
              return null;
            }),
            entries: jest.fn(() => [
              ['content-type', 'application/json'],
              ['content-length', '1000'],
            ]),
          },
          text: () => Promise.resolve(`/*-secure-\n${JSON.stringify({
            actions: [{
              returnValue: {
                returnValue: JSON.stringify(createMockBalanceResponse(today, 10000, 10100)),
              },
            }],
          })}\n*/`),
        }),
      );

      const result = await loadAccountBalanceHistory(mockAccount, today, today);

      // Should include header + today's data
      expect(result.data).toHaveLength(2); // Header + 1 data row
      expect(result.data[0]).toEqual(['Date', 'Closing Balance', 'Account Name']); // Header

      // Today should be included in results
      expect(result.data[1]).toEqual([today, 10100, 'TEST-RRSP']);

      expect(result.totalDays).toBe(1);
      expect(result.businessDays).toBe(1);
      expect(result.apiCallsMade).toBe(1);
    });

    test('SHOULD FAIL: Two day upload should include both days in results', async () => {
      const yesterday = '2024-01-16'; // Tuesday
      const today = '2024-01-17'; // Wednesday

      let callCount = 0;

      // Mock API responses for both days
      // eslint-disable-next-line no-global-assign
      global.fetch.mockImplementation(() => {
        callCount++;
        const responseData = callCount === 1
          ? createMockBalanceResponse(yesterday, 9900, 10000)
          : createMockBalanceResponse(today, 10000, 10100);

        return Promise.resolve({
          ok: true,
          status: 200,
          headers: {
            get: jest.fn((name) => {
              if (name === 'content-type') return 'application/json';
              if (name === 'content-length') return '1000';
              return null;
            }),
            entries: jest.fn(() => [
              ['content-type', 'application/json'],
              ['content-length', '1000'],
            ]),
          },
          text: () => Promise.resolve(`/*-secure-\n${JSON.stringify({
            actions: [{
              returnValue: {
                returnValue: JSON.stringify(responseData),
              },
            }],
          })}\n*/`),
        });
      });

      const result = await loadAccountBalanceHistory(mockAccount, yesterday, today);

      // Should include header + 2 data rows
      expect(result.data).toHaveLength(3); // Header + 2 data rows
      expect(result.data[0]).toEqual(['Date', 'Closing Balance', 'Account Name']); // Header

      // Check both days are included
      const dataRows = result.data.slice(1).sort((a, b) => a[0].localeCompare(b[0]));
      expect(dataRows[0]).toEqual([yesterday, 10000, 'TEST-RRSP']);
      expect(dataRows[1]).toEqual([today, 10100, 'TEST-RRSP']);

      expect(result.totalDays).toBe(2);
    });

    test('SHOULD FAIL: Three day upload should include today as last day', async () => {
      const dayOne = '2024-01-15'; // Monday
      const today = '2024-01-17'; // Wednesday

      let callCount = 0;

      // Mock API responses - optimization should make 2 calls for 3 days
      // eslint-disable-next-line no-global-assign
      global.fetch.mockImplementation(() => {
        callCount++;
        const responseData = callCount === 1
          ? createMockBalanceResponse(dayOne, 9800, 9900) // First call gets day 1, sets up day 2
          : createMockBalanceResponse(today, 10000, 10100); // Second call gets day 3 (today)

        return Promise.resolve({
          ok: true,
          status: 200,
          headers: {
            get: jest.fn((name) => {
              if (name === 'content-type') return 'application/json';
              if (name === 'content-length') return '1000';
              return null;
            }),
            entries: jest.fn(() => [
              ['content-type', 'application/json'],
              ['content-length', '1000'],
            ]),
          },
          text: () => Promise.resolve(`/*-secure-\n${JSON.stringify({
            actions: [{
              returnValue: {
                returnValue: JSON.stringify(responseData),
              },
            }],
          })}\n*/`),
        });
      });

      const result = await loadAccountBalanceHistory(mockAccount, dayOne, today);

      // Should include header + 3 data rows
      expect(result.data).toHaveLength(4); // Header + 3 data rows

      // Check that today (last day) is included - THIS IS THE KEY TEST FOR THE BUG
      const dates = result.data.slice(1).map((row) => row[0]);
      expect(dates).toContain(today);

      expect(result.totalDays).toBe(3);
    });

    test('SHOULD FAIL: Five day upload ending on today should include today', async () => {
      const dates = ['2024-01-15', '2024-01-16', '2024-01-17', '2024-01-18', '2024-01-19']; // Mon-Fri
      const today = dates[4]; // Friday

      let callCount = 0;

      // Mock API responses - optimization should make 3 calls for 5 days (i=0,2,4)
      // eslint-disable-next-line no-global-assign
      global.fetch.mockImplementation(() => {
        callCount++;
        const balances = [9600, 9700, 9800, 9900, 10000];
        const responseData = createMockBalanceResponse(
          dates[callCount - 1],
          balances[callCount - 1] - 100,
          balances[callCount - 1],
        );

        return Promise.resolve({
          ok: true,
          status: 200,
          headers: {
            get: jest.fn((name) => {
              if (name === 'content-type') return 'application/json';
              if (name === 'content-length') return '1000';
              return null;
            }),
            entries: jest.fn(() => [
              ['content-type', 'application/json'],
              ['content-length', '1000'],
            ]),
          },
          text: () => Promise.resolve(`/*-secure-\n${JSON.stringify({
            actions: [{
              returnValue: {
                returnValue: JSON.stringify(responseData),
              },
            }],
          })}\n*/`),
        });
      });

      const result = await loadAccountBalanceHistory(mockAccount, dates[0], today);

      // Should include header + 5 data rows
      expect(result.data).toHaveLength(6); // Header + 5 data rows

      // THE CRITICAL TEST: Check that today (last day) is included
      const resultDates = result.data.slice(1).map((row) => row[0]);
      expect(resultDates).toContain(today);
      expect(resultDates.sort()).toEqual(dates);

      expect(result.totalDays).toBe(5);
    });

    test('Edge case: Odd number of business days with today as last day', async () => {
      const dates = ['2024-01-15', '2024-01-16', '2024-01-17']; // Mon, Tue, Wed
      const today = dates[2]; // Wednesday

      let callCount = 0;

      // eslint-disable-next-line no-global-assign
      global.fetch.mockImplementation(() => {
        callCount++;
        const balances = [9800, 9900, 10000];
        const responseData = createMockBalanceResponse(
          dates[callCount === 1 ? 0 : 2], // First call: day 1, second call: day 3 (today)
          balances[callCount === 1 ? 0 : 2] - 100,
          balances[callCount === 1 ? 0 : 2],
        );

        return Promise.resolve({
          ok: true,
          status: 200,
          headers: {
            get: jest.fn((name) => {
              if (name === 'content-type') return 'application/json';
              if (name === 'content-length') return '1000';
              return null;
            }),
            entries: jest.fn(() => [
              ['content-type', 'application/json'],
              ['content-length', '1000'],
            ]),
          },
          text: () => Promise.resolve(`/*-secure-\n${JSON.stringify({
            actions: [{
              returnValue: {
                returnValue: JSON.stringify(responseData),
              },
            }],
          })}\n*/`),
        });
      });

      const result = await loadAccountBalanceHistory(mockAccount, dates[0], today);

      // This is the critical test - with odd number of days, the last day logic should trigger
      const resultDates = result.data.slice(1).map((row) => row[0]);

      // THE KEY BUG TEST: Today should be included even with odd number optimization
      expect(resultDates).toContain(today);
      expect(result.totalDays).toBe(3);
    });
  });

  describe('Specific Bug Scenario - User Reported', () => {
    test('Bug fix: 2025-10-09 to 2025-10-11 range should include 2025-10-11', async () => {
      // This is the exact scenario that the user reported as failing
      const startDate = '2025-10-09'; // Wed
      const endDate = '2025-10-11'; // Fri

      let callCount = 0;

      // Mock API responses for the optimization calls
      // eslint-disable-next-line no-global-assign
      global.fetch.mockImplementation(() => {
        callCount++;
        console.log(`API Call ${callCount} - Expected for date: ${callCount === 1 ? '2025-10-09' : '2025-10-11'}`);

        // First call (i=0): processes 2025-10-09, provides opening balance for 2025-10-10
        // Second call (i=2): processes 2025-10-11 (this should happen with the fix)
        const responseData = callCount === 1
          ? createMockBalanceResponse('2025-10-09', 9900, 10000)
          : createMockBalanceResponse('2025-10-11', 10100, 10200);

        console.log(`API Call ${callCount} - Response data:`, responseData);

        return Promise.resolve({
          ok: true,
          status: 200,
          headers: {
            get: jest.fn((name) => {
              if (name === 'content-type') return 'application/json';
              if (name === 'content-length') return '1000';
              return null;
            }),
            entries: jest.fn(() => [
              ['content-type', 'application/json'],
              ['content-length', '1000'],
            ]),
          },
          text: () => Promise.resolve(`/*-secure-\n${JSON.stringify({
            actions: [{
              returnValue: {
                returnValue: JSON.stringify(responseData),
              },
            }],
          })}\n*/`),
        });
      });

      const result = await loadAccountBalanceHistory(mockAccount, startDate, endDate);

      console.log('Final result data:', result.data);
      console.log('API calls made:', callCount);

      // Should have header + 3 data rows (all business days)
      expect(result.data).toHaveLength(4);

      // Extract just the dates from results
      const resultDates = result.data.slice(1).map((row) => row[0]).sort();

      // The critical test: 2025-10-11 should be included
      expect(resultDates).toContain('2025-10-11');
      expect(resultDates).toEqual(['2025-10-09', '2025-10-10', '2025-10-11']);

      expect(result.totalDays).toBe(3);
    });
  });

  describe('Optimization Logic Analysis', () => {
    test('Should identify the problematic condition in last day processing', () => {
      // This test documents the suspected bug condition
      const businessDaysLength = 1; // Single day upload
      const lastDayProcessed = false; // Last day not processed yet

      // This is the suspected buggy condition from the code:
      // if (!lastDayProcessed && businessDays.length > 1)
      const buggyCondition = !lastDayProcessed && businessDaysLength > 1;

      // For single day uploads, this condition would be false, skipping the last day
      expect(buggyCondition).toBe(false);

      // The condition should be: if (!lastDayProcessed)
      const fixedCondition = !lastDayProcessed;
      expect(fixedCondition).toBe(true);
    });

    test('Should document the i+=2 loop behavior', () => {
      const businessDays = ['2024-01-15', '2024-01-16', '2024-01-17'];
      const processedIndices = [];

      // Simulate the i+=2 loop from the code
      for (let i = 0; i < businessDays.length; i += 2) {
        processedIndices.push(i);
      }

      // For 3 days, indices 0 and 2 are processed
      expect(processedIndices).toEqual([0, 2]);

      // Index 1 (middle day) gets processed via the opening balance logic
      // But the last day (index 2) should be processed in the loop
      // The bug might be in the last day handling when it's already been processed
    });
  });
});
