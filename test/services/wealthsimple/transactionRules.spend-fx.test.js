/**
 * Tests for Wealthsimple foreign-currency (FX) spend details
 *
 * Covers: formatSpendNotes, getForeignCurrencyCode, and the spend-prepaid rule's
 * settled-only FX/reward notes and currency tag.
 */

import {
  formatSpendNotes,
  getForeignCurrencyCode,
  applyTransactionRule,
} from '../../../src/services/wealthsimple/transactionRules';

/** Settled foreign card details as produced by FetchCreditCardActivity */
const CREDIT_CARD_FX_DETAILS = {
  isForeign: true,
  originalAmount: '-29.29',
  originalCurrency: 'EUR',
  foreignAmount: -29,
  foreignCurrency: 'EUR',
  foreignExchangeRate: '1.610106',
  hasReward: true,
  rewardAmount: '0.94',
  rewardRate: '0.02',
};

/** Settled foreign spend details as produced by FetchSpendTransactions (no originalAmount) */
const SPEND_FX_DETAILS = {
  isForeign: true,
  foreignAmount: 84.28,
  foreignCurrency: 'usd',
  foreignExchangeRate: 1.3622,
  hasReward: false,
};

describe('getForeignCurrencyCode', () => {
  it('returns null for missing details', () => {
    expect(getForeignCurrencyCode(null)).toBeNull();
    expect(getForeignCurrencyCode(undefined)).toBeNull();
  });

  it('returns null when the transaction is not foreign', () => {
    expect(getForeignCurrencyCode({ isForeign: false, foreignCurrency: 'EUR' })).toBeNull();
  });

  it('returns null when isForeign is missing even if a currency is present', () => {
    expect(getForeignCurrencyCode({ foreignCurrency: 'EUR' })).toBeNull();
  });

  it('prefers originalCurrency (credit card activity) over foreignCurrency', () => {
    expect(getForeignCurrencyCode({
      isForeign: true,
      originalCurrency: 'EUR',
      foreignCurrency: 'GBP',
    })).toBe('EUR');
  });

  it('falls back to foreignCurrency (spend transactions)', () => {
    expect(getForeignCurrencyCode(SPEND_FX_DETAILS)).toBe('USD');
  });

  it('uppercases the currency code', () => {
    expect(getForeignCurrencyCode({ isForeign: true, foreignCurrency: 'eur' })).toBe('EUR');
  });

  it('returns null when foreign but no currency code is available', () => {
    expect(getForeignCurrencyCode({ isForeign: true, foreignCurrency: null })).toBeNull();
  });
});

