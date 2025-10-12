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

describe('Canada Life Lookback Bug', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('DEMONSTRATES BUG: Auto upload at 1 PM creates gap in next upload', () => {
    const accountId = 'test-account-123';
    const yesterday = '2024-10-10'; // Thursday

    // Step 1: User uploads at 1 PM today, system stores yesterday as last upload
    // This simulates the behavior in uploadSingleAccount when isAutoUpload = true
    saveLastUploadDate(accountId, yesterday, 'canadalife');
    expect(GM_setValue).toHaveBeenCalledWith(
      'canadalife_last_upload_date_test-account-123',
      yesterday,
    );

    // Step 2: Next time user uploads, system calculates start date
    // Mock GM_getValue to return the stored date for the last upload date lookup
    GM_getValue.mockImplementation((key, defaultValue) => {
      if (key === 'canadalife_last_upload_date_test-account-123') {
        return yesterday;
      }
      if (key === 'canadalife_lookback_days') {
        return 1; // Default lookback for Canada Life
      }
      return defaultValue;
    });

    const fromDate = calculateFromDateWithLookback('canadalife', accountId);

    // Step 3: The bug - this creates a gap!
    // Expected behavior: Should start from today (2024-10-11) to include today's balance
    // Actual buggy behavior: Starts from day before yesterday, excluding today
    const expectedBuggyFromDate = '2024-10-09'; // yesterday - 1 day lookback = day before yesterday

    // This assertion shows the current buggy behavior
    expect(fromDate).toBe(expectedBuggyFromDate);

    // Demonstrate the gap: if uploading "from 2024-10-09 to today",
    // the range would be 2024-10-09, 2024-10-10, 2024-10-11
    // But we already uploaded 2024-10-10, and we want to include today (2024-10-11)
    // So we're missing today's data and including old data we already have!
  });

  test('Shows the correct behavior should be', () => {
    const accountId = 'test-account-123';
    const today = '2024-10-11';
    const yesterday = '2024-10-10';

    // If we stored today as the last upload date (which would be correct)
    GM_getValue.mockImplementation((key, defaultValue) => {
      if (key === 'canadalife_last_upload_date_test-account-123') {
        return today;
      }
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
    GM_setValue.mockImplementation(() => {});
    saveLastUploadDate(accountId, today, 'canadalife'); // Store today instead of yesterday

    GM_getValue.mockImplementation((key, defaultValue) => {
      if (key === 'canadalife_last_upload_date_test-account-123') {
        return today;
      }
      if (key === 'canadalife_lookback_days') {
        return 1;
      }
      return defaultValue;
    });

    const fromDateOption1 = calculateFromDateWithLookback('canadalife', accountId);
    expect(fromDateOption1).toBe(yesterday); // today - 1 = yesterday

    // Option 2: Use 0 lookback for Canada Life (like Questrade)
    GM_getValue.mockImplementation((key, defaultValue) => {
      if (key === 'canadalife_last_upload_date_test-account-123') {
        return yesterday; // Still stored yesterday
      }
      if (key === 'canadalife_lookback_days') {
        return 0; // Zero lookback
      }
      return defaultValue;
    });

    const fromDateOption2 = calculateFromDateWithLookback('canadalife', accountId);
    expect(fromDateOption2).toBe(yesterday); // yesterday - 0 = yesterday

    // Both options result in correct range: yesterday to today (inclusive)
  });
});
