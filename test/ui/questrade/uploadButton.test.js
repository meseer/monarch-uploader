/**
 * Tests for calculateSingleAccountStartDate in uploadButton.ts
 * Verifies that single account sync uses the same date logic as all-accounts sync:
 * - Subsequent sync: last sync date minus lookback period
 * - First sync: account creation date
 * - Fallback: 2 weeks ago
 */

import { calculateSingleAccountStartDate } from '../../../src/ui/questrade/components/uploadButton';
import * as utilsModule from '../../../src/core/utils';
import * as balanceModule from '../../../src/services/questrade/balance';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('../../../src/core/utils', () => ({
  debugLog: vi.fn(),
  calculateFromDateWithLookback: vi.fn(),
  getTodayLocal: vi.fn(() => '2025-04-29'),
  formatDate: vi.fn((date) => {
    const d = new Date(date);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }),
}));

vi.mock('../../../src/core/config', () => ({
  STORAGE: {
    MONARCH_CSRF_TOKEN: 'monarch_csrf_token', MONARCH_SESSION_EXPIRES_AT: 'monarch_session_expires_at',
    DEVELOPMENT_MODE: 'development_mode',
  },
}));

vi.mock('../../../src/core/state', () => ({
  __esModule: true,
  default: {
    getState: vi.fn(() => ({
      currentAccount: { id: null, nickname: 'unknown' },
    })),
  },
}));

vi.mock('../../../src/ui/toast', () => ({
  __esModule: true,
  default: { show: vi.fn() },
}));

vi.mock('../../../src/services/questrade/account', () => ({
  processAccountBalanceHistory: vi.fn(),
}));

vi.mock('../../../src/ui/components/monarchLoginLink', () => ({
  ensureMonarchAuthentication: vi.fn(),
}));

vi.mock('../../../src/services/questrade/sync', () => ({
  syncAllAccountsToMonarch: vi.fn(),
}));

vi.mock('../../../src/services/questrade/transactions', () => ({
  uploadAllAccountsActivityToMonarch: vi.fn(),
  uploadSingleAccountActivityToMonarch: vi.fn(),
}));

vi.mock('../../../src/services/questrade/balance', () => ({
  getAccountCreationDate: vi.fn(),
  uploadFullBalanceHistoryForAccount: vi.fn(),
  uploadFullBalanceHistoryForAllAccounts: vi.fn(),
}));

vi.mock('../../../src/ui/components/datePicker', () => ({
  showDatePickerPromise: vi.fn(),
}));

// ── GM globals ────────────────────────────────────────────────────────────────

globalThis.GM_getValue = vi.fn(() => null);
globalThis.GM_setValue = vi.fn();

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('calculateSingleAccountStartDate', () => {
  const { calculateFromDateWithLookback } = utilsModule;
  const { getAccountCreationDate } = balanceModule;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('subsequent sync (has last sync date)', () => {
    test('returns lookback date when calculateFromDateWithLookback returns a valid date', () => {
      calculateFromDateWithLookback.mockReturnValue('2025-04-25');

      const result = calculateSingleAccountStartDate('acc123');

      expect(result).toBe('2025-04-25');
      expect(calculateFromDateWithLookback).toHaveBeenCalledWith('questrade', 'acc123');
      // Should not fall through to getAccountCreationDate
      expect(getAccountCreationDate).not.toHaveBeenCalled();
    });

    test('uses lookback date even when creation date is also available', () => {
      calculateFromDateWithLookback.mockReturnValue('2025-04-20');
      getAccountCreationDate.mockReturnValue('2022-01-15');

      const result = calculateSingleAccountStartDate('acc456');

      expect(result).toBe('2025-04-20');
      expect(getAccountCreationDate).not.toHaveBeenCalled();
    });
  });

  describe('first sync (no last sync date, has creation date)', () => {
    test('returns account creation date when no lookback date available', () => {
      calculateFromDateWithLookback.mockReturnValue(null);
      getAccountCreationDate.mockReturnValue('2022-03-10');

      const result = calculateSingleAccountStartDate('acc789');

      expect(result).toBe('2022-03-10');
      expect(calculateFromDateWithLookback).toHaveBeenCalledWith('questrade', 'acc789');
      expect(getAccountCreationDate).toHaveBeenCalledWith('acc789');
    });

    test('returns creation date when lookback returns empty string', () => {
      calculateFromDateWithLookback.mockReturnValue('');
      getAccountCreationDate.mockReturnValue('2021-06-01');

      const result = calculateSingleAccountStartDate('acc101');

      expect(result).toBe('2021-06-01');
    });
  });

  describe('first sync (no last sync date, no creation date)', () => {
    test('returns fallback date (2 weeks ago) when no dates available', () => {
      calculateFromDateWithLookback.mockReturnValue(null);
      getAccountCreationDate.mockReturnValue(null);

      // Mock Date.now to get predictable fallback
      const mockNow = new Date('2025-04-29T12:00:00Z').getTime();
      vi.spyOn(Date, 'now').mockReturnValue(mockNow);

      const result = calculateSingleAccountStartDate('accXYZ');

      // 12096e5 ms = 14 days, so 2025-04-29 - 14 days = 2025-04-15
      expect(result).toBe('2025-04-15');
      expect(calculateFromDateWithLookback).toHaveBeenCalledWith('questrade', 'accXYZ');
      expect(getAccountCreationDate).toHaveBeenCalledWith('accXYZ');

      vi.spyOn(Date, 'now').mockRestore();
    });

    test('returns fallback when creation date is invalid format', () => {
      calculateFromDateWithLookback.mockReturnValue(null);
      getAccountCreationDate.mockReturnValue('invalid-date');

      const mockNow = new Date('2025-04-29T12:00:00Z').getTime();
      vi.spyOn(Date, 'now').mockReturnValue(mockNow);

      const result = calculateSingleAccountStartDate('accBad');

      // Should fall through to the fallback
      expect(result).toBe('2025-04-15');

      vi.spyOn(Date, 'now').mockRestore();
    });
  });

  describe('edge cases', () => {
    test('rejects lookback date with invalid format', () => {
      calculateFromDateWithLookback.mockReturnValue('2025/04/25'); // wrong format
      getAccountCreationDate.mockReturnValue('2022-01-01');

      const result = calculateSingleAccountStartDate('accEdge');

      // Should not use the invalid format, falls through to creation date
      expect(result).toBe('2022-01-01');
    });

    test('rejects creation date with invalid format', () => {
      calculateFromDateWithLookback.mockReturnValue(null);
      getAccountCreationDate.mockReturnValue('March 10, 2022'); // wrong format

      const mockNow = new Date('2025-04-29T12:00:00Z').getTime();
      vi.spyOn(Date, 'now').mockReturnValue(mockNow);

      const result = calculateSingleAccountStartDate('accEdge2');

      expect(result).toBe('2025-04-15');

      vi.spyOn(Date, 'now').mockRestore();
    });
  });
});