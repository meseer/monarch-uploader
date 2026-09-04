/**
 * Tests for the cardholder → household member selector modal
 *
 * The modal pre-selects the best automatic match so the common case is a single
 * confirmation. Cancelling must resolve with null (meaning "ask again next
 * sync") rather than silently persisting a Shared choice.
 */

import { showCardholderSelector } from '../../src/ui/components/cardholderSelector';

jest.mock('../../src/core/utils', () => ({
  debugLog: jest.fn(),
}));

jest.mock('../../src/core/config', () => ({
  CARDHOLDER: {
    SHARED_OWNER: 'Shared',
    OWNER_MODE: { OFF: 'off', ON: 'on' },
    TAG_MODE: { OFF: 'off', AUTO: 'auto', ALWAYS: 'always' },
  },
}));

jest.mock('../../src/ui/keyboardNavigation', () => ({
  addModalKeyboardHandlers: jest.fn(() => jest.fn()),
}));

jest.mock('../../src/services/common/cardholderMatching', () => ({
  describeMatchType: jest.fn((t) => `described:${t}`),
}));

const member = (overrides = {}) => ({
  id: 'user-1',
  name: 'Mykhailo Delegan',
  displayName: 'Mykhailo',
  householdRole: 'OWNER',
  profilePictureUrl: null,
  avatarColor: null,
  ...overrides,
});

const baseParams = (overrides = {}) => ({
  cardholderName: 'MYKHAILO DELEGAN',
  cardLast4: '8584',
  members: [member()],
  suggestedMemberId: 'user-1',
  suggestedMatchType: 'exact-name',
  ...overrides,
});

const $ = (id) => document.getElementById(id);

beforeEach(() => {
  document.body.innerHTML = '';
  jest.clearAllMocks();
});

