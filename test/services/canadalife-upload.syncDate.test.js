/**
 * Regression tests for Canada Life sync-date (watermark) advancement.
 *
 * The auto-upload path must only advance lastSyncDate over a window whose transactions
 * actually reached Monarch. Canada Life's default lookback is 1 day, so a watermark
 * advanced past a failed transaction upload makes the next sync start after those
 * transactions - and because a failed upload never writes the dedup store, nothing would
 * ever re-upload them: they would be permanently missing from Monarch.
 */

import '../setup';

vi.mock('../../src/core/config', () => ({
  LOGO_CLOUDINARY_IDS: { CANADALIFE: 'canadalife-logo' },
  TRANSACTION_RETENTION_DEFAULTS: { DAYS: 91, COUNT: 1000 },
  STORAGE: {},
  CARDHOLDER: {
    SHARED_OWNER: 'Shared',
    OWNER_MODE: { OFF: 'off', ON: 'on' },
    TAG_MODE: { OFF: 'off', AUTO: 'auto', ALWAYS: 'always' },
  },
}));

vi.mock('../../src/core/integrationCapabilities', () => ({
  INTEGRATIONS: { CANADALIFE: 'canadalife' },
  ACCOUNT_SETTINGS: { INCLUDE_PENDING_TRANSACTIONS: 'includePendingTransactions' },
}));

vi.mock('../../src/core/utils', () => ({
  debugLog: vi.fn(),
  formatDate: vi.fn((date) => date.toISOString().split('T')[0]),
  getTodayLocal: vi.fn(() => '2024-01-15'),
  getYesterdayLocal: vi.fn(() => '2024-01-14'),
  formatDaysAgoLocal: vi.fn(() => '2023-10-17'),
  parseLocalDate: vi.fn((dateString) => {
    const [year, month, day] = dateString.split('-').map(Number);
    return new Date(year, month - 1, day);
  }),
  calculateFromDateWithLookback: vi.fn(() => '2024-01-14'),
  saveLastUploadDate: vi.fn(),
  computeExtendedFromDate: vi.fn((startDate) => startDate),
}));

vi.mock('../../src/core/state', () => ({
  __esModule: true,
  default: {
    setAccount: vi.fn(),
    getState: vi.fn(() => ({ currentAccount: { nickname: 'Test RRSP' } })),
  },
}));

vi.mock('../../src/api/canadalife', () => ({
  __esModule: true,
  default: {
    loadCanadaLifeAccounts: vi.fn(),
    loadAccountBalanceHistory: vi.fn(),
  },
}));

vi.mock('../../src/api/monarch', () => ({
  __esModule: true,
  default: {
    uploadBalance: vi.fn(),
    uploadTransactions: vi.fn(),
    listAccounts: vi.fn(),
    validateAndRefreshAccountMapping: vi.fn(),
    setAccountLogo: vi.fn(),
  },
}));

vi.mock('../../src/ui/toast', () => ({
  __esModule: true,
  default: { show: vi.fn() },
}));

vi.mock('../../src/ui/components/progressDialog', () => ({
  showProgressDialog: vi.fn(),
}));

vi.mock('../../src/ui/components/datePicker', () => ({
  showDatePickerPromise: vi.fn(),
}));

vi.mock('../../src/ui/components/accountSelectorWithCreate', () => ({
  showMonarchAccountSelectorWithCreate: vi.fn(),
}));

vi.mock('../../src/ui/components/monarchLoginLink', () => ({
  ensureMonarchAuthentication: vi.fn(),
}));

vi.mock('../../src/services/common/accountService', () => ({
  __esModule: true,
  default: {
    getAccountData: vi.fn(),
    getMonarchAccountMapping: vi.fn(),
    upsertAccount: vi.fn(),
    updateAccountInList: vi.fn(),
    cleanupLegacyStorage: vi.fn(() => ({ keysDeleted: 0, keys: [] })),
  },
}));

vi.mock('../../src/services/canadalife/transactions', () => ({
  fetchActivitiesForDateRange: vi.fn(),
  processActivities: vi.fn(),
  fetchAndProcessTransactions: vi.fn(),
}));

vi.mock('../../src/services/canadalife/csvFormatter', () => ({
  convertCanadaLifeTransactionsToMonarchCSV: vi.fn(() => '"Date","Merchant"\n"2024-01-15","Deposit"\n'),
}));

vi.mock('../../src/services/canadalife/pendingReconciliation', () => ({
  reconcileCanadaLifeFetchedPending: vi.fn(),
  formatReconciliationMessage: vi.fn(() => 'No pending'),
}));

vi.mock('../../src/services/common/pendingReconciliation', () => ({
  fetchMonarchPendingTransactions: vi.fn(),
}));

globalThis.GM_getValue = vi.fn();
globalThis.GM_setValue = vi.fn();

// eslint-disable-next-line import/first
import { uploadAllCanadaLifeAccountsToMonarch } from '../../src/services/canadalife-upload';

