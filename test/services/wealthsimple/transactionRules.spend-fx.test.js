/**
 * Tests for Wealthsimple foreign-currency (FX) spend details
 *
 * Covers: formatSpendNotes, getForeignCurrencyCode, and the spend-prepaid rule's
 * data-driven FX/reward notes and currency tag (emitted at pending state too,
 * whenever Wealthsimple has already populated the values).
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

/**
 * A pending foreign card authorization that Wealthsimple has NOT yet enriched.
 * All FX values are null, so no note can be built.
 */
const PENDING_FX_DETAILS_EMPTY = {
  isForeign: true,
  originalAmount: null,
  originalCurrency: null,
  foreignAmount: null,
  foreignCurrency: null,
  foreignExchangeRate: null,
  hasReward: false,
};

/**
 * A pending foreign card authorization that Wealthsimple HAS already enriched.
 * This shape does occur in practice, which is why notes are data-driven rather
 * than gated on settlement status.
 */
const PENDING_FX_DETAILS_POPULATED = {
  isForeign: true,
  originalAmount: '-29.29',
  originalCurrency: 'EUR',
  foreignExchangeRate: '1.610106',
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
    expect(formatSpendNotes(null)).toBe('');
    expect(formatSpendNotes(undefined)).toBe('');
  });

  it('returns an empty string when a pending transaction has no FX data yet (no N/A placeholders)', () => {
    const pendingDetails = { ...PENDING_FX_DETAILS_EMPTY, hasReward: true, rewardAmount: null };

    expect(formatSpendNotes(pendingDetails)).toBe('');
    expect(formatSpendNotes(pendingDetails)).not.toContain('N/A');
  });

  it('builds the FX note for a pending transaction that already carries FX data', () => {
    // Wealthsimple populates these fields for some authorizations before they
    // settle — the note must not be withheld in that case.
    expect(formatSpendNotes(PENDING_FX_DETAILS_POPULATED)).toBe('Amount: 29.29 EUR (rate: 1.610106)');
  });

  it('uses the precise originalAmount for a credit card purchase', () => {
    const notes = formatSpendNotes(CREDIT_CARD_FX_DETAILS);

    expect(notes).toContain('Amount: 29.29 EUR (rate: 1.610106)');
    // The truncated foreignAmount (-29) must NOT be used when originalAmount exists
    expect(notes).not.toContain('Amount: 29 EUR');
  });

  it('does not round the FX rate or amount', () => {
    const notes = formatSpendNotes(CREDIT_CARD_FX_DETAILS);

    expect(notes).toContain('1.610106');
    expect(notes).not.toContain('1.61 ');
  });

  it('includes the reward amount and rate as a percentage', () => {
    const notes = formatSpendNotes(CREDIT_CARD_FX_DETAILS);

    expect(notes).toContain('Rewards: 0.94 (rate: 2%)');
    // The raw decimal rate must never leak into the note
    expect(notes).not.toContain('rate: 0.02');
  });

  it('formats a fractional reward rate without float artifacts', () => {
    const notes = formatSpendNotes({ ...CREDIT_CARD_FX_DETAILS, rewardRate: '0.0125' });

    expect(notes).toContain('Rewards: 0.94 (rate: 1.25%)');
    expect(notes).not.toContain('1.2500000000000002');
  });

  it('accepts a numeric reward rate', () => {
    const notes = formatSpendNotes({ ...CREDIT_CARD_FX_DETAILS, rewardRate: 0.02 });

    expect(notes).toContain('Rewards: 0.94 (rate: 2%)');
  });

  it('omits the reward rate when it is not a parseable number', () => {
    const notes = formatSpendNotes(
      { isForeign: false, hasReward: true, rewardAmount: '0.94', rewardRate: 'not-a-number' },
    );

    expect(notes).toBe('Rewards: 0.94');
    expect(notes).not.toContain('NaN');
  });

  it('places the FX line before the rewards line', () => {
    const lines = formatSpendNotes(CREDIT_CARD_FX_DETAILS).split('\n');

    expect(lines[0]).toContain('Amount:');
    expect(lines[1]).toContain('Rewards:');
  });

  it('omits the reward rate when it is not available', () => {
    const notes = formatSpendNotes({ ...CREDIT_CARD_FX_DETAILS, rewardRate: null });

    expect(notes).toContain('Rewards: 0.94');
    expect(notes).not.toContain('rate: 2%');
  });

  it('omits the rewards line entirely when hasReward is false', () => {
    const notes = formatSpendNotes({ ...CREDIT_CARD_FX_DETAILS, hasReward: false });

    expect(notes).not.toContain('Rewards');
  });

  it('falls back to foreignAmount for spend transactions without originalAmount', () => {
    const notes = formatSpendNotes(SPEND_FX_DETAILS);

    expect(notes).toBe('Amount: 84.28 USD (rate: 1.3622)');
  });

  it('omits the FX line when the rate is missing rather than printing N/A', () => {
    const notes = formatSpendNotes({ ...CREDIT_CARD_FX_DETAILS, foreignExchangeRate: null });

    expect(notes).not.toContain('Amount:');
    expect(notes).not.toContain('N/A');
    // The rewards line is unaffected by the missing FX rate
    expect(notes).toContain('Rewards: 0.94 (rate: 2%)');
  });

  it('omits the FX line when the amount is missing rather than printing N/A', () => {
    const notes = formatSpendNotes({
      ...CREDIT_CARD_FX_DETAILS,
      originalAmount: null,
      foreignAmount: null,
      hasReward: false,
    });

    expect(notes).toBe('');
  });

  it('omits the FX line when the currency is missing', () => {
    const notes = formatSpendNotes({
      ...CREDIT_CARD_FX_DETAILS,
      originalCurrency: null,
      foreignCurrency: null,
      hasReward: false,
    });

    expect(notes).toBe('');
  });

  it('returns an empty string for a domestic transaction with no rewards', () => {
    expect(formatSpendNotes({ isForeign: false, hasReward: false })).toBe('');
  });

  it('still reports rewards for a domestic transaction', () => {
    const notes = formatSpendNotes(
      { isForeign: false, hasReward: true, rewardAmount: '0.25', rewardRate: '0.01' },
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

  it('adds no notes and no currency tag while pending when WS has no FX data yet', () => {
    const enrichmentMap = new Map([['spend:spend-tx-1', PENDING_FX_DETAILS_EMPTY]]);

    const result = applyTransactionRule(buildPrepaidTransaction('authorized'), enrichmentMap);

    expect(result.notes).toBe('');
    expect(result.foreignCurrency).toBeNull();
  });

  it('adds FX notes and the currency tag while pending when WS already has FX data', () => {
    const enrichmentMap = new Map([['spend:spend-tx-1', PENDING_FX_DETAILS_POPULATED]]);

    const result = applyTransactionRule(buildPrepaidTransaction('authorized'), enrichmentMap);

    expect(result.notes).toBe('Amount: 29.29 EUR (rate: 1.610106)');
    expect(result.foreignCurrency).toBe('EUR');
  });

  it('sets the currency tag while pending even when the FX rate is still missing', () => {
    // The currency is known as soon as isForeign + a currency code are present,
    // independently of whether the rate (and therefore the note) is available.
    const enrichmentMap = new Map([['spend:spend-tx-1', {
      isForeign: true,
      originalCurrency: 'EUR',
      foreignExchangeRate: null,
      hasReward: false,
    }]]);

    const result = applyTransactionRule(buildPrepaidTransaction('authorized'), enrichmentMap);

    expect(result.notes).toBe('');
    expect(result.foreignCurrency).toBe('EUR');
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