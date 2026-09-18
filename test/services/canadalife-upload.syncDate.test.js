/**
 * Regression tests for Canada Life sync-date (watermark) advancement.
 *
 * The auto-upload path must only advance lastSyncDate over a window whose transactions
 * actually reached Monarch. Canada Life's default lookback is 1 day, so a watermark
 * advanced past a failed transaction upload makes the next sync start after those
 * transactions - and because a failed upload never writes the dedup store, nothing would
 * ever re-upload them: they would be permanently missing from Monarch.
 */

import { jest } from '@jest/globals';
import '../setup';

jest.mock('../../src/core/config', () => ({
  LOGO_CLOUDINARY_IDS: { CANADALIFE: 'canadalife-logo' },
  TRANSACTION_RETENTION_DEFAULTS: { DAYS: 91, COUNT: 1000 },
  STORAGE: {},
  CARDHOLDER: {
    SHARED_OWNER: 'Shared',
    OWNER_MODE: { OFF: 'off', ON: 'on' },
    TAG_MODE: { OFF: 'off', AUTO: 'auto', ALWAYS: 'always' },
  },
}));

jest.mock('../../src/core/integrationCapabilities', () => ({
  INTEGRATIONS: { CANADALIFE: 'canadalife' },
  ACCOUNT_SETTINGS: { INCLUDE_PENDING_TRANSACTIONS: 'includePendingTransactions' },
}));

jest.mock('../../src/core/utils', () => ({
  debugLog: jest.fn(),
  formatDate: jest.fn((date) => date.toISOString().split('T')[0]),
  getTodayLocal: jest.fn(() => '2024-01-15'),
  getYesterdayLocal: jest.fn(() => '2024-01-14'),
  formatDaysAgoLocal: jest.fn(() => '2023-10-17'),
  parseLocalDate: jest.fn((dateString) => {
    const [year, month, day] = dateString.split('-').map(Number);
    return new Date(year, month - 1, day);
  }),
  calculateFromDateWithLookback: jest.fn(() => '2024-01-14'),
  saveLastUploadDate: jest.fn(),
  computeExtendedFromDate: jest.fn((startDate) => startDate),
}));

jest.mock('../../src/core/state', () => ({
  __esModule: true,
  default: {
    setAccount: jest.fn(),
    getState: jest.fn(() => ({ currentAccount: { nickname: 'Test RRSP' } })),
  },
}));

jest.mock('../../src/api/canadalife', () => ({
  __esModule: true,
  default: {
    loadCanadaLifeAccounts: jest.fn(),
    loadAccountBalanceHistory: jest.fn(),
  },
}));

jest.mock('../../src/api/monarch', () => ({
  __esModule: true,
  default: {
    uploadBalance: jest.fn(),
    uploadTransactions: jest.fn(),
    listAccounts: jest.fn(),
    validateAndRefreshAccountMapping: jest.fn(),
    setAccountLogo: jest.fn(),
  },
}));

jest.mock('../../src/ui/toast', () => ({
  __esModule: true,
  default: { show: jest.fn() },
}));

jest.mock('../../src/ui/components/progressDialog', () => ({
  showProgressDialog: jest.fn(),
}));

jest.mock('../../src/ui/components/datePicker', () => ({
  showDatePickerPromise: jest.fn(),
}));

jest.mock('../../src/ui/components/accountSelectorWithCreate', () => ({
  showMonarchAccountSelectorWithCreate: jest.fn(),
}));

jest.mock('../../src/ui/components/monarchLoginLink', () => ({
  ensureMonarchAuthentication: jest.fn(),
}));

jest.mock('../../src/services/common/accountService', () => ({
  __esModule: true,
  default: {
    getAccountData: jest.fn(),
    getMonarchAccountMapping: jest.fn(),
    upsertAccount: jest.fn(),
    updateAccountInList: jest.fn(),
    cleanupLegacyStorage: jest.fn(() => ({ keysDeleted: 0, keys: [] })),
  },
}));

jest.mock('../../src/services/canadalife/transactions', () => ({
  fetchActivitiesForDateRange: jest.fn(),
  processActivities: jest.fn(),
  fetchAndProcessTransactions: jest.fn(),
}));

jest.mock('../../src/services/canadalife/csvFormatter', () => ({
  convertCanadaLifeTransactionsToMonarchCSV: jest.fn(() => '"Date","Merchant"\n"2024-01-15","Deposit"\n'),
}));

jest.mock('../../src/services/canadalife/pendingReconciliation', () => ({
  reconcileCanadaLifeFetchedPending: jest.fn(),
  formatReconciliationMessage: jest.fn(() => 'No pending'),
}));

jest.mock('../../src/services/common/pendingReconciliation', () => ({
  fetchMonarchPendingTransactions: jest.fn(),
}));

globalThis.GM_getValue = jest.fn();
globalThis.GM_setValue = jest.fn();

// eslint-disable-next-line import/first
import { uploadAllCanadaLifeAccountsToMonarch } from '../../src/services/canadalife-upload';

const utils = require('../../src/core/utils');
const canadalifeApi = require('../../src/api/canadalife').default;
const monarchApi = require('../../src/api/monarch').default;
const accountService = require('../../src/services/common/accountService').default;
const clTransactions = require('../../src/services/canadalife/transactions');
const { showProgressDialog } = require('../../src/ui/components/progressDialog');
const { ensureMonarchAuthentication } = require('../../src/ui/components/monarchLoginLink');
const { fetchMonarchPendingTransactions } = require('../../src/services/common/pendingReconciliation');

const ACCOUNT_ID = 'agreement-1';
const END_DATE = '2024-01-15';