describe('showCardholderSelector', () => {
  describe('rendering', () => {
    it('renders the overlay and modal with stable ids', () => {
      showCardholderSelector(baseParams());

      expect($('cardholder-selector-overlay')).toBeTruthy();
      expect($('cardholder-selector-modal')).toBeTruthy();
      expect($('cardholder-selector-options')).toBeTruthy();
      expect($('cardholder-selector-confirm-button')).toBeTruthy();
      expect($('cardholder-selector-cancel-button')).toBeTruthy();
    });

    it('shows the raw cardholder name and masked card in the subtitle', () => {
      showCardholderSelector(baseParams());

      expect($('cardholder-selector-subtitle').textContent).toBe('MYKHAILO DELEGAN · card ••8584');
    });

    it('omits the masked card when the last 4 are unknown', () => {
      showCardholderSelector(baseParams({ cardLast4: null }));

      expect($('cardholder-selector-subtitle').textContent).toBe('MYKHAILO DELEGAN');
    });

    it('always offers Shared as the first option', () => {
      showCardholderSelector(baseParams());

      const options = $('cardholder-selector-options').children;
      expect(options[0].id).toBe('cardholder-option-shared');
    });

    it('renders an option per household member', () => {
      showCardholderSelector(baseParams({
        members: [member(), member({ id: 'user-2', name: 'Liubov Monsar', displayName: 'Liubov' })],
        suggestedMemberId: null,
        suggestedMatchType: null,
      }));

      expect($('cardholder-option-user-1')).toBeTruthy();
      expect($('cardholder-option-user-2')).toBeTruthy();
    });

    it('uses the member full name as the option label (never displayName)', () => {
      showCardholderSelector(baseParams());

      // Monarch matches Owner against users[].name, so the full name must be shown
      expect($('cardholder-option-user-1').textContent).toContain('Mykhailo Delegan');
    });

    it('explains why a row was suggested', () => {
      showCardholderSelector(baseParams());

      expect($('cardholder-option-user-1').textContent).toContain('described:exact-name');
    });

    it('renders with an empty household (Shared only)', () => {
      showCardholderSelector(baseParams({ members: [], suggestedMemberId: null, suggestedMatchType: null }));

      expect($('cardholder-option-shared')).toBeTruthy();
      expect($('cardholder-selector-options').children).toHaveLength(1);
    });
  });

  describe('selectable cards', () => {
    it('renders every option as a card with a data attribute rather than a visible radio', () => {
      showCardholderSelector(baseParams());

      const cards = $('cardholder-selector-options').querySelectorAll('[data-cardholder-option]');
      expect(cards).toHaveLength(2); // Shared + one member

      // The radio is retained for accessibility but visually hidden
      const radio = $('cardholder-option-user-1').querySelector('input[type="radio"]');
      expect(radio).toBeTruthy();
      expect(radio.style.opacity).toBe('0');
    });

    it('gives every card the same fixed height and full width for visual consistency', () => {
      showCardholderSelector(baseParams({
        // One option has a sublabel and badge, the other does not — sizing must
        // not depend on content.
        members: [member(), member({ id: 'user-2', name: 'Liubov Monsar', displayName: 'Liubov Monsar' })],
      }));

      const cards = Array.from($('cardholder-selector-options').querySelectorAll('[data-cardholder-option]'));
      const heights = cards.map((c) => c.style.height);
      const widths = cards.map((c) => c.style.width);

      expect(new Set(heights).size).toBe(1);
      expect(heights[0]).toBe('56px');
      expect(new Set(widths).size).toBe(1);
      expect(widths[0]).toBe('100%');
    });

    it('visually highlights the pre-selected card only', () => {
      showCardholderSelector(baseParams());

      const selected = $('cardholder-option-user-1');
      const unselected = $('cardholder-option-shared');

      expect(selected.style.borderColor).toBe('rgb(40, 167, 69)');
      expect(unselected.style.borderColor).not.toBe('rgb(40, 167, 69)');
    });

    it('moves the highlight when a different card is chosen', async () => {
      showCardholderSelector(baseParams());

      const shared = $('cardholder-option-shared');
      shared.querySelector('input').checked = true;
      shared.dispatchEvent(new Event('change', { bubbles: true }));

      expect(shared.style.borderColor).toBe('rgb(40, 167, 69)');
      expect($('cardholder-option-user-1').style.borderColor).not.toBe('rgb(40, 167, 69)');
    });
  });

  describe('pre-selection', () => {
    it('pre-selects the suggested member', () => {
      showCardholderSelector(baseParams());

      const checked = $('cardholder-selector-options').querySelector('input:checked');
      expect(checked.value).toBe('user-1');
    });

    it('pre-selects Shared when nothing matched', () => {
      showCardholderSelector(baseParams({ suggestedMemberId: null, suggestedMatchType: null }));

      const checked = $('cardholder-selector-options').querySelector('input:checked');
      expect(checked.value).toBe('__shared__');
    });

    it('marks the suggested row with a badge', () => {
      showCardholderSelector(baseParams());

      expect($('cardholder-option-user-1').textContent).toContain('Suggested');
      expect($('cardholder-option-shared').textContent).not.toContain('Suggested');
    });
  });

  describe('confirming', () => {
    it('resolves with the pre-selected member on confirm', async () => {
      const promise = showCardholderSelector(baseParams());

      $('cardholder-selector-confirm-button').click();

      await expect(promise).resolves.toEqual({ member: member() });
    });

    it('resolves with the member the user picked instead of the suggestion', async () => {
      const promise = showCardholderSelector(baseParams({
        members: [member(), member({ id: 'user-2', name: 'Liubov Monsar', displayName: 'Liubov' })],
      }));

      $('cardholder-option-user-2').querySelector('input').checked = true;
      $('cardholder-selector-confirm-button').click();

      const result = await promise;
      expect(result.member.id).toBe('user-2');
    });

    it('resolves with a null member when Shared is chosen', async () => {
      const promise = showCardholderSelector(baseParams());

      $('cardholder-option-shared').querySelector('input').checked = true;
      $('cardholder-selector-confirm-button').click();

      await expect(promise).resolves.toEqual({ member: null });
    });

    it('removes the overlay after confirming', async () => {
      const promise = showCardholderSelector(baseParams());

      $('cardholder-selector-confirm-button').click();
      await promise;

      expect($('cardholder-selector-overlay')).toBeNull();
    });
  });

  describe('cancelling', () => {
    it('resolves with null so the caller does not persist a choice', async () => {
      const promise = showCardholderSelector(baseParams());

      $('cardholder-selector-cancel-button').click();

      await expect(promise).resolves.toBeNull();
    });

    it('removes the overlay after cancelling', async () => {
      const promise = showCardholderSelector(baseParams());

      $('cardholder-selector-cancel-button').click();
      await promise;

      expect($('cardholder-selector-overlay')).toBeNull();
    });

    it('resolves with null when the modal keyboard handler cancels (Escape)', async () => {
      const { addModalKeyboardHandlers } = require('../../src/ui/keyboardNavigation');
      const promise = showCardholderSelector(baseParams());

      // Invoke the cancel callback registered with the shared keyboard handler
      const onCancel = addModalKeyboardHandlers.mock.calls[0][1];
      onCancel();

      await expect(promise).resolves.toBeNull();
      expect($('cardholder-selector-overlay')).toBeNull();
    });
  });
});
