/**
 * Tests for syncEnabled flag enforcement in Canada Life upload flow
 */

import '../../setup';

vi.mock('../../../src/core/config', () => ({
  CARDHOLDER: {
    SHARED_OWNER: 'Shared',
    OWNER_MODE: { OFF: 'off', ON: 'on' },
    TAG_MODE: { OFF: 'off', AUTO: 'auto', ALWAYS: 'always' },
  },
  STORAGE: {},
  LOGO_CLOUDINARY_IDS: { CANADALIFE: 'canadalife-logo' },
  TRANSACTION_RETENTION_DEFAULTS: { DAYS: 91, COUNT: 1000 },
  INTEGRATIONS: { CANADALIFE: 'canadalife' },
}));

vi.mock('../../../src/services/common/accountService', () => ({
  __esModule: true,
  default: {
    getAccountData: vi.fn(),
    getMonarchAccountMapping: vi.fn(),
    upsertAccount: vi.fn(),
    updateAccountInList: vi.fn(),
    cleanupLegacyStorage: vi.fn(() => ({ cleaned: true, keysDeleted: 0, keys: [] })),
  },
}));

vi.mock('../../../src/core/utils', () => ({
  debugLog: vi.fn(),
  formatDate: vi.fn((date) => {
    if (date instanceof Date && !Number.isNaN(date.getTime())) {
      return date.toISOString().split('T')[0];
    }
    return 'Invalid Date';
  }),
  getTodayLocal: vi.fn(() => '2024-01-15'),
  getYesterdayLocal: vi.fn(() => '2024-01-14'),
  formatDaysAgoLocal: vi.fn(() => '2024-01-01'),
  parseLocalDate: vi.fn((s) => new Date(s)),
  calculateFromDateWithLookback: vi.fn(() => '2024-01-01'),
  saveLastUploadDate: vi.fn(),
  getLastUpdateDate: vi.fn(() => '2024-01-01'),
}));

vi.mock('../../../src/core/state', () => ({
  __esModule: true,
  default: {
    getState: vi.fn(() => ({ currentAccount: { nickname: 'Test', name: 'Test' } })),
    setAccount: vi.fn(),
  },
}));

vi.mock('../../../src/api/canadalife', () => ({
  __esModule: true,
  default: {
    loadCanadaLifeAccounts: vi.fn(),
    loadAccountBalanceHistory: vi.fn(),
  },
}));

vi.mock('../../../src/api/monarch', () => ({
  __esModule: true,
  default: {
    listAccounts: vi.fn(),
    uploadBalance: vi.fn(),
    uploadTransactions: vi.fn(),
    validateAndRefreshAccountMapping: vi.fn(),
    setAccountLogo: vi.fn(),
  },
}));

vi.mock('../../../src/ui/toast', () => ({
  __esModule: true,
  default: { show: vi.fn() },
}));

vi.mock('../../../src/ui/components/progressDialog', () => ({
  showProgressDialog: vi.fn(),
}));

vi.mock('../../../src/ui/components/datePicker', () => ({
  showDatePickerPromise: vi.fn(),
}));

vi.mock('../../../src/ui/components/accountSelectorWithCreate', () => ({
  showMonarchAccountSelectorWithCreate: vi.fn(),
}));

vi.mock('../../../src/ui/components/monarchLoginLink', () => ({
  ensureMonarchAuthentication: vi.fn(),
}));

vi.mock('../../../src/services/canadalife/transactions', () => ({
  fetchAndProcessTransactions: vi.fn().mockResolvedValue([]),
  convertTransactionsToCSV: vi.fn().mockReturnValue(''),
}));

globalThis.GM_getValue = vi.fn();
globalThis.GM_setValue = vi.fn();

// eslint-disable-next-line import/first
import { uploadAllCanadaLifeAccountsToMonarch } from '../../../src/services/canadalife-upload';

import { showProgressDialog } from '../../../src/ui/components/progressDialog';
import { ensureMonarchAuthentication } from '../../../src/ui/components/monarchLoginLink';
import canadalife from '../../../src/api/canadalife';
import monarchApi from '../../../src/api/monarch';
import accountService from '../../../src/services/common/accountService';

// Helpers
function makeProgressDialog() {
  return {
    updateProgress: vi.fn(),
    updateBalanceChange: vi.fn(),
    hideCancel: vi.fn(),
    showSummary: vi.fn(),
    showError: vi.fn().mockResolvedValue(undefined),
    onCancel: vi.fn(),
    initSteps: vi.fn(),
    updateStepStatus: vi.fn(),
  };
}

function makeConsolidatedAccount(agreementId, syncEnabled = true) {
  return {
    canadalifeAccount: {
      agreementId,
      EnglishShortName: `Fund ${agreementId}`,
      LongNameEnglish: `Long Fund ${agreementId}`,
      EnrollmentDate: '2020-01-01T00:00:00',
    },
    monarchAccount: { id: `monarch-${agreementId}`, displayName: `Monarch ${agreementId}` },
    syncEnabled,
  };
}

