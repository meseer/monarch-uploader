/**
 * Tests for the shared category selection helper.
 *
 * Covers getAssignmentType, handleCategorySelection (rule vs once, skip, skipAll),
 * and resolveFromSession (once > rule precedence, fallthrough).
 */

import {
  getAssignmentType,
  handleCategorySelection,
  resolveFromSession,
} from '../../../src/services/common/categorySelection';

// Silence debug logging
jest.mock('../../../src/core/utils', () => ({
  debugLog: jest.fn(),
}));

describe('categorySelection helper', () => {
  describe('getAssignmentType', () => {
    it('returns explicit "rule"', () => {
      expect(getAssignmentType({ assignmentType: 'rule' })).toBe('rule');
    });

    it('returns explicit "once"', () => {
      expect(getAssignmentType({ assignmentType: 'once' })).toBe('once');
    });

    it('returns "once" when rememberMapping is explicitly false', () => {
      expect(getAssignmentType({ rememberMapping: false })).toBe('once');
    });

    it('defaults to "rule" when no signal present', () => {
      expect(getAssignmentType({})).toBe('rule');
    });

    it('prefers explicit assignmentType over rememberMapping', () => {
      expect(getAssignmentType({ assignmentType: 'once', rememberMapping: true })).toBe('once');
    });
  });

  describe('handleCategorySelection', () => {
    let sessionMappings;
    let oneTimeAssignments;
    let persist;

    beforeEach(() => {
      sessionMappings = new Map();
      oneTimeAssignments = new Map();
      persist = jest.fn();
    });

    it('persists a rule and records it in sessionMappings', () => {
      const outcome = handleCategorySelection({
        sourceKey: 'AMAZON',
        selection: { name: 'Shopping', assignmentType: 'rule' },
        sessionMappings,
        oneTimeAssignments,
        persist,
      });

      expect(outcome).toEqual({ assigned: 'Shopping', persisted: true });
      expect(persist).toHaveBeenCalledWith('AMAZON', 'Shopping');
      expect(sessionMappings.get('AMAZON')).toBe('Shopping');
      expect(oneTimeAssignments.size).toBe(0);
    });

    it('uses persistKey (original casing) when persisting a rule', () => {
      handleCategorySelection({
        sourceKey: 'AMAZON',
        persistKey: 'Amazon',
        selection: { name: 'Shopping', assignmentType: 'rule' },
        sessionMappings,
        oneTimeAssignments,
        persist,
      });

      expect(persist).toHaveBeenCalledWith('Amazon', 'Shopping');
      // Session map still keyed by normalized sourceKey
      expect(sessionMappings.get('AMAZON')).toBe('Shopping');
    });

    it('records a one-time assignment WITHOUT persisting', () => {
      const outcome = handleCategorySelection({
        sourceKey: 'AMAZON',
        selection: { name: 'Food', assignmentType: 'once' },
        sessionMappings,
        oneTimeAssignments,
        persist,
      });

      expect(outcome).toEqual({ assigned: 'Food', persisted: false });
      expect(persist).not.toHaveBeenCalled();
      expect(oneTimeAssignments.get('AMAZON')).toBe('Food');
      expect(sessionMappings.size).toBe(0);
    });

    it('treats rememberMapping=false as one-time (no persistence)', () => {
      const outcome = handleCategorySelection({
        sourceKey: 'AMAZON',
        selection: { name: 'Food', rememberMapping: false },
        sessionMappings,
        oneTimeAssignments,
        persist,
      });

      expect(outcome.persisted).toBe(false);
      expect(persist).not.toHaveBeenCalled();
      expect(oneTimeAssignments.get('AMAZON')).toBe('Food');
    });

    it('returns skipAll passthrough and does not persist', () => {
      const outcome = handleCategorySelection({
        sourceKey: 'AMAZON',
        selection: { skipAll: true },
        sessionMappings,
        oneTimeAssignments,
        persist,
      });

      expect(outcome).toEqual({ skipAll: true });
      expect(persist).not.toHaveBeenCalled();
      expect(sessionMappings.size).toBe(0);
      expect(oneTimeAssignments.size).toBe(0);
    });

    it('returns skipped passthrough and does not persist', () => {
      const outcome = handleCategorySelection({
        sourceKey: 'AMAZON',
        selection: { skipped: true },
        sessionMappings,
        oneTimeAssignments,
        persist,
      });

      expect(outcome).toEqual({ skipped: true });
      expect(persist).not.toHaveBeenCalled();
    });

    it('treats a selection with no name as skipped', () => {
      const outcome = handleCategorySelection({
        sourceKey: 'AMAZON',
        selection: { assignmentType: 'rule' },
        sessionMappings,
        oneTimeAssignments,
        persist,
      });

      expect(outcome).toEqual({ skipped: true });
      expect(persist).not.toHaveBeenCalled();
    });

    it('prioritizes skipAll over skipped', () => {
      const outcome = handleCategorySelection({
        sourceKey: 'AMAZON',
        selection: { skipAll: true, skipped: true },
        sessionMappings,
        oneTimeAssignments,
        persist,
      });

      expect(outcome).toEqual({ skipAll: true });
    });
  });

  describe('resolveFromSession', () => {
    it('returns one-time assignment when present', () => {
      const oneTimeAssignments = new Map([['AMAZON', 'Food']]);
      const sessionMappings = new Map();
      const result = resolveFromSession({ sourceKey: 'AMAZON', oneTimeAssignments, sessionMappings });
      expect(result).toBe('Food');
    });

    it('returns rule mapping when no one-time assignment', () => {
      const oneTimeAssignments = new Map();
      const sessionMappings = new Map([['AMAZON', 'Shopping']]);
      const result = resolveFromSession({ sourceKey: 'AMAZON', oneTimeAssignments, sessionMappings });
      expect(result).toBe('Shopping');
    });

    it('prefers one-time assignment over rule mapping (once > rule)', () => {
      const oneTimeAssignments = new Map([['AMAZON', 'Food']]);
      const sessionMappings = new Map([['AMAZON', 'Shopping']]);
      const result = resolveFromSession({ sourceKey: 'AMAZON', oneTimeAssignments, sessionMappings });
      expect(result).toBe('Food');
    });

    it('returns null when the key is not in either map', () => {
      const oneTimeAssignments = new Map();
      const sessionMappings = new Map();
      const result = resolveFromSession({ sourceKey: 'UNKNOWN', oneTimeAssignments, sessionMappings });
      expect(result).toBeNull();
    });
  });
});