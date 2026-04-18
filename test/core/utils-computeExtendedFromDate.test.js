/**
 * Tests for computeExtendedFromDate utility
 */

import { computeExtendedFromDate, formatDate } from '../../src/core/utils';

jest.mock('../../src/core/storageAdapter', () => ({
  getValue: jest.fn(),
  setValue: jest.fn(),
  deleteValue: jest.fn(),
}));

describe('computeExtendedFromDate', () => {
  it('returns currentFromDate when oldestPendingDate is null', () => {
    expect(computeExtendedFromDate('2024-04-10', null, 91)).toBe('2024-04-10');
  });

  it('returns currentFromDate when oldestPendingDate is after currentFromDate', () => {
    expect(computeExtendedFromDate('2024-04-01', '2024-04-05', 91)).toBe('2024-04-01');
  });

  it('returns currentFromDate when oldestPendingDate equals currentFromDate', () => {
    expect(computeExtendedFromDate('2024-04-01', '2024-04-01', 91)).toBe('2024-04-01');
  });

  it('extends to oldestPendingDate when it is before currentFromDate and within retention', () => {
    // oldestPendingDate is before currentFromDate but well within 91-day retention
    const today = new Date();
    const thirtyDaysAgo = new Date(today);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const tenDaysAgo = new Date(today);
    tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);

    const result = computeExtendedFromDate(
      formatDate(tenDaysAgo),
      formatDate(thirtyDaysAgo),
      91,
    );

    expect(result).toBe(formatDate(thirtyDaysAgo));
  });

  it('clamps to retention floor when oldestPendingDate exceeds retention', () => {
    const today = new Date();
    const hundredDaysAgo = new Date(today);
    hundredDaysAgo.setDate(hundredDaysAgo.getDate() - 100);
    const tenDaysAgo = new Date(today);
    tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);
    const ninetyOneDaysAgo = new Date(today);
    ninetyOneDaysAgo.setDate(ninetyOneDaysAgo.getDate() - 91);

    const result = computeExtendedFromDate(
      formatDate(tenDaysAgo),
      formatDate(hundredDaysAgo),
      91,
    );

    // Should be clamped to 91 days ago (the retention floor)
    expect(result).toBe(formatDate(ninetyOneDaysAgo));
  });

  it('does not clamp when retentionDays is 0 (unlimited)', () => {
    const today = new Date();
    const twoHundredDaysAgo = new Date(today);
    twoHundredDaysAgo.setDate(twoHundredDaysAgo.getDate() - 200);
    const tenDaysAgo = new Date(today);
    tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);

    const result = computeExtendedFromDate(
      formatDate(tenDaysAgo),
      formatDate(twoHundredDaysAgo),
      0,
    );

    expect(result).toBe(formatDate(twoHundredDaysAgo));
  });
});