import * as utils from '../../src/core/utils';
import canadalifeApi from '../../src/api/canadalife';
import monarchApi from '../../src/api/monarch';
import accountService from '../../src/services/common/accountService';
import * as clTransactions from '../../src/services/canadalife/transactions';
import { showProgressDialog } from '../../src/ui/components/progressDialog';
import { ensureMonarchAuthentication } from '../../src/ui/components/monarchLoginLink';
import { fetchMonarchPendingTransactions } from '../../src/services/common/pendingReconciliation';

const ACCOUNT_ID = 'agreement-1';
const END_DATE = '2024-01-15';

// Single place defining the fetchActivitiesForDateRange return value, so the shape only
// has to be updated here if the activity fetch contract changes.
function makeActivityFetchResult({ complete = true, failedChunks = [] } = {}) {
  return {
    activities: [{ id: 'act-1', date: '2024-01-15', amount: 100 }],
    complete,
    failedChunks,
  };
}

function makeProgressDialog() {
  return {
    updateProgress: vi.fn(),
    updateBalanceChange: vi.fn(),
    updateStepStatus: vi.fn(),
    initSteps: vi.fn(),
    hideCancel: vi.fn(),
    showSummary: vi.fn(),
    showError: vi.fn().mockResolvedValue(undefined),
    onCancel: vi.fn(),
    close: vi.fn(),
  };
}

let dialog;

beforeEach(() => {
  vi.clearAllMocks();

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
      'Transactions incomplete - will retry next sync',
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

describe('uploadAllCanadaLifeAccountsToMonarch — incomplete activity fetch', () => {
  const INCOMPLETE = {
    complete: false,
    failedChunks: [{ start: '2024-01-01', end: '2024-01-14', error: 'HTTP 500' }],
  };

  test('does NOT advance the sync date when a chunk of the activity fetch failed', async () => {
    clTransactions.fetchActivitiesForDateRange.mockResolvedValue(makeActivityFetchResult(INCOMPLETE));

    await uploadAllCanadaLifeAccountsToMonarch();

    // Transactions in the failed chunk were never fetched, so they are neither in Monarch
    // nor in the dedup store - only a re-fetch of this window can recover them
    expect(utils.saveLastUploadDate).not.toHaveBeenCalled();
  });

  test('does NOT advance the sync date even when the upload of the partial data succeeded', async () => {
    clTransactions.fetchActivitiesForDateRange.mockResolvedValue(makeActivityFetchResult(INCOMPLETE));
    monarchApi.uploadTransactions.mockResolvedValue(true);

    await uploadAllCanadaLifeAccountsToMonarch();

    expect(monarchApi.uploadTransactions).toHaveBeenCalled();
    expect(utils.saveLastUploadDate).not.toHaveBeenCalled();
  });

  test('reports the account as failed when the activity fetch was incomplete', async () => {
    clTransactions.fetchActivitiesForDateRange.mockResolvedValue(makeActivityFetchResult(INCOMPLETE));

    await uploadAllCanadaLifeAccountsToMonarch();

    expect(dialog.showSummary).toHaveBeenCalledWith(
      expect.objectContaining({ success: 0, failed: 1 }),
    );
  });

  test('does not clean up legacy storage when the activity fetch was incomplete', async () => {
    clTransactions.fetchActivitiesForDateRange.mockResolvedValue(makeActivityFetchResult(INCOMPLETE));

    await uploadAllCanadaLifeAccountsToMonarch();

    expect(accountService.cleanupLegacyStorage).not.toHaveBeenCalled();
  });

  test('advances the sync date when the fetch reports itself complete', async () => {
    clTransactions.fetchActivitiesForDateRange.mockResolvedValue(
      makeActivityFetchResult({ complete: true, failedChunks: [] }),
    );

    await uploadAllCanadaLifeAccountsToMonarch();

    expect(utils.saveLastUploadDate).toHaveBeenCalledWith(ACCOUNT_ID, END_DATE, 'canadalife');
  });
});

describe('uploadAllCanadaLifeAccountsToMonarch — cancelled mid-fetch', () => {
  test('does NOT advance the sync date when the activity fetch is aborted', async () => {
    // Cancellation surfaces as a throw rather than complete: false, so it has to unwind
    // without ever reaching the watermark write
    clTransactions.fetchActivitiesForDateRange.mockRejectedValue(
      new Error('Operation cancelled by user'),
    );

    await uploadAllCanadaLifeAccountsToMonarch();

    expect(utils.saveLastUploadDate).not.toHaveBeenCalled();
  });

  test('does not clean up legacy storage when the activity fetch is aborted', async () => {
    clTransactions.fetchActivitiesForDateRange.mockRejectedValue(
      new Error('Operation cancelled by user'),
    );

    await uploadAllCanadaLifeAccountsToMonarch();

    expect(accountService.cleanupLegacyStorage).not.toHaveBeenCalled();
  });
});
