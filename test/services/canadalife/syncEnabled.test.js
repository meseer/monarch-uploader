/**
 * Tests for syncEnabled flag enforcement in Canada Life upload flow
 */

import { jest } from '@jest/globals';
import '../../setup';

jest.mock('../../../src/core/config', () => ({
  STORAGE: {},
  LOGO_CLOUDINARY_IDS: { CANADALIFE: 'canadalife-logo' },
  TRANSACTION_RETENTION_DEFAULTS: { DAYS: 91, COUNT: 1000 },
  INTEGRATIONS: { CANADALIFE: 'canadalife' },
}));

jest.mock('../../../src/services/common/accountService', () => ({
  __esModule: true,
  default: {
    getAccountData: jest.fn(),
    getMonarchAccountMapping: jest.fn(),
    upsertAccount: jest.fn(),
    updateAccountInList: jest.fn(),
    cleanupLegacyStorage: jest.fn(() => ({ cleaned: true, keysDeleted: 0, keys: [] })),
  },
}));

jest.mock('../../../src/core/utils', () => ({
  debugLog: jest.fn(),
  formatDate: jest.fn((date) => {
    if (date instanceof Date && !Number.isNaN(date.getTime())) {
      return date.toISOString().split('T')[0];
    }
    return 'Invalid Date';
  }),
  getTodayLocal: jest.fn(() => '2024-01-15'),
  getYesterdayLocal: jest.fn(() => '2024-01-14'),
  formatDaysAgoLocal: jest.fn(() => '2024-01-01'),
  parseLocalDate: jest.fn((s) => new Date(s)),
  calculateFromDateWithLookback: jest.fn(() => '2024-01-01'),
  saveLastUploadDate: jest.fn(),
  getLastUpdateDate: jest.fn(() => '2024-01-01'),
}));

jest.mock('../../../src/core/state', () => ({
  __esModule: true,
  default: {
    getState: jest.fn(() => ({ currentAccount: { nickname: 'Test', name: 'Test' } })),
    setAccount: jest.fn(),
  },
}));

jest.mock('../../../src/api/canadalife', () => ({
  __esModule: true,
  default: {
    loadCanadaLifeAccounts: jest.fn(),
    loadAccountBalanceHistory: jest.fn(),
  },
}));

jest.mock('../../../src/api/monarch', () => ({
  __esModule: true,
  default: {
    listAccounts: jest.fn(),
    uploadBalance: jest.fn(),
    uploadTransactions: jest.fn(),
    validateAndRefreshAccountMapping: jest.fn(),
    setAccountLogo: jest.fn(),
  },
}));

jest.mock('../../../src/ui/toast', () => ({
  __esModule: true,
  default: { show: jest.fn() },
}));

jest.mock('../../../src/ui/components/progressDialog', () => ({
  showProgressDialog: jest.fn(),
}));

jest.mock('../../../src/ui/components/datePicker', () => ({
  showDatePickerPromise: jest.fn(),
}));

jest.mock('../../../src/ui/components/accountSelectorWithCreate', () => ({
  showMonarchAccountSelectorWithCreate: jest.fn(),
}));

jest.mock('../../../src/ui/components/monarchLoginLink', () => ({
  ensureMonarchAuthentication: jest.fn(),
}));

jest.mock('../../../src/services/canadalife/transactions', () => ({
  fetchAndProcessTransactions: jest.fn().mockResolvedValue([]),
  convertTransactionsToCSV: jest.fn().mockReturnValue(''),
}));

globalThis.GM_getValue = jest.fn();
globalThis.GM_setValue = jest.fn();

// eslint-disable-next-line import/first
import { uploadAllCanadaLifeAccountsToMonarch } from '../../../src/services/canadalife-upload';

const { showProgressDialog } = require('../../../src/ui/components/progressDialog');
const { ensureMonarchAuthentication } = require('../../../src/ui/components/monarchLoginLink');
const canadalife = require('../../../src/api/canadalife').default;
const monarchApi = require('../../../src/api/monarch').default;
const accountService = require('../../../src/services/common/accountService').default;

// Helpers
function makeProgressDialog() {
  return {
    updateProgress: jest.fn(),
    updateBalanceChange: jest.fn(),
    hideCancel: jest.fn(),
    showSummary: jest.fn(),
    showError: jest.fn().mockResolvedValue(undefined),
    onCancel: jest.fn(),
    initSteps: jest.fn(),
    updateStepStatus: jest.fn(),
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
  jest.clearAllMocks();
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