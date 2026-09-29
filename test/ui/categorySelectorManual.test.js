/**
 * Manual Transaction Categorization dialog tests
 *
 * Covers theming (the dialog must follow the light/dark theme variables rather
 * than hard-coded light colors) and the basic save/cancel flow.
 */

import { jest } from '@jest/globals';
import { showManualCategorizationDialog } from '../../src/ui/components/categorySelectorManual';

jest.mock('../../src/ui/keyboardNavigation', () => ({
  addModalKeyboardHandlers: jest.fn(() => jest.fn()),
}));

const transaction = {
  externalCanonicalId: 'tx-1',
  type: 'NEW_TYPE',
  subType: 'NEW_SUBTYPE',
  amount: 12.5,
  amountSign: 'negative',
  currency: 'CAD',
  occurredAt: '2026-09-29T07:59:59.999000+00:00',
  unifiedStatus: 'COMPLETED',
};

// Light-only colors that are unreadable on a dark background
const HARDCODED_LIGHT_COLORS = ['white', '#fff3cd', '#856404', '#f8f9fa', '#f4f4f4', '#e8f4f8', '#333', '#666', '#888', '#ddd'];

/** Strip var(--name, fallback) so only colors outside theme variables remain */
const stripThemeVars = (style) => style.replace(/var\(--mu-[a-z-]+(?:,[^)]*)?\)/g, '');

const openDialog = (showCategoryGroupSelectorFn = jest.fn()) => {
  const callback = jest.fn();
  showManualCategorizationDialog(transaction, [], callback, showCategoryGroupSelectorFn);
  return callback;
};

describe('showManualCategorizationDialog', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  describe('theming', () => {
    it('uses theme variables for the modal surface and warning banner', () => {
      openDialog();

      const modalStyle = document.getElementById('manual-categorization-modal').getAttribute('style');
      expect(modalStyle).toContain('var(--mu-bg-primary');
      expect(modalStyle).toContain('var(--mu-text-primary');

      const bannerStyle = document.getElementById('manual-categorization-description').getAttribute('style');
      expect(bannerStyle).toContain('var(--mu-warning-bg');
      expect(bannerStyle).toContain('var(--mu-warning-text');
      expect(bannerStyle).toContain('var(--mu-warning-border');
    });

    it('has no hard-coded light colors outside theme variables', () => {
      openDialog();

      const overlay = document.getElementById('manual-categorization-overlay');
      const offenders = [];
      overlay.querySelectorAll('[style]').forEach((el) => {
        const style = stripThemeVars(el.getAttribute('style')).toLowerCase();
        HARDCODED_LIGHT_COLORS.forEach((color) => {
          if (new RegExp(`(color|background|border)[^;]*${color}(?![0-9a-f])`).test(style)) {
            offenders.push(`${el.id || el.tagName}: ${color}`);
          }
        });
      });

      expect(offenders).toEqual([]);
    });

    it('themes the selected category text after selection', () => {
      const selector = jest.fn((groups, label, cb) => cb({ id: 'cat-1', name: 'Transfer' }));
      openDialog(selector);

      document.getElementById('manual-categorization-category-display').click();

      const text = document.getElementById('manual-categorization-category-text');
      expect(text.textContent).toBe('Transfer');
      expect(text.getAttribute('style')).toContain('var(--mu-text-primary');
    });
  });

  describe('save and cancel', () => {
    it('returns merchant and category once both are provided', () => {
      const selector = jest.fn((groups, label, cb) => cb({ id: 'cat-1', name: 'Transfer' }));
      const callback = openDialog(selector);

      const input = document.getElementById('manual-categorization-merchant-input');
      input.value = 'Overdraft';
      input.dispatchEvent(new Event('input'));
      document.getElementById('manual-categorization-category-display').click();

      const saveBtn = document.getElementById('manual-categorization-save-btn');
      expect(saveBtn.disabled).toBe(false);
      saveBtn.click();

      expect(callback).toHaveBeenCalledWith({ merchant: 'Overdraft', category: { id: 'cat-1', name: 'Transfer' } });
      expect(document.getElementById('manual-categorization-overlay')).toBeNull();
    });

    it('keeps save disabled until a category is selected', () => {
      openDialog();

      const input = document.getElementById('manual-categorization-merchant-input');
      input.value = 'Overdraft';
      input.dispatchEvent(new Event('input'));

      expect(document.getElementById('manual-categorization-save-btn').disabled).toBe(true);
    });

    it('returns null on cancel', () => {
      const callback = openDialog();

      document.getElementById('manual-categorization-cancel-btn').click();

      expect(callback).toHaveBeenCalledWith(null);
      expect(document.getElementById('manual-categorization-overlay')).toBeNull();
    });
  });
});
