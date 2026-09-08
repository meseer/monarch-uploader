/**
 * Tests for the Monarch `Id` column value resolver
 *
 * The Id column carries the SAME string the notes already carry — Monarch's CSV
 * importer accepts an `id` column and can match on it, so promoting the existing
 * `{prefix}:{hash}` id out of the notes field is the whole point. These tests
 * pin the two properties that matter:
 *
 * 1. Source precedence favours `txHashId`, which is present on settled AND
 *    pending rows and therefore survives the pending → settled transition.
 * 2. A row with no usable id yields '' rather than a junk value — an empty Id
 *    must never look like a real match key.
 */

import { resolveMonarchTransactionId } from '../../src/core/transactionIds';

describe('resolveMonarchTransactionId', () => {
  describe('source precedence', () => {
    it('prefers txHashId, which is stable across settlement', () => {
      const result = resolveMonarchTransactionId({
        txHashId: 'rb-tx:aaaaaaaaaaaaaaaa',
        pendingId: 'rb-tx:bbbbbbbbbbbbbbbb',
        fallbackId: 'ws-tx:something',
      });

      expect(result).toBe('rb-tx:aaaaaaaaaaaaaaaa');
    });

    it('falls back to pendingId when txHashId is absent', () => {
      const result = resolveMonarchTransactionId({
        pendingId: 'mbna-tx:cccccccccccccccc',
      });

      expect(result).toBe('mbna-tx:cccccccccccccccc');
    });

    it('falls back to fallbackId last (the Wealthsimple path)', () => {
      const result = resolveMonarchTransactionId({
        fallbackId: 'ws-tx:card-activity-123-VI-00-456-ABC',
      });

      expect(result).toBe('ws-tx:card-activity-123-VI-00-456-ABC');
    });

    it('skips a null txHashId rather than treating it as a value', () => {
      const result = resolveMonarchTransactionId({
        txHashId: null,
        pendingId: 'rb-tx:dddddddddddddddd',
      });

      expect(result).toBe('rb-tx:dddddddddddddddd');
    });
  });

  describe('absent ids', () => {
    // Integrations with no stable source id must produce '' so callers can
    // detect the absence — never a placeholder that Monarch might match on.
    it('returns an empty string when no id is supplied', () => {
      expect(resolveMonarchTransactionId({})).toBe('');
    });

    it('returns an empty string when called with no arguments', () => {
      expect(resolveMonarchTransactionId()).toBe('');
    });

    it('returns an empty string when every source is null or undefined', () => {
      const result = resolveMonarchTransactionId({
        txHashId: null,
        pendingId: undefined,
        fallbackId: null,
      });

      expect(result).toBe('');
    });

    it('treats an empty string as absent and moves to the next source', () => {
      const result = resolveMonarchTransactionId({
        txHashId: '',
        pendingId: 'rb-tx:eeeeeeeeeeeeeeee',
      });

      expect(result).toBe('rb-tx:eeeeeeeeeeeeeeee');
    });

    it('treats a whitespace-only value as absent', () => {
      const result = resolveMonarchTransactionId({
        txHashId: '   ',
        pendingId: 'rb-tx:ffffffffffffffff',
      });

      expect(result).toBe('rb-tx:ffffffffffffffff');
    });

    it('returns an empty string when every source is whitespace only', () => {
      expect(resolveMonarchTransactionId({ txHashId: ' ', pendingId: '\t' })).toBe('');
    });
  });

  describe('normalization', () => {
    it('trims surrounding whitespace from the chosen id', () => {
      expect(resolveMonarchTransactionId({ txHashId: '  rb-tx:1111111111111111  ' }))
        .toBe('rb-tx:1111111111111111');
    });

    it('preserves the prefix and the id verbatim otherwise', () => {
      // The value must stay byte-identical to what the notes carry, or the two
      // correlation paths would diverge and the migration becomes unanalysable.
      const id = 'ws-tx:card-activity-00000000527000993851-VI-00-0306231535741989-QIRIAS';

      expect(resolveMonarchTransactionId({ fallbackId: id })).toBe(id);
    });

    it('ignores non-string values', () => {
      const result = resolveMonarchTransactionId({
        txHashId: 12345,
        pendingId: 'rb-tx:2222222222222222',
      });

      expect(result).toBe('rb-tx:2222222222222222');
    });
  });
});