/**
 * Tests for Wealthsimple settled-notes utilities:
 * - cleanSystemNotesFromNotes (strips the ws-tx: marker, keeps user content)
 * - updateSettledDividendNotes (pending → settled dividend phrasing)
 * - mergeSettledNotes (preserves user notes, appends settled automated block)
 */

import {
  cleanSystemNotesFromNotes,
  updateSettledDividendNotes,
  mergeSettledNotes,
} from '../../../src/services/wealthsimple/settledNotes';

describe('cleanSystemNotesFromNotes', () => {
  it('removes a bare ws-tx marker', () => {
    expect(cleanSystemNotesFromNotes('ws-tx:card-activity-abc123')).toBe('');
  });

  it('removes a prefixed ws-tx marker', () => {
    expect(cleanSystemNotesFromNotes('PURCHASE / ws-tx:card-activity-abc123')).toBe('');
  });

  it('preserves user content around the marker', () => {
    expect(cleanSystemNotesFromNotes('Gift for Anna\nws-tx:card-activity-abc123')).toBe('Gift for Anna');
  });

  it('returns empty string for null/undefined/non-string', () => {
    expect(cleanSystemNotesFromNotes(null)).toBe('');
    expect(cleanSystemNotesFromNotes(undefined)).toBe('');
    expect(cleanSystemNotesFromNotes(42)).toBe('');
  });
});

describe('updateSettledDividendNotes', () => {
  it('replaces "Upcoming dividend on" with "Dividend on"', () => {
    const result = updateSettledDividendNotes('Upcoming dividend on ZHY\nHoldings on record date: 34 shares');
    expect(result).toContain('Dividend on ZHY');
    expect(result).not.toContain('Upcoming');
  });

  it('removes the "Expected dividends" line', () => {
    const result = updateSettledDividendNotes('Upcoming dividend on ZHY\nExpected dividends: CAD$2.06\nHoldings on record date: 34 shares');
    expect(result).not.toContain('Expected dividends');
    expect(result).toContain('Holdings on record date: 34 shares');
  });
});

describe('mergeSettledNotes', () => {
  it('returns only the settled block when there are no existing notes', () => {
    const result = mergeSettledNotes({
      existingNotes: '',
      settledNotes: 'Amount: 29.29 EUR (rate: 1.610106)\nRewards: 0.94 (rate: 0.02)',
    });

    expect(result).toBe('Amount: 29.29 EUR (rate: 1.610106)\nRewards: 0.94 (rate: 0.02)');
  });

  it('preserves a user memo and appends the settled block at the end', () => {
    const result = mergeSettledNotes({
      existingNotes: 'Gift for Anna',
      settledNotes: 'Amount: 29.29 EUR (rate: 1.610106)\nRewards: 0.94 (rate: 0.02)',
    });

    expect(result).toBe(
      'Gift for Anna\n\nAmount: 29.29 EUR (rate: 1.610106)\nRewards: 0.94 (rate: 0.02)',
    );
  });

  it('preserves a multi-line user memo', () => {
    const result = mergeSettledNotes({
      existingNotes: 'Gift for Anna\nSplit with Bob',
      settledNotes: 'Amount: 29.29 EUR (rate: 1.610106)',
    });

    expect(result).toBe('Gift for Anna\nSplit with Bob\n\nAmount: 29.29 EUR (rate: 1.610106)');
  });

  it('is idempotent — does not duplicate an already-present settled block', () => {
    const settledNotes = 'Amount: 29.29 EUR (rate: 1.610106)\nRewards: 0.94 (rate: 0.02)';
    const once = mergeSettledNotes({ existingNotes: 'Gift for Anna', settledNotes });
    const twice = mergeSettledNotes({ existingNotes: once, settledNotes });

    expect(twice).toBe(once);
  });

  it('replaces a stale automated line whose values changed on settle', () => {
    const result = mergeSettledNotes({
      existingNotes: 'Limit order Buy 100 VFV @ 15.50 Limit GTC\nFilled 0 @ USD$0, fees: USD$0\nTotal USD$0',
      settledNotes: 'Limit order Buy 100 VFV @ 15.50 Limit GTC\nFilled 22 @ USD$15, fees: USD$0\nTotal USD$330',
    });

    expect(result).toBe('Limit order Buy 100 VFV @ 15.50 Limit GTC\nFilled 22 @ USD$15, fees: USD$0\nTotal USD$330');
    expect(result).not.toContain('Filled 0');
    expect(result).not.toContain('Total USD$0');
  });

  it('keeps the user memo while replacing stale automated values', () => {
    const result = mergeSettledNotes({
      existingNotes: 'Retirement top-up\nFilled 0 @ USD$0, fees: USD$0\nTotal USD$0',
      settledNotes: 'Filled 22 @ USD$15, fees: USD$0\nTotal USD$330',
    });

    expect(result).toBe('Retirement top-up\n\nFilled 22 @ USD$15, fees: USD$0\nTotal USD$330');
  });

  it('returns the existing notes unchanged when there is no settled block', () => {
    expect(mergeSettledNotes({ existingNotes: 'Gift for Anna', settledNotes: '' })).toBe('Gift for Anna');
    expect(mergeSettledNotes({ existingNotes: 'Gift for Anna', settledNotes: null })).toBe('Gift for Anna');
  });

  it('returns empty string when both inputs are empty', () => {
    expect(mergeSettledNotes({ existingNotes: '', settledNotes: '' })).toBe('');
  });

  it('collapses excess blank lines in the preserved user notes', () => {
    const result = mergeSettledNotes({
      existingNotes: 'Line one\n\n\n\nLine two',
      settledNotes: 'Amount: 10.00 USD (rate: 1.36)',
    });

    expect(result).toBe('Line one\n\nLine two\n\nAmount: 10.00 USD (rate: 1.36)');
  });

  it('ignores leading/trailing whitespace differences when matching automated lines', () => {
    const result = mergeSettledNotes({
      existingNotes: '  Amount: 29.29 EUR (rate: 1.610106)  ',
      settledNotes: 'Amount: 29.29 EUR (rate: 1.610106)',
    });

    expect(result).toBe('Amount: 29.29 EUR (rate: 1.610106)');
  });
});