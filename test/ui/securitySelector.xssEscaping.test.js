/**
 * Security Selector - XSS escaping regression tests
 *
 * Position symbol/exchange/description come from the institution's API, the
 * search term echo comes straight from the user's input box, and the error
 * message can carry a raw API response body. None of them may be parsed as
 * markup by the modal.
 */


import { showMonarchSecuritySelector } from '../../src/ui/components/securitySelector';
import monarchApi from '../../src/api/monarch';

vi.mock('../../src/core/utils', async () => {
  const { realEscapeHtml } = await import('../helpers/escapeHtmlMock');
  return {
    debugLog: vi.fn(),
    escapeHtml: realEscapeHtml(),
  };
});

vi.mock('../../src/api/monarch', () => ({
  __esModule: true,
  default: {
    searchSecurities: vi.fn(),
  },
}));

vi.mock('../../src/ui/keyboardNavigation', () => ({
  addModalKeyboardHandlers: vi.fn(() => vi.fn()),
  makeItemsKeyboardNavigable: vi.fn(() => vi.fn()),
}));

const PAYLOAD = '<img src=x onerror=alert(1)>';

describe('Security Selector XSS escaping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  describe('position details from the institution API', () => {
    it('renders a malicious symbol as text, not an element', async () => {
      monarchApi.searchSecurities.mockResolvedValue([]);

      await showMonarchSecuritySelector({ security: { symbol: PAYLOAD } }, vi.fn());

      const details = document.getElementById('security-selector-details');
      expect(details.querySelector('img')).toBeNull();
      expect(details.textContent).toContain(PAYLOAD);
      expect(details.innerHTML).toContain('&lt;img src=x onerror=alert(1)&gt;');
    });

    it('renders a malicious exchange and description as text, not elements', async () => {
      monarchApi.searchSecurities.mockResolvedValue([]);

      await showMonarchSecuritySelector({
        security: {
          symbol: 'AAPL',
          listingMarket: PAYLOAD,
          description: PAYLOAD,
        },
      }, vi.fn());

      const details = document.getElementById('security-selector-details');
      expect(details.querySelector('img')).toBeNull();
      expect(details.innerHTML).not.toContain('<img');
    });

    it('keeps benign details readable', async () => {
      monarchApi.searchSecurities.mockResolvedValue([]);

      await showMonarchSecuritySelector({
        security: { symbol: 'AAPL', listingMarket: 'NASDAQ', description: 'APPLE INC' },
      }, vi.fn());

      const details = document.getElementById('security-selector-details');
      expect(details.textContent).toContain('AAPL');
      expect(details.textContent).toContain('NASDAQ');
      expect(details.textContent).toContain('Apple Inc');
    });
  });

  describe('search term echo', () => {
    it('renders the no-results term as text, not an element', async () => {
      monarchApi.searchSecurities.mockResolvedValue([]);

      await showMonarchSecuritySelector({ security: { symbol: PAYLOAD } }, vi.fn());

      const results = document.getElementById('security-selector-results');
      expect(results.querySelector('img')).toBeNull();

      const message = document.getElementById('security-selector-no-results');
      expect(message).toBeTruthy();
      expect(message.textContent).toContain(`No securities found for "${PAYLOAD}"`);
      expect(document.getElementById('security-selector-no-results-hint').textContent)
        .toBe('Try searching by ticker symbol or company name');
    });
  });

  describe('search error message', () => {
    it('renders an API error body as text, not markup', async () => {
      monarchApi.searchSecurities.mockRejectedValue(
        new Error(`Request failed: ${PAYLOAD}`),
      );

      await showMonarchSecuritySelector({ security: { symbol: 'AAPL' } }, vi.fn());
      // Allow the rejected search promise to settle
      await Promise.resolve();
      await Promise.resolve();

      const error = document.getElementById('security-selector-search-error');
      expect(error).toBeTruthy();
      expect(error.querySelector('img')).toBeNull();
      expect(error.textContent).toBe(`Error searching securities: Request failed: ${PAYLOAD}`);
    });
  });
});
