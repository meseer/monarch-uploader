/**
 * Tests for Version Badge Component
 */

import {
  createVersionBadge,
  createVersionLink,
  VERSION_LABEL,
} from '../../src/ui/components/versionBadge';

jest.mock('../../src/scriptInfo.json', () => ({
  version: '5.60.0',
  gistUrl: 'https://gist.github.com/meseer/f00fb552c96efeb3eb4e4e1fd520d4e7/raw/monarch-uploader.user.js',
}));

describe('Version Badge Component', () => {
  describe('VERSION_LABEL', () => {
    test('should prefix the scriptInfo version with "v"', () => {
      expect(VERSION_LABEL).toBe('v5.60.0');
    });
  });

  describe('createVersionBadge', () => {
    test('should render a span element', () => {
      const badge = createVersionBadge('wealthsimple');

      expect(badge.tagName).toBe('SPAN');
    });

    test('should display the current version from scriptInfo', () => {
      const badge = createVersionBadge('wealthsimple');

      expect(badge.textContent).toBe('v5.60.0');
    });

    test('should build the element ID from the provided prefix', () => {
      const badge = createVersionBadge('wealthsimple');

      expect(badge.id).toBe('wealthsimple-version-badge');
    });

    test('should produce unique IDs for different prefixes', () => {
      const wealthsimple = createVersionBadge('wealthsimple');
      const rogersbank = createVersionBadge('rogersbank');
      const mbna = createVersionBadge('mbna');

      const ids = [wealthsimple.id, rogersbank.id, mbna.id];
      expect(new Set(ids).size).toBe(3);
      expect(ids).toEqual([
        'wealthsimple-version-badge',
        'rogersbank-version-badge',
        'mbna-version-badge',
      ]);
    });

    test('should include a descriptive tooltip', () => {
      const badge = createVersionBadge('canadalife');

      expect(badge.title).toBe('Monarch Uploader v5.60.0');
    });

    test('should apply small, greyed-out styling', () => {
      const badge = createVersionBadge('questrade');

      expect(badge.style.fontSize).toBe('11px');
      expect(badge.style.fontWeight).toBe('400');
      expect(badge.style.color).toContain('--mu-text-secondary');
    });

    test('should not be interactive (no href, no button semantics)', () => {
      const badge = createVersionBadge('questrade');

      expect(badge.tagName).not.toBe('A');
      expect(badge.tagName).not.toBe('BUTTON');
      expect(badge.getAttribute('href')).toBeNull();
    });

    test('should throw when no prefix is provided', () => {
      expect(() => createVersionBadge('')).toThrow(/idPrefix/);
    });

    test('should be appendable to a title row without affecting siblings', () => {
      const titleRow = document.createElement('div');
      const title = document.createElement('div');
      title.textContent = 'Balance Uploader';
      titleRow.appendChild(title);
      titleRow.appendChild(createVersionBadge('mbna'));

      expect(titleRow.children).toHaveLength(2);
      expect(titleRow.children[0].textContent).toBe('Balance Uploader');
      expect(titleRow.children[1].id).toBe('mbna-version-badge');
    });
  });

  describe('createVersionLink', () => {
    test('should render an anchor element with the settings link ID', () => {
      const link = createVersionLink();

      expect(link.tagName).toBe('A');
      expect(link.id).toBe('settings-version-link');
    });

    test('should display the current version from scriptInfo', () => {
      const link = createVersionLink();

      expect(link.textContent).toBe('v5.60.0');
    });

    test('should point at the gist URL', () => {
      const link = createVersionLink();

      expect(link.href).toBe('https://gist.github.com/meseer/f00fb552c96efeb3eb4e4e1fd520d4e7/raw/monarch-uploader.user.js');
    });

    test('should open in a new tab safely', () => {
      const link = createVersionLink();

      expect(link.target).toBe('_blank');
      expect(link.rel).toBe('noopener noreferrer');
    });

    test('should highlight on mouseover and reset on mouseout', () => {
      const link = createVersionLink();

      link.dispatchEvent(new MouseEvent('mouseover'));
      expect(link.style.textDecoration).toBe('underline');
      expect(link.style.color).toContain('--mu-link-color');

      link.dispatchEvent(new MouseEvent('mouseout'));
      expect(link.style.textDecoration).toBe('none');
      expect(link.style.color).toContain('--mu-text-secondary');
    });
  });
});