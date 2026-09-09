/**
 * Tests for the Uploaded Transactions settings section
 *
 * The section renders the dedup reference list in stored order — which is
 * newest-first (see `transactionStorage`) — with a merchant column and a filter
 * that matches both transaction ID and merchant.
 */

import { renderTransactionsManagementSection } from '../../src/ui/components/settingsModalTransactions';

jest.mock('../../src/core/utils', () => ({
  debugLog: jest.fn(),
  getTodayLocal: jest.fn(() => '2025-10-24'),
}));

jest.mock('../../src/core/integrationCapabilities', () => ({
  getCapabilities: jest.fn(() => ({ hasDeduplication: true, settings: [] })),
}));

jest.mock('../../src/services/common/accountService', () => ({
  __esModule: true,
  default: {
    updateAccountInList: jest.fn(() => true),
  },
}));

jest.mock('../../src/ui/toast', () => ({
  __esModule: true,
  default: { show: jest.fn() },
}));

jest.mock('../../src/ui/components/settingsModalHelpers', () => ({
  showConfirmDialog: jest.fn(() => Promise.resolve(true)),
}));

const { getCapabilities } = require('../../src/core/integrationCapabilities');
const accountService = require('../../src/services/common/accountService').default;
const { showConfirmDialog } = require('../../src/ui/components/settingsModalHelpers');
const toast = require('../../src/ui/toast').default;

const INTEGRATION = 'mbna';
const ACCOUNT = 'acc-1';

/** Stored transactions are newest-first: head = newest, tail = oldest. */
function storedTransactions() {
  return [
    { id: 'REF_NEW', date: '2025-10-22', merchant: 'Amazon Prime' },
    { id: 'REF_MID', date: '2025-10-21', merchant: 'STARBUCKS' },
    { id: 'REF_OLD', date: '2025-10-20', merchant: 'AMAZON' },
  ];
}

function render(uploadedTransactions, onRefresh = null) {
  const section = renderTransactionsManagementSection(
    INTEGRATION,
    { uploadedTransactions },
    ACCOUNT,
    onRefresh,
  );
  document.body.innerHTML = '';
  document.body.appendChild(section);
  return section;
}

function getRows() {
  const list = document.getElementById(`transactions-list-${INTEGRATION}-${ACCOUNT}`);
  return Array.from(list.children);
}

function getFilterInput() {
  return document.getElementById(`transactions-filter-input-${INTEGRATION}-${ACCOUNT}`);
}

function setFilter(value) {
  const input = getFilterInput();
  input.value = value;
  input.dispatchEvent(new Event('input'));
}

function visibleRows() {
  return getRows().filter((row) => row.style.display !== 'none');
}

beforeEach(() => {
  jest.clearAllMocks();
  getCapabilities.mockReturnValue({ hasDeduplication: true, settings: [] });
  accountService.updateAccountInList.mockReturnValue(true);
  showConfirmDialog.mockResolvedValue(true);
  document.body.innerHTML = '';
});