describe('formatSpendNotes', () => {
  it('returns an empty string for missing details', () => {
    expect(formatSpendNotes(null, { isSettled: true })).toBe('');
    expect(formatSpendNotes(undefined, { isSettled: true })).toBe('');
  });

  it('returns an empty string for pending transactions (no N/A placeholders)', () => {
    const pendingDetails = {
      isForeign: true,
      foreignAmount: null,
      foreignCurrency: null,
      foreignExchangeRate: null,
      hasReward: true,
      rewardAmount: null,
    };

    expect(formatSpendNotes(pendingDetails, { isSettled: false })).toBe('');
    expect(formatSpendNotes(pendingDetails, { isSettled: false })).not.toContain('N/A');
  });

  it('returns an empty string when the settled flag is omitted entirely', () => {
    expect(formatSpendNotes(CREDIT_CARD_FX_DETAILS)).toBe('');
  });

  it('uses the precise originalAmount for a settled credit card purchase', () => {
    const notes = formatSpendNotes(CREDIT_CARD_FX_DETAILS, { isSettled: true });

    expect(notes).toContain('Amount: 29.29 EUR (rate: 1.610106)');
    // The truncated foreignAmount (-29) must NOT be used when originalAmount exists
    expect(notes).not.toContain('Amount: 29 EUR');
  });

  it('does not round the FX rate or amount', () => {
    const notes = formatSpendNotes(CREDIT_CARD_FX_DETAILS, { isSettled: true });

    expect(notes).toContain('1.610106');
    expect(notes).not.toContain('1.61 ');
  });

  it('includes the reward amount and rate as a percentage for a settled transaction', () => {
    const notes = formatSpendNotes(CREDIT_CARD_FX_DETAILS, { isSettled: true });

    expect(notes).toContain('Rewards: 0.94 (rate: 2%)');
    // The raw decimal rate must never leak into the note
    expect(notes).not.toContain('rate: 0.02');
  });

  it('formats a fractional reward rate without float artifacts', () => {
    const notes = formatSpendNotes(
      { ...CREDIT_CARD_FX_DETAILS, rewardRate: '0.0125' },
      { isSettled: true },
    );

    expect(notes).toContain('Rewards: 0.94 (rate: 1.25%)');
    expect(notes).not.toContain('1.2500000000000002');
  });

  it('accepts a numeric reward rate', () => {
    const notes = formatSpendNotes(
      { ...CREDIT_CARD_FX_DETAILS, rewardRate: 0.02 },
      { isSettled: true },
    );

    expect(notes).toContain('Rewards: 0.94 (rate: 2%)');
  });

  it('omits the reward rate when it is not a parseable number', () => {
    const notes = formatSpendNotes(
      { isForeign: false, hasReward: true, rewardAmount: '0.94', rewardRate: 'not-a-number' },
      { isSettled: true },
    );

    expect(notes).toBe('Rewards: 0.94');
    expect(notes).not.toContain('NaN');
  });

  it('places the FX line before the rewards line', () => {
    const lines = formatSpendNotes(CREDIT_CARD_FX_DETAILS, { isSettled: true }).split('\n');

    expect(lines[0]).toContain('Amount:');
    expect(lines[1]).toContain('Rewards:');
  });

  it('omits the reward rate when it is not available', () => {
    const notes = formatSpendNotes(
      { ...CREDIT_CARD_FX_DETAILS, rewardRate: null },
      { isSettled: true },
    );

    expect(notes).toContain('Rewards: 0.94');
    expect(notes).not.toContain('rate: 2%');
  });

  it('omits the rewards line entirely when hasReward is false', () => {
    const notes = formatSpendNotes(
      { ...CREDIT_CARD_FX_DETAILS, hasReward: false },
      { isSettled: true },
    );

    expect(notes).not.toContain('Rewards');
  });

  it('falls back to foreignAmount for spend transactions without originalAmount', () => {
    const notes = formatSpendNotes(SPEND_FX_DETAILS, { isSettled: true });

    expect(notes).toBe('Amount: 84.28 USD (rate: 1.3622)');
  });

  it('omits the FX line when the rate is missing rather than printing N/A', () => {
    const notes = formatSpendNotes(
      { ...CREDIT_CARD_FX_DETAILS, foreignExchangeRate: null },
      { isSettled: true },
    );

    expect(notes).not.toContain('Amount:');
    expect(notes).not.toContain('N/A');
    // The rewards line is unaffected by the missing FX rate
    expect(notes).toContain('Rewards: 0.94 (rate: 2%)');
  });

  it('omits the FX line when the amount is missing rather than printing N/A', () => {
    const notes = formatSpendNotes(
      {
        ...CREDIT_CARD_FX_DETAILS,
        originalAmount: null,
        foreignAmount: null,
        hasReward: false,
      },
      { isSettled: true },
    );

    expect(notes).toBe('');
  });

  it('omits the FX line when the currency is missing', () => {
    const notes = formatSpendNotes(
      {
        ...CREDIT_CARD_FX_DETAILS,
        originalCurrency: null,
        foreignCurrency: null,
        hasReward: false,
      },
      { isSettled: true },
    );

    expect(notes).toBe('');
  });

  it('returns an empty string for a settled domestic transaction with no rewards', () => {
    expect(formatSpendNotes({ isForeign: false, hasReward: false }, { isSettled: true })).toBe('');
  });

  it('still reports rewards for a settled domestic transaction', () => {
    const notes = formatSpendNotes(
      { isForeign: false, hasReward: true, rewardAmount: '0.25', rewardRate: '0.01' },
      { isSettled: true },
    );

    expect(notes).toBe('Rewards: 0.25 (rate: 1%)');
  });
});

describe('spend-prepaid rule - FX handling', () => {
  const buildPrepaidTransaction = (status) => ({
    externalCanonicalId: 'spend-tx-1',
    type: 'SPEND',
    subType: 'PREPAID',
    status,
    spendMerchant: 'CAFE BERLIN',
    amount: 40.5,
    amountSign: 'negative',
  });

  it('adds FX notes and the currency tag for a settled foreign purchase', () => {
    const enrichmentMap = new Map([['spend:spend-tx-1', SPEND_FX_DETAILS]]);

    const result = applyTransactionRule(buildPrepaidTransaction('settled'), enrichmentMap);

    expect(result.ruleId).toBe('spend-prepaid');
    expect(result.notes).toBe('Amount: 84.28 USD (rate: 1.3622)');
    expect(result.foreignCurrency).toBe('USD');
  });

  it('adds no notes and no currency tag while the purchase is pending', () => {
    // This is the exact shape Wealthsimple returns for a pending foreign purchase
    const pendingDetails = {
      isForeign: true,
      foreignAmount: null,
      foreignCurrency: null,
      foreignExchangeRate: null,
      hasReward: false,
    };
    const enrichmentMap = new Map([['spend:spend-tx-1', pendingDetails]]);

    const result = applyTransactionRule(buildPrepaidTransaction('authorized'), enrichmentMap);

    expect(result.notes).toBe('');
    expect(result.foreignCurrency).toBeNull();
  });

  it('does not set a currency tag for a settled domestic purchase', () => {
    const enrichmentMap = new Map([['spend:spend-tx-1', { isForeign: false, hasReward: false }]]);

    const result = applyTransactionRule(buildPrepaidTransaction('settled'), enrichmentMap);

    expect(result.notes).toBe('');
    expect(result.foreignCurrency).toBeNull();
  });

  it('handles a missing enrichment entry without failing', () => {
    const result = applyTransactionRule(buildPrepaidTransaction('settled'), new Map());

    expect(result.notes).toBe('');
    expect(result.foreignCurrency).toBeNull();
  });
});