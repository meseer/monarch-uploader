/**
 * Tests for the escapeHtml helper
 *
 * escapeHtml is the shared primitive that keeps institution- and
 * counterparty-supplied text (merchant names, e-Transfer originator names, P2P
 * handles, API error bodies) inert when UI components build markup strings that
 * are assigned to innerHTML.
 */

import { escapeHtml } from '../../src/core/utils';

// utils pulls in toast/accountService at module load; stub them out
jest.mock('../../src/ui/toast', () => ({
  show: jest.fn(),
}));

jest.mock('../../src/services/common/accountService', () => ({
  __esModule: true,
  default: {
    getAccounts: jest.fn(() => []),
  },
}));

describe('escapeHtml', () => {
  describe('HTML-significant characters', () => {
    it('escapes the ampersand first so escapes are not double-decoded', () => {
      expect(escapeHtml('Tim & Tom')).toBe('Tim &amp; Tom');
      expect(escapeHtml('&lt;')).toBe('&amp;lt;');
    });

    it('escapes angle brackets', () => {
      expect(escapeHtml('<')).toBe('&lt;');
      expect(escapeHtml('>')).toBe('&gt;');
      expect(escapeHtml('a < b > c')).toBe('a &lt; b &gt; c');
    });

    it('escapes double quotes, single quotes and backticks', () => {
      expect(escapeHtml('"')).toBe('&quot;');
      expect(escapeHtml("'")).toBe('&#39;');
      expect(escapeHtml('`')).toBe('&#96;');
      expect(escapeHtml(`mix "d" 'q' \`b\``)).toBe('mix &quot;d&quot; &#39;q&#39; &#96;b&#96;');
    });

    it('escapes every occurrence, not just the first', () => {
      expect(escapeHtml('<<>>')).toBe('&lt;&lt;&gt;&gt;');
    });

    it('leaves safe text untouched', () => {
      expect(escapeHtml('TIM HORTONS #1234')).toBe('TIM HORTONS #1234');
      expect(escapeHtml('Café — Montréal')).toBe('Café — Montréal');
      expect(escapeHtml('')).toBe('');
    });
  });

  describe('attack payloads', () => {
    it('neutralizes an img/onerror payload', () => {
      expect(escapeHtml('<img src=x onerror=alert(1)>'))
        .toBe('&lt;img src=x onerror=alert(1)&gt;');
    });

    it('neutralizes a script tag payload', () => {
      expect(escapeHtml('<script>alert(document.cookie)</script>'))
        .toBe('&lt;script&gt;alert(document.cookie)&lt;/script&gt;');
    });

    it('neutralizes attribute-breaking payloads', () => {
      expect(escapeHtml('" onmouseover="alert(1)'))
        .toBe('&quot; onmouseover=&quot;alert(1)');
      expect(escapeHtml("' onfocus='alert(1)"))
        .toBe('&#39; onfocus=&#39;alert(1)');
    });

    it('produces markup that the DOM parses as text, not elements', () => {
      const host = document.createElement('div');
      host.innerHTML = `<span>${escapeHtml('<img src=x onerror=alert(1)>')}</span>`;

      expect(host.querySelector('img')).toBeNull();
      expect(host.querySelector('span').textContent).toBe('<img src=x onerror=alert(1)>');
    });
  });

  describe('non-string inputs', () => {
    it('returns an empty string for null and undefined', () => {
      expect(escapeHtml(null)).toBe('');
      expect(escapeHtml(undefined)).toBe('');
    });

    it('stringifies numbers, booleans and bigints', () => {
      expect(escapeHtml(0)).toBe('0');
      expect(escapeHtml(-12.5)).toBe('-12.5');
      expect(escapeHtml(NaN)).toBe('NaN');
      expect(escapeHtml(false)).toBe('false');
    });

    it('stringifies objects and arrays, escaping the result', () => {
      expect(escapeHtml({ toString: () => '<b>x</b>' })).toBe('&lt;b&gt;x&lt;/b&gt;');
      expect(escapeHtml(['<a>', '<b>'])).toBe('&lt;a&gt;,&lt;b&gt;');
    });

    it('escapes an Error message', () => {
      expect(escapeHtml(new Error('<img src=x onerror=alert(1)>').message))
        .toBe('&lt;img src=x onerror=alert(1)&gt;');
    });
  });
});