describe('renderTransactionsManagementSection', () => {
  describe('capability gating', () => {
    it('renders an empty div when the integration has no deduplication', () => {
      getCapabilities.mockReturnValue({ hasDeduplication: false, settings: [] });

      const section = renderTransactionsManagementSection(INTEGRATION, { uploadedTransactions: storedTransactions() }, ACCOUNT, null);

      expect(section.children.length).toBe(0);
    });

    it('renders an empty div when capabilities are unknown', () => {
      getCapabilities.mockReturnValue(null);

      const section = renderTransactionsManagementSection(INTEGRATION, { uploadedTransactions: [] }, ACCOUNT, null);

      expect(section.children.length).toBe(0);
    });
  });

  describe('empty state', () => {
    it('shows a placeholder message and no list', () => {
      const section = render([]);

      expect(section.textContent).toContain('No uploaded transaction IDs stored');
      expect(document.getElementById(`transactions-list-${INTEGRATION}-${ACCOUNT}`)).toBeNull();
    });

    it('reports a zero count in the header', () => {
      const section = render([]);

      expect(section.textContent).toContain('(0 stored)');
    });
  });

  describe('rendering', () => {
    it('renders rows in stored order, which is newest-first', () => {
      render(storedTransactions());

      const ids = getRows().map((row) => row.querySelector('input[type="checkbox"]').dataset.txId);
      expect(ids).toEqual(['REF_NEW', 'REF_MID', 'REF_OLD']);
    });

    it('puts the newest transaction in the top row', () => {
      // Regression test: the list previously rendered oldest-first because the
      // stored array (newest-first) was being reversed for display.
      render(storedTransactions());

      const topRowDate = document.getElementById(`transaction-date-${INTEGRATION}-${ACCOUNT}-0`);
      expect(topRowDate.textContent).toBe('2025-10-22');
    });

    it('does not sort or reverse the stored array (a misordered list stays visible)', () => {
      // Ordering is owned by insertion time, so the UI must not silently repair it.
      render([
        { id: 'OUT_OF_ORDER_OLD', date: '2025-10-20', merchant: 'AMAZON' },
        { id: 'OUT_OF_ORDER_NEW', date: '2025-10-22', merchant: 'STARBUCKS' },
      ]);

      const ids = getRows().map((row) => row.querySelector('input[type="checkbox"]').dataset.txId);
      expect(ids).toEqual(['OUT_OF_ORDER_OLD', 'OUT_OF_ORDER_NEW']);
    });

    it('renders the merchant name for each transaction', () => {
      render(storedTransactions());

      const merchant = document.getElementById(`transaction-merchant-${INTEGRATION}-${ACCOUNT}-0`);
      expect(merchant.textContent).toBe('Amazon Prime');
    });

    it('renders an em dash for legacy entries with no merchant', () => {
      render([{ id: 'LEGACY', date: null }]);

      const merchant = document.getElementById(`transaction-merchant-${INTEGRATION}-${ACCOUNT}-0`);
      expect(merchant.textContent).toBe('—');
      expect(merchant.title).toBe('No merchant recorded');
    });

    it('renders a date badge only when the entry has a date', () => {
      render([{ id: 'UNDATED', date: null, merchant: 'AMAZON' }]);

      expect(document.getElementById(`transaction-date-${INTEGRATION}-${ACCOUNT}-0`)).toBeNull();
    });

    it('renders the transaction ID', () => {
      render(storedTransactions());

      const idEl = document.getElementById(`transaction-id-${INTEGRATION}-${ACCOUNT}-0`);
      expect(idEl.textContent).toBe('REF_NEW');
    });

    it('reports the stored count in the header', () => {
      const section = render(storedTransactions());

      expect(section.textContent).toContain('(3 stored)');
    });
  });

  describe('filtering', () => {
    it('starts with all rows visible and a full counter', () => {
      render(storedTransactions());

      expect(visibleRows()).toHaveLength(3);
      expect(document.getElementById(`transactions-filter-count-${INTEGRATION}-${ACCOUNT}`).textContent).toBe('3 of 3');
    });

    it('filters by transaction ID', () => {
      render(storedTransactions());

      setFilter('REF_MID');

      const ids = visibleRows().map((row) => row.querySelector('input[type="checkbox"]').dataset.txId);
      expect(ids).toEqual(['REF_MID']);
    });

    it('filters by merchant', () => {
      render(storedTransactions());

      setFilter('STARBUCKS');

      const ids = visibleRows().map((row) => row.querySelector('input[type="checkbox"]').dataset.txId);
      expect(ids).toEqual(['REF_MID']);
    });

    it('matches merchant case-insensitively', () => {
      render(storedTransactions());

      setFilter('amazon');

      // Matches merchant "AMAZON" and "Amazon Prime"
      const ids = visibleRows().map((row) => row.querySelector('input[type="checkbox"]').dataset.txId);
      expect(ids).toEqual(['REF_NEW', 'REF_OLD']);
    });

    it('matches on a partial substring', () => {
      render(storedTransactions());

      setFilter('_OLD');

      expect(visibleRows()).toHaveLength(1);
    });

    it('updates the counter to show matches out of the total', () => {
      render(storedTransactions());

      setFilter('amazon');

      expect(document.getElementById(`transactions-filter-count-${INTEGRATION}-${ACCOUNT}`).textContent).toBe('2 of 3');
    });

    it('hides every row when nothing matches', () => {
      render(storedTransactions());

      setFilter('no-such-transaction');

      expect(visibleRows()).toHaveLength(0);
      expect(document.getElementById(`transactions-filter-count-${INTEGRATION}-${ACCOUNT}`).textContent).toBe('0 of 3');
    });

    it('restores all rows when the filter is cleared via the clear button', () => {
      render(storedTransactions());
      setFilter('STARBUCKS');

      document.getElementById(`transactions-filter-clear-btn-${INTEGRATION}-${ACCOUNT}`).click();

      expect(getFilterInput().value).toBe('');
      expect(visibleRows()).toHaveLength(3);
    });

    it('deselects rows that the filter hides', () => {
      render(storedTransactions());
      const rows = getRows();
      rows.forEach((row) => { row.querySelector('input[type="checkbox"]').checked = true; });

      setFilter('STARBUCKS');

      const stillChecked = rows.filter((row) => row.querySelector('input[type="checkbox"]').checked);
      expect(stillChecked).toHaveLength(1);
    });
  });

  describe('selection', () => {
    it('Select All checks only the visible rows', () => {
      render(storedTransactions());
      setFilter('STARBUCKS');

      document.getElementById(`transactions-select-all-btn-${INTEGRATION}-${ACCOUNT}`).click();

      const checked = getRows().filter((row) => row.querySelector('input[type="checkbox"]').checked);
      expect(checked).toHaveLength(1);
      expect(checked[0].querySelector('input[type="checkbox"]').dataset.txId).toBe('REF_MID');
    });

    it('Select All checks every row when no filter is active', () => {
      render(storedTransactions());

      document.getElementById(`transactions-select-all-btn-${INTEGRATION}-${ACCOUNT}`).click();

      const checked = getRows().filter((row) => row.querySelector('input[type="checkbox"]').checked);
      expect(checked).toHaveLength(3);
    });

    it('Select None clears the visible rows', () => {
      render(storedTransactions());
      document.getElementById(`transactions-select-all-btn-${INTEGRATION}-${ACCOUNT}`).click();

      document.getElementById(`transactions-select-none-btn-${INTEGRATION}-${ACCOUNT}`).click();

      const checked = getRows().filter((row) => row.querySelector('input[type="checkbox"]').checked);
      expect(checked).toHaveLength(0);
    });
  });

  describe('deleting selected transactions', () => {
    it('removes the selected entry by ID', async () => {
      render(storedTransactions());
      getRows()[0].querySelector('input[type="checkbox"]').checked = true;

      document.getElementById(`transactions-delete-selected-btn-${INTEGRATION}-${ACCOUNT}`).click();
      await Promise.resolve();
      await Promise.resolve();

      expect(accountService.updateAccountInList).toHaveBeenCalledWith(INTEGRATION, ACCOUNT, {
        uploadedTransactions: [
          { id: 'REF_MID', date: '2025-10-21', merchant: 'STARBUCKS' },
          { id: 'REF_OLD', date: '2025-10-20', merchant: 'AMAZON' },
        ],
      });
    });

    it('removes the right entry while a filter is active', async () => {
      render(storedTransactions());
      setFilter('STARBUCKS');
      visibleRows()[0].querySelector('input[type="checkbox"]').checked = true;

      document.getElementById(`transactions-delete-selected-btn-${INTEGRATION}-${ACCOUNT}`).click();
      await Promise.resolve();
      await Promise.resolve();

      const { uploadedTransactions } = accountService.updateAccountInList.mock.calls[0][2];
      expect(uploadedTransactions.map((t) => t.id)).toEqual(['REF_NEW', 'REF_OLD']);
    });

    it('preserves the remaining newest-first order', async () => {
      render(storedTransactions());
      getRows()[1].querySelector('input[type="checkbox"]').checked = true; // REF_MID

      document.getElementById(`transactions-delete-selected-btn-${INTEGRATION}-${ACCOUNT}`).click();
      await Promise.resolve();
      await Promise.resolve();

      const { uploadedTransactions } = accountService.updateAccountInList.mock.calls[0][2];
      expect(uploadedTransactions.map((t) => t.id)).toEqual(['REF_NEW', 'REF_OLD']);
    });

    it('warns and does not save when nothing is selected', async () => {
      render(storedTransactions());

      document.getElementById(`transactions-delete-selected-btn-${INTEGRATION}-${ACCOUNT}`).click();
      await Promise.resolve();

      expect(toast.show).toHaveBeenCalledWith('No transactions selected', 'warning');
      expect(accountService.updateAccountInList).not.toHaveBeenCalled();
    });

    it('does not save when the confirm dialog is declined', async () => {
      showConfirmDialog.mockResolvedValue(false);
      render(storedTransactions());
      getRows()[0].querySelector('input[type="checkbox"]').checked = true;

      document.getElementById(`transactions-delete-selected-btn-${INTEGRATION}-${ACCOUNT}`).click();
      await Promise.resolve();
      await Promise.resolve();

      expect(accountService.updateAccountInList).not.toHaveBeenCalled();
    });
  });

  describe('deleting all transactions', () => {
    it('clears the stored array', async () => {
      render(storedTransactions());

      document.getElementById(`transactions-delete-all-btn-${INTEGRATION}-${ACCOUNT}`).click();
      await Promise.resolve();
      await Promise.resolve();

      expect(accountService.updateAccountInList).toHaveBeenCalledWith(INTEGRATION, ACCOUNT, {
        uploadedTransactions: [],
      });
    });
  });

  describe('adding transactions', () => {
    it('prepends new IDs at the head with today\'s date', () => {
      render(storedTransactions());
      document.getElementById(`transactions-add-btn-${INTEGRATION}-${ACCOUNT}`).click();
      document.getElementById(`transactions-textarea-${INTEGRATION}-${ACCOUNT}`).value = 'NEW_1';

      document.getElementById(`transactions-save-btn-${INTEGRATION}-${ACCOUNT}`).click();

      // Regression test: a manually added entry previously landed before the
      // oldest transaction instead of at the top of the list.
      const { uploadedTransactions } = accountService.updateAccountInList.mock.calls[0][2];
      expect(uploadedTransactions.map((t) => t.id)).toEqual(['NEW_1', 'REF_NEW', 'REF_MID', 'REF_OLD']);
      expect(uploadedTransactions[0]).toEqual({ id: 'NEW_1', date: '2025-10-24', merchant: null });
    });

    it('accepts comma- and newline-separated IDs', () => {
      render([]);
      // An empty list renders no toolbar, so start from a populated account
      render(storedTransactions());
      document.getElementById(`transactions-add-btn-${INTEGRATION}-${ACCOUNT}`).click();
      document.getElementById(`transactions-textarea-${INTEGRATION}-${ACCOUNT}`).value = 'A,B\nC';

      document.getElementById(`transactions-save-btn-${INTEGRATION}-${ACCOUNT}`).click();

      const { uploadedTransactions } = accountService.updateAccountInList.mock.calls[0][2];
      expect(uploadedTransactions.map((t) => t.id)).toEqual(['A', 'B', 'C', 'REF_NEW', 'REF_MID', 'REF_OLD']);
    });

    it('skips IDs that already exist', () => {
      render(storedTransactions());
      document.getElementById(`transactions-add-btn-${INTEGRATION}-${ACCOUNT}`).click();
      document.getElementById(`transactions-textarea-${INTEGRATION}-${ACCOUNT}`).value = 'REF_OLD\nNEW_1';

      document.getElementById(`transactions-save-btn-${INTEGRATION}-${ACCOUNT}`).click();

      const { uploadedTransactions } = accountService.updateAccountInList.mock.calls[0][2];
      expect(uploadedTransactions.filter((t) => t.id === 'REF_OLD')).toHaveLength(1);
      expect(uploadedTransactions.map((t) => t.id)).toContain('NEW_1');
    });

    it('warns and does not save when every ID is a duplicate', () => {
      render(storedTransactions());
      document.getElementById(`transactions-add-btn-${INTEGRATION}-${ACCOUNT}`).click();
      document.getElementById(`transactions-textarea-${INTEGRATION}-${ACCOUNT}`).value = 'REF_OLD';

      document.getElementById(`transactions-save-btn-${INTEGRATION}-${ACCOUNT}`).click();

      expect(toast.show).toHaveBeenCalledWith('All transaction IDs already exist', 'warning');
      expect(accountService.updateAccountInList).not.toHaveBeenCalled();
    });

    it('warns and does not save on empty input', () => {
      render(storedTransactions());
      document.getElementById(`transactions-add-btn-${INTEGRATION}-${ACCOUNT}`).click();

      document.getElementById(`transactions-save-btn-${INTEGRATION}-${ACCOUNT}`).click();

      expect(toast.show).toHaveBeenCalledWith('Please enter at least one transaction ID', 'warning');
      expect(accountService.updateAccountInList).not.toHaveBeenCalled();
    });

    it('hides the input area again after cancelling', () => {
      render(storedTransactions());
      const addArea = document.getElementById(`transactions-add-input-${INTEGRATION}-${ACCOUNT}`);
      document.getElementById(`transactions-add-btn-${INTEGRATION}-${ACCOUNT}`).click();
      expect(addArea.style.display).toBe('block');

      document.getElementById(`transactions-cancel-input-btn-${INTEGRATION}-${ACCOUNT}`).click();

      expect(addArea.style.display).toBe('none');
    });
  });
});