function makeBalanceHistoryData() {
  return {
    data: [
      ['Date', 'Balance', 'Account'],
      ['2024-01-01', '10000', 'Fund A'],
      ['2024-01-15', '10500', 'Fund A'],
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  ensureMonarchAuthentication.mockResolvedValue(true);
  monarchApi.uploadBalance.mockResolvedValue(true);
  monarchApi.uploadTransactions.mockResolvedValue(true);
  monarchApi.validateAndRefreshAccountMapping.mockResolvedValue({
    valid: true,
    account: { id: 'monarch-acc1', displayName: 'Monarch Acc' },
  });
  canadalife.loadAccountBalanceHistory.mockResolvedValue(makeBalanceHistoryData());
  accountService.getMonarchAccountMapping.mockReturnValue({ id: 'monarch-acc1', displayName: 'Monarch Acc' });
  accountService.getAccountData.mockReturnValue({ uploadedTransactions: [] });
});

describe('uploadAllCanadaLifeAccountsToMonarch — syncEnabled skip', () => {
  test('skips account with syncEnabled: false and marks it as skipped in progress dialog', async () => {
    const disabledAccount = makeConsolidatedAccount('agr001', false);
    canadalife.loadCanadaLifeAccounts.mockResolvedValue([disabledAccount]);

    const dialog = makeProgressDialog();
    showProgressDialog.mockReturnValue(dialog);

    await uploadAllCanadaLifeAccountsToMonarch();

    expect(dialog.updateProgress).toHaveBeenCalledWith('agr001', 'skipped', 'Sync disabled');
    expect(canadalife.loadAccountBalanceHistory).not.toHaveBeenCalled();
    expect(monarchApi.uploadBalance).not.toHaveBeenCalled();
  });

  test('processes account with syncEnabled: true normally', async () => {
    const enabledAccount = makeConsolidatedAccount('agr002', true);
    canadalife.loadCanadaLifeAccounts.mockResolvedValue([enabledAccount]);

    const dialog = makeProgressDialog();
    showProgressDialog.mockReturnValue(dialog);

    await uploadAllCanadaLifeAccountsToMonarch();

    expect(canadalife.loadAccountBalanceHistory).toHaveBeenCalled();
    expect(monarchApi.uploadBalance).toHaveBeenCalled();
    expect(dialog.updateProgress).not.toHaveBeenCalledWith('agr002', 'skipped', 'Sync disabled');
  });

  test('skips disabled account but processes enabled account in same batch', async () => {
    canadalife.loadCanadaLifeAccounts.mockResolvedValue([
      makeConsolidatedAccount('disabled1', false),
      makeConsolidatedAccount('enabled2', true),
    ]);
    // Return different mappings for each account
    accountService.getMonarchAccountMapping.mockImplementation((integration, accountId) => ({
      id: `monarch-${accountId}`,
      displayName: `Monarch ${accountId}`,
    }));
    monarchApi.validateAndRefreshAccountMapping.mockResolvedValue({
      valid: true,
      account: { id: 'monarch-enabled2', displayName: 'Monarch enabled2' },
    });

    const dialog = makeProgressDialog();
    showProgressDialog.mockReturnValue(dialog);

    await uploadAllCanadaLifeAccountsToMonarch();

    // disabled1 should be skipped
    expect(dialog.updateProgress).toHaveBeenCalledWith('disabled1', 'skipped', 'Sync disabled');

    // enabled2 should be processed
    expect(canadalife.loadAccountBalanceHistory).toHaveBeenCalledTimes(1);
    expect(monarchApi.uploadBalance).toHaveBeenCalledTimes(1);
  });

  test('account with syncEnabled absent (undefined) is treated as enabled', async () => {
    const accountWithoutFlag = makeConsolidatedAccount('agr003', true);
    delete accountWithoutFlag.syncEnabled; // Remove the flag entirely
    canadalife.loadCanadaLifeAccounts.mockResolvedValue([accountWithoutFlag]);

    const dialog = makeProgressDialog();
    showProgressDialog.mockReturnValue(dialog);

    await uploadAllCanadaLifeAccountsToMonarch();

    expect(dialog.updateProgress).not.toHaveBeenCalledWith('agr003', 'skipped', 'Sync disabled');
    expect(canadalife.loadAccountBalanceHistory).toHaveBeenCalled();
  });

  test('decrements total count for skipped accounts', async () => {
    canadalife.loadCanadaLifeAccounts.mockResolvedValue([
      makeConsolidatedAccount('disabled1', false),
      makeConsolidatedAccount('enabled2', true),
    ]);
    monarchApi.validateAndRefreshAccountMapping.mockResolvedValue({
      valid: true,
      account: { id: 'monarch-enabled2', displayName: 'Monarch enabled2' },
    });

    const dialog = makeProgressDialog();
    showProgressDialog.mockReturnValue(dialog);

    await uploadAllCanadaLifeAccountsToMonarch();

    // showSummary should be called with total=1 (one account removed from total)
    expect(dialog.showSummary).toHaveBeenCalledWith(
      expect.objectContaining({ total: 1 }),
    );
  });
});