/**
 * Test for Canada Life lookback calculation bug
 * This test demonstrates the specific bug reported by the user
 */

import {
  calculateFromDateWithLookback,
  saveLastUploadDate,
  formatDaysBeforeDate,
  getDefaultLookbackDays,
} from '../../src/core/utils';

// Mock GM functions
global.GM_getValue = jest.fn();
global.GM_setValue = jest.fn();

// Mock toast
jest.mock('../../src/ui/toast', () => ({
  show: jest.fn(),
}));

// Mock accountService for consolidated storage reads
jest.mock('../../src/services/common/accountService', () => ({
  __esModule: true,
  default: {
    getAccountData: jest.fn(() => null),
    updateAccountInList: jest.fn(() => false),
  },
}));

// Mock configStore for getLookbackForInstitution
jest.mock('../../src/services/common/configStore', () => ({
  getSetting: jest.fn(() => undefined),
  setSetting: jest.fn(),
}));

describe('Canada Life Lookback Bug', () => {
  let accountService;

  beforeEach(() => {
    jest.clearAllMocks();
    accountService = require('../../src/services/common/accountService').default;
  });

  test('Canada Life uses consolidated storage only - no legacy keys written', () => {
    const accountId = 'test-account-123';
    const yesterday = '2024-10-10'; // Thursday

    // Canada Life has completed migration to consolidated storage
    // saveLastUploadDate should NOT write to legacy keys for canadalife
    saveLastUploadDate(accountId, yesterday, 'canadalife');

    // Verify that NO legacy key was written (uses consolidated storage via accountService)
    expect(GM_setValue).not.toHaveBeenCalled();

    // Mock consolidated storage to return the last sync date
    accountService.getAccountData.mockReturnValue({
      lastSyncDate: yesterday,
    });

    // Mock lookback via legacy key (migrate-on-read will handle this)
    GM_getValue.mockImplementation((key, defaultValue) => {
      if (key === 'canadalife_lookback_days') {
        return 1; // Default lookback for Canada Life
      }
      return defaultValue;
    });

    const fromDate = calculateFromDateWithLookback('canadalife', accountId);

    // With 1 day lookback: yesterday - 1 = day before yesterday
    const expectedFromDate = '2024-10-09';
    expect(fromDate).toBe(expectedFromDate);
  });

  test('Shows the correct behavior should be', () => {
    const accountId = 'test-account-123';
    const today = '2024-10-11';
    const yesterday = '2024-10-10';

    // Mock consolidated storage with today as last sync date
    accountService.getAccountData.mockReturnValue({
      lastSyncDate: today,
    });

    GM_getValue.mockImplementation((key, defaultValue) => {
      if (key === 'canadalife_lookback_days') {
        return 1; // Default lookback for Canada Life
      }
      return defaultValue;
    });

    const fromDate = calculateFromDateWithLookback('canadalife', accountId);

    // With today as last upload and 1 day lookback: today - 1 = yesterday
    // This would give us range: yesterday to today (inclusive)
    // Which includes today's balance correctly
    expect(fromDate).toBe(yesterday);
  });

  test('Demonstrates the formatDaysBeforeDate logic', () => {
    const yesterday = '2024-10-10';
    const lookbackDays = getDefaultLookbackDays('canadalife');

    expect(lookbackDays).toBe(1);

    // This is the calculation that creates the bug
    const calculatedFromDate = formatDaysBeforeDate(yesterday, lookbackDays);

    // yesterday - 1 day = day before yesterday
    expect(calculatedFromDate).toBe('2024-10-09');

    // This creates a gap because:
    // - We uploaded data UP TO today (2024-10-11)
    // - We stored yesterday (2024-10-10) as last upload
    // - Next upload starts from day before yesterday (2024-10-09)
    // - This means we're re-uploading 2024-10-10 data and missing 2024-10-11
  });

  test('Shows the fix: adjust lookback or storage logic', () => {
    const accountId = 'test-account-123';
    const today = '2024-10-11';
    const yesterday = '2024-10-10';

    // Option 1: Store today as last upload when uploading today's data
    saveLastUploadDate(accountId, today, 'canadalife'); // Store today instead of yesterday

    // Mock consolidated storage returning today
    accountService.getAccountData.mockReturnValue({
      lastSyncDate: today,
    });

    GM_getValue.mockImplementation((key, defaultValue) => {
      if (key === 'canadalife_lookback_days') {
        return 1;
      }
      return defaultValue;
    });

    const fromDateOption1 = calculateFromDateWithLookback('canadalife', accountId);
    expect(fromDateOption1).toBe(yesterday); // today - 1 = yesterday

    // Option 2: Use 0 lookback for Canada Life (like Questrade)
    accountService.getAccountData.mockReturnValue({
      lastSyncDate: yesterday,
    });

    // Mock configStore to return 0 lookback days (configStore is the authoritative source)
    const configStore = require('../../src/services/common/configStore');
    configStore.getSetting.mockReturnValue(0);

    const fromDateOption2 = calculateFromDateWithLookback('canadalife', accountId);
    expect(fromDateOption2).toBe(yesterday); // yesterday - 0 = yesterday

    // Both options result in correct range: yesterday to today (inclusive)
  });
});