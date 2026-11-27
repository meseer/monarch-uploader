/**
 * Tests for Closed Accounts Dialog UI Component
 */

import '../setup';
import { showClosedAccountsDialog } from '../../src/ui/components/closedAccountsDialog';

const SAMPLE_ACCOUNTS = [
  {
    id: 'agr-rrsp',
    name: 'REGISTERED RETIREMENT SAVINGS PLAN',
    shortName: 'RRSP',
    monarchAccountName: 'Amazon RRSP',
    lastSyncDate: '2026-11-20',
  },
  {
    id: 'agr-dpsp',
    name: 'DEFERRED PROFIT SHARING PLAN',
    shortName: 'DPSP',
    monarchAccountName: null,
    lastSyncDate: '2026-11-20',
  },
];

describe('Closed Accounts Dialog', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  test('renders candidate accounts pre-checked, pre-filled closure date, hint, and XSS-safe text', async () => {
    const promise = showClosedAccountsDialog({
      title: 'Closed Accounts <script>alert(1)</script>',
      description: 'Accounts missing from plan',
      note: 'Multi-sponsor note',
      accounts: SAMPLE_ACCOUNTS,
      defaultClosedDate: '2026-11-24',
      closedDateHint: "Pre-filled from RRSP2's opening date (2026-11-24)",
    });

    expect(document.getElementById('closed-accounts-dialog-overlay')).toBeTruthy();
    expect(document.getElementById('closed-accounts-dialog-modal')).toBeTruthy();
    expect(document.getElementById('closed-accounts-dialog-title').textContent).toBe(
      'Closed Accounts <script>alert(1)</script>',
    );
    expect(document.getElementById('closed-accounts-dialog-modal').querySelector('script')).toBeNull();
    expect(document.getElementById('closed-accounts-dialog-note').textContent).toBe('Multi-sponsor note');

    const dateInput = document.getElementById('closed-accounts-date-input');
    expect(dateInput.value).toBe('2026-11-24');
    expect(document.getElementById('closed-accounts-date-hint').textContent).toBe(
      "Pre-filled from RRSP2's opening date (2026-11-24)",
    );

    const rrspCheckbox = document.getElementById('closed-accounts-checkbox-agr-rrsp');
    const dpspCheckbox = document.getElementById('closed-accounts-checkbox-agr-dpsp');
    expect(rrspCheckbox.checked).toBe(true);
    expect(dpspCheckbox.checked).toBe(true);
    expect(document.getElementById('closed-accounts-meta-agr-rrsp').textContent).toContain('Monarch: Amazon RRSP');
    expect(document.getElementById('closed-accounts-meta-agr-dpsp').textContent).toContain('Not mapped to Monarch');

    const monarchCheckbox = document.getElementById('closed-accounts-monarch-checkbox');
    expect(monarchCheckbox).toBeTruthy();
    expect(monarchCheckbox.checked).toBe(true);

    document.getElementById('closed-accounts-dialog-confirm-button').click();
    const result = await promise;
    expect(result).toEqual({
      confirmed: true,
      selectedAccountIds: ['agr-rrsp', 'agr-dpsp'],
      closeInMonarch: true,
      closedDate: '2026-11-24',
    });
    expect(document.getElementById('closed-accounts-dialog-overlay')).toBeNull();
  });

  test('hides Monarch close option when no candidates have a Monarch mapping and allows editing closure date', async () => {
    const promise = showClosedAccountsDialog({
      title: 'Closed Accounts',
      description: 'Missing',
      accounts: [SAMPLE_ACCOUNTS[1]],
      defaultClosedDate: '2026-11-24',
    });

    expect(document.getElementById('closed-accounts-monarch-option')).toBeNull();

    const dateInput = document.getElementById('closed-accounts-date-input');
    dateInput.value = '2026-11-22';
    dateInput.dispatchEvent(new Event('change'));

    document.getElementById('closed-accounts-dialog-confirm-button').click();
    const result = await promise;
    expect(result).toEqual({
      confirmed: true,
      selectedAccountIds: ['agr-dpsp'],
      closeInMonarch: false,
      closedDate: '2026-11-22',
    });
  });

  test('disables confirm button when all accounts unchecked or closure date cleared', async () => {
    const promise = showClosedAccountsDialog({
      title: 'Closed Accounts',
      description: 'Missing',
      accounts: SAMPLE_ACCOUNTS,
      defaultClosedDate: '2026-11-24',
    });

    const rrspCheckbox = document.getElementById('closed-accounts-checkbox-agr-rrsp');
    const dpspCheckbox = document.getElementById('closed-accounts-checkbox-agr-dpsp');
    const dateInput = document.getElementById('closed-accounts-date-input');
    const confirmBtn = document.getElementById('closed-accounts-dialog-confirm-button');
    const monarchCheckbox = document.getElementById('closed-accounts-monarch-checkbox');

    rrspCheckbox.checked = false;
    rrspCheckbox.dispatchEvent(new Event('change'));
    dpspCheckbox.checked = false;
    dpspCheckbox.dispatchEvent(new Event('change'));
    expect(confirmBtn.disabled).toBe(true);

    dpspCheckbox.checked = true;
    dpspCheckbox.dispatchEvent(new Event('change'));
    expect(confirmBtn.disabled).toBe(false);

    dateInput.value = '';
    dateInput.dispatchEvent(new Event('input'));
    expect(confirmBtn.disabled).toBe(true);

    dateInput.value = '2026-11-25';
    dateInput.dispatchEvent(new Event('input'));
    expect(confirmBtn.disabled).toBe(false);

    monarchCheckbox.checked = false;
    confirmBtn.click();

    const result = await promise;
    expect(result).toEqual({
      confirmed: true,
      selectedAccountIds: ['agr-dpsp'],
      closeInMonarch: false,
      closedDate: '2026-11-25',
    });
  });

  test('resolves as cancelled on Skip button, backdrop click, and Escape key', async () => {
    const expectedCancel = {
      confirmed: false,
      selectedAccountIds: [],
      closeInMonarch: false,
      closedDate: '',
    };

    const p1 = showClosedAccountsDialog({
      title: 'Closed Accounts',
      description: 'Missing',
      accounts: SAMPLE_ACCOUNTS,
      defaultClosedDate: '2026-11-24',
    });
    document.getElementById('closed-accounts-dialog-skip-button').click();
    expect(await p1).toEqual(expectedCancel);

    const p2 = showClosedAccountsDialog({
      title: 'Closed Accounts',
      description: 'Missing',
      accounts: SAMPLE_ACCOUNTS,
      defaultClosedDate: '2026-11-24',
    });
    const overlay = document.getElementById('closed-accounts-dialog-overlay');
    overlay.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(await p2).toEqual(expectedCancel);

    const p3 = showClosedAccountsDialog({
      title: 'Closed Accounts',
      description: 'Missing',
      accounts: SAMPLE_ACCOUNTS,
      defaultClosedDate: '2026-11-24',
    });
    const overlay3 = document.getElementById('closed-accounts-dialog-overlay');
    overlay3.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(await p3).toEqual(expectedCancel);
  });

  test('omits shortName parenthetical when matching name, omits lastSyncDate when absent, and guards invalid/duplicate settlement', async () => {
    const promise = showClosedAccountsDialog({
      title: 'Closed Accounts',
      description: 'Missing',
      accounts: [
        {
          id: 'agr-plain',
          name: 'RRSP',
          shortName: 'RRSP',
          monarchAccountName: null,
          lastSyncDate: null,
        },
      ],
      defaultClosedDate: '2026-11-24',
    });

    expect(document.getElementById('closed-accounts-name-agr-plain').textContent).toBe('RRSP');
    expect(document.getElementById('closed-accounts-meta-agr-plain').textContent).toBe('Not mapped to Monarch');

    const dateInput = document.getElementById('closed-accounts-date-input');
    const confirmBtn = document.getElementById('closed-accounts-dialog-confirm-button');
    dateInput.value = 'invalid';
    dateInput.dispatchEvent(new Event('input'));
    expect(confirmBtn.disabled).toBe(true);

    // Force-enable button to exercise handleConfirm defensive validation guard
    confirmBtn.disabled = false;
    confirmBtn.click();
    expect(document.getElementById('closed-accounts-dialog-overlay')).toBeTruthy();

    const overlay = document.getElementById('closed-accounts-dialog-overlay');
    document.getElementById('closed-accounts-dialog-skip-button').click();
    // Second settlement attempt on detached overlay is a no-op
    overlay.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(await promise).toEqual({
      confirmed: false,
      selectedAccountIds: [],
      closeInMonarch: false,
      closedDate: '',
    });
  });
});
