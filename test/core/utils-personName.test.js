/**
 * Tests for person-name helpers used by cardholder mapping
 *
 * `normalizePersonName` powers matching institution cardholder names against
 * Monarch household members; `toTitleCase` produces the human-friendly label
 * used as a Monarch tag.
 */

import { normalizePersonName, toTitleCase } from '../../src/core/utils';

describe('normalizePersonName', () => {
  it('lowercases and trims', () => {
    expect(normalizePersonName('  MYKHAILO DELEGAN  ')).toBe('mykhailo delegan');
  });

  it('collapses runs of whitespace to a single space', () => {
    expect(normalizePersonName('MYKHAILO   DELEGAN')).toBe('mykhailo delegan');
  });

  it('normalizes tabs and newlines', () => {
    expect(normalizePersonName('MYKHAILO\tDELEGAN')).toBe('mykhailo delegan');
  });

  it('produces equal output for differently-cased forms of the same name', () => {
    expect(normalizePersonName('MYKHAILO DELEGAN')).toBe(normalizePersonName('Mykhailo Delegan'));
  });

  it('preserves hyphens and apostrophes', () => {
    expect(normalizePersonName("JEAN-LUC O'BRIEN")).toBe("jean-luc o'brien");
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty string', ''],
    ['a number', 12345],
    ['an object', {}],
  ])('returns an empty string for %s', (_label, value) => {
    expect(normalizePersonName(value)).toBe('');
  });
});

describe('toTitleCase', () => {
  it('title-cases an all-uppercase name', () => {
    expect(toTitleCase('MYKHAILO DELEGAN')).toBe('Mykhailo Delegan');
  });

  it('title-cases an all-lowercase name', () => {
    expect(toTitleCase('mykhailo delegan')).toBe('Mykhailo Delegan');
  });

  it('handles hyphenated names', () => {
    expect(toTitleCase('JEAN-LUC PICARD')).toBe('Jean-Luc Picard');
  });

  it('handles apostrophes', () => {
    expect(toTitleCase("O'BRIEN")).toBe("O'Brien");
  });

  it('handles a combination of hyphen and apostrophe', () => {
    expect(toTitleCase("MARY-JANE O'CONNOR")).toBe("Mary-Jane O'Connor");
  });

  it('keeps single-letter initials as-is', () => {
    expect(toTitleCase('MYKHAILO D')).toBe('Mykhailo D');
  });

  it('collapses irregular whitespace', () => {
    expect(toTitleCase('MYKHAILO    DELEGAN')).toBe('Mykhailo Delegan');
  });

  it('trims surrounding whitespace', () => {
    expect(toTitleCase('  MYKHAILO DELEGAN  ')).toBe('Mykhailo Delegan');
  });

  it('leaves intentional mixed casing untouched', () => {
    // Re-casing would turn "McDonald" into "Mcdonald", which is worse than
    // leaving an already human-formatted name alone.
    expect(toTitleCase('Ronald McDonald')).toBe('Ronald McDonald');
  });

  it('leaves an already title-cased name unchanged', () => {
    expect(toTitleCase('Mykhailo Delegan')).toBe('Mykhailo Delegan');
  });

  it('handles a single-word uppercase name', () => {
    expect(toTitleCase('MYKHAILO')).toBe('Mykhailo');
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty string', ''],
    ['whitespace only', '   '],
    ['a number', 12345],
  ])('returns an empty string for %s', (_label, value) => {
    expect(toTitleCase(value)).toBe('');
  });
});