// Single place defining the fetchActivitiesForDateRange return value, so the shape only
// has to be updated here if the activity fetch contract changes.
function makeActivityFetchResult() {
  return [{ id: 'act-1', date: '2024-01-15', amount: 100 }];
}

function makeProgressDialog() {
  return {
    updateProgress: jest.fn(),
    updateBalanceChange: jest.fn(),
    updateStepStatus: jest.fn(),
    initSteps: jest.fn(),
    hideCancel: jest.fn(),
    showSummary: jest.fn(),
    showError: jest.fn().mockResolvedValue(undefined),
    onCancel: jest.fn(),
    close: jest.fn(),
  };
}

let dialog;

beforeEach(() => {
  jest.clearAllMocks();

  dialog = makeProgressDialog();
  showProgressDialog.mockReturnValue(dialog);
  ensureMonarchAuthentication.mockResolvedValue(true);

  canadalifeApi.loadCanadaLifeAccounts.mockResolvedValue([
    {
      canadalifeAccount: {
        id: ACCOUNT_ID,
        agreementId: ACCOUNT_ID,
        EnglishShortName: 'RRSP',
        LongNameEnglish: 'Test RRSP',
        EnrollmentDate: '2020-01-01',
      },
      monarchAccount: { id: 'monarch-1', displayName: 'Monarch RRSP' },
      syncEnabled: true,
    },
  ]);

  canadalifeApi.loadAccountBalanceHistory.mockResolvedValue({
    data: [
      ['Date', 'Balance', 'Account Name'],
      ['2024-01-15', '10000.00', 'Test RRSP'],
    ],
  });

  accountService.getMonarchAccountMapping.mockReturnValue({ id: 'monarch-1', displayName: 'Monarch RRSP' });
  accountService.getAccountData.mockReturnValue({ uploadedTransactions: [] });
  monarchApi.validateAndRefreshAccountMapping.mockResolvedValue({
    valid: true,
    account: { id: 'monarch-1', displayName: 'Monarch RRSP' },
  });
  monarchApi.uploadBalance.mockResolvedValue(true);
  monarchApi.uploadTransactions.mockResolvedValue(true);

  fetchMonarchPendingTransactions.mockResolvedValue({
    noPendingTag: true,
    noPendingTransactions: true,
    oldestPendingDate: null,
    pendingTag: null,
    monarchPendingTransactions: [],
  });

  clTransactions.fetchActivitiesForDateRange.mockResolvedValue(makeActivityFetchResult());
  clTransactions.processActivities.mockResolvedValue([
    { id: 'cl-tx-1', date: '2024-01-15', amount: 100, description: 'Deposit' },
  ]);
});

describe('uploadAllCanadaLifeAccountsToMonarch — sync date advancement', () => {
  test('advances the sync date when the transaction upload succeeds', async () => {
    await uploadAllCanadaLifeAccountsToMonarch();

    expect(monarchApi.uploadTransactions).toHaveBeenCalled();
    expect(utils.saveLastUploadDate).toHaveBeenCalledWith(ACCOUNT_ID, END_DATE, 'canadalife');
  });

  test('does NOT advance the sync date when the transaction upload fails', async () => {
    monarchApi.uploadTransactions.mockResolvedValue(false);

    await uploadAllCanadaLifeAccountsToMonarch();

    // The window must stay open: these transactions were never stored for dedup either
    expect(utils.saveLastUploadDate).not.toHaveBeenCalled();
  });

  test('reports the account as failed rather than successful when the upload fails', async () => {
    monarchApi.uploadTransactions.mockResolvedValue(false);

    await uploadAllCanadaLifeAccountsToMonarch();

    expect(dialog.showSummary).toHaveBeenCalledWith(
      expect.objectContaining({ success: 0, failed: 1 }),
    );
    expect(dialog.updateProgress).toHaveBeenCalledWith(
      ACCOUNT_ID,
      'error',
      'Transaction upload failed - will retry next sync',
    );
  });

  test('marks the transaction step as an error in the progress dialog', async () => {
    monarchApi.uploadTransactions.mockResolvedValue(false);

    await uploadAllCanadaLifeAccountsToMonarch();

    expect(dialog.updateStepStatus).toHaveBeenCalledWith(
      ACCOUNT_ID,
      'uploadTransactions',
      'error',
      'Upload failed',
    );
  });

  test('does not store uploaded transaction ids when the upload fails', async () => {
    monarchApi.uploadTransactions.mockResolvedValue(false);

    await uploadAllCanadaLifeAccountsToMonarch();

    const savedDedup = accountService.updateAccountInList.mock.calls
      .filter(([, , fields]) => fields && 'uploadedTransactions' in fields);
    expect(savedDedup).toHaveLength(0);
  });

  test('does not clean up legacy storage when the upload fails', async () => {
    monarchApi.uploadTransactions.mockResolvedValue(false);

    await uploadAllCanadaLifeAccountsToMonarch();

    expect(accountService.cleanupLegacyStorage).not.toHaveBeenCalled();
  });

  test('still advances the sync date when there are no new transactions to upload', async () => {
    clTransactions.processActivities.mockResolvedValue([]);

    await uploadAllCanadaLifeAccountsToMonarch();

    // Nothing to upload is not a failure - the window was fully processed
    expect(monarchApi.uploadTransactions).not.toHaveBeenCalled();
    expect(utils.saveLastUploadDate).toHaveBeenCalledWith(ACCOUNT_ID, END_DATE, 'canadalife');
  });

  test('does not advance the sync date when the balance upload fails', async () => {
    monarchApi.uploadBalance.mockResolvedValue(false);

    await uploadAllCanadaLifeAccountsToMonarch();

    expect(utils.saveLastUploadDate).not.toHaveBeenCalled();
  });
});
