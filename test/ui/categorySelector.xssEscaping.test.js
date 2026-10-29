/**
 * Category Selector - XSS escaping regression tests
 *
 * A counterparty controls their own Interac e-Transfer / P2P display name, and a
 * merchant controls its own name. Those strings reach the category selector
 * modal through `transactionDetails`, which is rendered into `innerHTML`. They
 * must be rendered as inert text, never parsed as markup.
 */

import categorySelector from '../../src/ui/components/categorySelector';

vi.mock('../../src/core/utils', async () => ({
  debugLog: vi.fn(),
  // Real implementation: escaping is exactly what these tests assert on
  escapeHtml: (await import('../helpers/escapeHtmlMock')).realEscapeHtml(),
  stringSimilarity: vi.fn(() => 0.5),
}));

vi.mock('../../src/api/monarch', () => ({
  __esModule: true,
  default: {
    getCategoriesAndGroups: vi.fn(),
  },
}));

vi.mock('../../src/ui/toast', () => ({
  __esModule: true,
  default: { show: vi.fn() },
}));

vi.mock('../../src/ui/keyboardNavigation', () => ({
  addModalKeyboardHandlers: vi.fn(() => vi.fn()),
  makeItemsKeyboardNavigable: vi.fn(() => vi.fn()),
}));

const PAYLOAD = '<img src=x onerror=alert(1)>';

const mockCategoryData = {
  categoryGroups: [
    { id: 'group-1', name: 'Food & Dining', order: 1, type: 'expense' },
  ],
  categories: [
    {
      id: 'cat-1',
      name: 'Restaurants',
      order: 1,
      icon: '🍽️',
      group: { id: 'group-1', name: 'Food & Dining', type: 'expense' },
    },
  ],
};

describe('Category Selector XSS escaping', () => {
  let monarchApi;

  beforeEach(async () => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
    monarchApi = (await import('../../src/api/monarch')).default;
    monarchApi.getCategoriesAndGroups.mockResolvedValue(mockCategoryData);
  });

  /** The rendered modal, which owns the transaction details block */
  const getModal = () => document.querySelector('div[style*="--mu-bg-primary"]');

  describe('counterparty-supplied transaction details', () => {
    it('renders an e-Transfer originator name as text, not an element', async () => {
      await categorySelector.showMonarchCategorySelector('TEST_CATEGORY', vi.fn(), null, {
        merchant: 'Interac e-Transfer',
        aftDetails: { aftOriginatorName: PAYLOAD },
      });

      const modal = getModal();
      expect(modal.querySelector('img')).toBeNull();
      expect(modal.textContent).toContain(PAYLOAD);
      expect(modal.innerHTML).toContain('&lt;img src=x onerror=alert(1)&gt;');
    });

    it('renders a P2P handle as text, not an element', async () => {
      await categorySelector.showMonarchCategorySelector('TEST_CATEGORY', vi.fn(), null, {
        p2pDetails: { type: 'P2P', subType: PAYLOAD, p2pHandle: PAYLOAD },
      });

      const modal = getModal();
      expect(modal.querySelector('img')).toBeNull();
      expect(modal.textContent).toContain(PAYLOAD);
    });

    it('renders a merchant name as text, not an element', async () => {
      await categorySelector.showMonarchCategorySelector('TEST_CATEGORY', vi.fn(), null, {
        merchant: `EVIL${PAYLOAD}`,
      });

      const modal = getModal();
      expect(modal.querySelector('img')).toBeNull();
      expect(modal.textContent).toContain(`EVIL${PAYLOAD}`);
    });

    it('escapes remaining detail fields (date, AFT type/category, amount)', async () => {
      await categorySelector.showMonarchCategorySelector('TEST_CATEGORY', vi.fn(), null, {
        date: `2024-01-10${PAYLOAD}`,
        amount: `$5.00 ${PAYLOAD}`,
        aftDetails: {
          aftTransactionType: PAYLOAD,
          aftTransactionCategory: PAYLOAD,
        },
      });

      const modal = getModal();
      expect(modal.querySelector('img')).toBeNull();
      expect(modal.innerHTML).not.toContain('<img');
    });

    it('preserves the label/value layout while escaping', async () => {
      await categorySelector.showMonarchCategorySelector('TEST_CATEGORY', vi.fn(), null, {
        merchant: 'Tim & Tom',
        date: '2024-01-10',
      });

      const modal = getModal();
      expect(modal.innerHTML).toContain('Transaction Details:');
      expect(modal.innerHTML).toContain('Merchant:');
      expect(modal.innerHTML).toContain('Date:');
      expect(modal.innerHTML).toContain('Tim &amp; Tom');
      expect(modal.textContent).toContain('Tim & Tom');
      expect(modal.textContent).toContain('2024-01-10');
    });
  });

  describe('institution-supplied bank category', () => {
    it('renders the bank category as text, not an element', async () => {
      await categorySelector.showMonarchCategorySelector(PAYLOAD, vi.fn(), null, null);

      const modal = getModal();
      expect(modal.querySelector('img')).toBeNull();
      expect(modal.textContent).toContain(PAYLOAD);
    });

    it('renders the similarity best match as text, not an element', async () => {
      await categorySelector.showMonarchCategorySelector('TEST_CATEGORY', vi.fn(), {
        score: 0.8,
        bestMatch: PAYLOAD,
        categoryGroups: mockCategoryData.categoryGroups.map((group) => ({
          ...group,
          categories: mockCategoryData.categories,
          categoryCount: mockCategoryData.categories.length,
        })),
      }, null);

      const modal = getModal();
      expect(modal.querySelector('img')).toBeNull();
      expect(modal.textContent).toContain(PAYLOAD);
      expect(modal.innerHTML).toContain('Best match:');
    });
  });
});
