/**
 * Tests for Canada Life Closed Accounts Service and Upload Orchestration Integration
 */

import '../../setup';

vi.mock('../../../src/core/config', () => ({
  ACCOUNT_STATUS: { ACTIVE: 'active', CLOSED: 'closed' },
  CARDHOLDER: {
    SHARED_OWNER: 'Shared',
    OWNER_MODE: { OFF: 'off', ON: 'on' },
    TAG_MODE: { OFF: 'off', AUTO: 'auto', ALWAYS: 'always' },
  },
  STORAGE: {},
  LOGO_CLOUDINARY_IDS: { CANADALIFE: 'canadalife-logo' },
  TRANSACTION_RETENTION_DEFAULTS: { DAYS: 91, COUNT: 1000 },
}));

vi.mock('../../../src/core/integrationCapabilities', () => ({
  INTEGRATIONS: { CANADALIFE: 'canadalife' },
  ACCOUNT_SETTINGS: { INCLUDE_PENDING_TRANSACTIONS: 'includePendingTransactions' },
}));

vi.mock('../../../src/core/utils', () => ({
  debugLog: vi.fn(),
  formatDate: vi.fn((date) => date.toISOString().split('T')[0]),
  getTodayLocal: vi.fn(() => '2026-11-26'),
  getYesterdayLocal: vi.fn(() => '2026-11-25'),
  formatDaysAgoLocal: vi.fn(() => '2026-08-28'),
  parseLocalDate: vi.fn((s) => new Date(s)),
  calculateFromDateWithLookback: vi.fn(() => '2026-11-25'),
  saveLastUploadDate: vi.fn(),
  computeExtendedFromDate: vi.fn((d) => d),
}));

vi.mock('../../../src/core/state', () => ({
  default: {
    getState: vi.fn(() => ({ currentAccount: { nickname: 'Test', name: 'Test' } })),
    setAccount: vi.fn(),
  },
}));

vi.mock('../../../src/services/common/accountService', () => ({
  default: {
    getAccountData: vi.fn(),
    getMonarchAccountMapping: vi.fn(),
    upsertAccount: vi.fn(),
    updateAccountInList: vi.fn(() => true),
    cleanupLegacyStorage: vi.fn(() => ({ cleaned: true, keysDeleted: 0, keys: [] })),
  },
}));

vi.mock('../../../src/api/canadalife', () => ({
  default: {
    loadCanadaLifeAccounts: vi.fn(),
    getCachedSponsorInfo: vi.fn(() => null),
    loadAccountBalanceHistory: vi.fn(),
    loadAccountActivityReport: vi.fn().mockResolvedValue({ activities: [] }),
  },
}));

vi.mock('../../../src/api/monarch', () => ({
  default: {
    listAccounts: vi.fn(),
    uploadBalance: vi.fn(),
    uploadTransactions: vi.fn(),
    closeAccount: vi.fn(),
    validateAndRefreshAccountMapping: vi.fn(),
    setAccountLogo: vi.fn(),
  },
}));

vi.mock('../../../src/ui/toast', () => ({
  default: { show: vi.fn() },
}));

vi.mock('../../../src/ui/components/closedAccountsDialog', () => ({
  showClosedAccountsDialog: vi.fn(),
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
  fetchActivitiesForDateRange: vi.fn().mockResolvedValue({ activities: [], complete: true, failedChunks: [] }),
  processActivities: vi.fn().mockResolvedValue([]),
  fetchAndProcessTransactions: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../../src/services/common/pendingReconciliation', () => ({
  fetchMonarchPendingTransactions: vi.fn().mockResolvedValue({ noPendingTag: true, noPendingTransactions: true }),
}));

globalThis.GM_getValue = vi.fn();
globalThis.GM_setValue = vi.fn();

// eslint-disable-next-line import/first
import {
  findPotentialClosedAccounts,
  inferDefaultClosureDate,
  buildClosedAccountsPromptText,
  closeCanadaLifeAccount,
  promptForClosedAccounts,
  closeAccountWithProgress,
  reportClosedAccountOutcomes,
} from '../../../src/services/canadalife/closedAccounts';
// eslint-disable-next-line import/first
import { uploadAllCanadaLifeAccountsToMonarch } from '../../../src/services/canadalife-upload';
import canadalife from '../../../src/api/canadalife';
import monarchApi from '../../../src/api/monarch';
import accountService from '../../../src/services/common/accountService';
import toast from '../../../src/ui/toast';
import { showClosedAccountsDialog } from '../../../src/ui/components/closedAccountsDialog';
import { showProgressDialog } from '../../../src/ui/components/progressDialog';
import { ensureMonarchAuthentication } from '../../../src/ui/components/monarchLoginLink';

function makeAccount(id, shortName, overrides = {}) {
  const { canadalifeAccount: canadalifeOverrides, ...restOverrides } = overrides;
  return {
    monarchAccount: { id: `monarch-${id}`, displayName: `Monarch ${shortName}` },
    syncEnabled: true,
    lastSyncDate: '2026-11-20',
    ...restOverrides,
    canadalifeAccount: {
      id,
      agreementId: id,
      EnglishShortName: shortName,
      LongNameEnglish: `Long ${shortName}`,
      EnrollmentDate: '2020-01-01T00:00:00',
      ...(canadalifeOverrides || {}),
    },
  };
}

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

describe('Canada Life Closed Accounts Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ensureMonarchAuthentication.mockResolvedValue(true);
    monarchApi.uploadBalance.mockResolvedValue(true);
    monarchApi.closeAccount.mockResolvedValue({
      id: 'monarch-agr1',
      displayName: 'Monarch RRSP',
      deactivatedAt: '2026-11-24',
    });
    canadalife.getCachedSponsorInfo.mockReturnValue(null);
    canadalife.loadAccountBalanceHistory.mockResolvedValue({
      data: [
        ['Date', 'Closing Balance', 'Account Name'],
        ['2026-11-26', 1000, 'RRSP2'],
      ],
    });
    accountService.getMonarchAccountMapping.mockReturnValue({ id: 'monarch-rrsp2', displayName: 'NextSteps RRSP' });
    accountService.getAccountData.mockReturnValue({ uploadedTransactions: [] });
    monarchApi.validateAndRefreshAccountMapping.mockResolvedValue({
      valid: true,
      account: { id: 'monarch-rrsp2', displayName: 'NextSteps RRSP' },
    });
  });

  describe('findPotentialClosedAccounts', () => {
    test('returns only orphaned accounts that are active and sync-enabled', () => {
      const accounts = [
        makeAccount('active', 'RRSP2', { isOrphanedFromApi: false }),
        makeAccount('orphan-open', 'RRSP', { isOrphanedFromApi: true }),
        makeAccount('orphan-closed', 'DPSP', { isOrphanedFromApi: true, status: 'closed' }),
        makeAccount('orphan-disabled', 'TFSA', { isOrphanedFromApi: true, syncEnabled: false }),
        {
          canadalifeAccount: { id: 'id-only', EnglishShortName: 'IDONLY' },
          syncEnabled: true,
          isOrphanedFromApi: true,
        },
        {
          canadalifeAccount: {},
          syncEnabled: true,
          isOrphanedFromApi: true,
        },
      ];

      const result = findPotentialClosedAccounts(accounts);

      expect(result.map((a) => a.canadalifeAccount.id)).toEqual(['orphan-open', 'id-only']);
    });
  });

  describe('inferDefaultClosureDate', () => {
    test('pre-fills date from newly opened NextSteps account EnrollmentDate', () => {
      const rrsp2 = {
        canadalifeAccount: {
          id: 'rrsp2',
          agreementId: 'rrsp2',
          EnglishShortName: 'RRSP2',
          EnrollmentDate: '2026-11-24T00:00:00',
        },
        monarchAccount: null,
        syncEnabled: true,
        lastSyncDate: null,
        isOrphanedFromApi: false,
      };
      const oldRrsp = makeAccount('old-rrsp', 'RRSP', { isOrphanedFromApi: true });

      const result = inferDefaultClosureDate([rrsp2, oldRrsp], null);

      expect(result.date).toBe('2026-11-24');
      expect(result.hint).toContain('RRSP2');
      expect(result.hint).toContain('2026-11-24');
    });

    test('treats mapped account without lastSyncDate as newly opened and falls back to LongNameEnglish when short name missing', () => {
      const noShortName = {
        canadalifeAccount: {
          id: 'rrsp-new',
          agreementId: 'rrsp-new',
          LongNameEnglish: 'NextSteps Retirement Plan',
          EnrollmentDate: '2026-11-23',
        },
        monarchAccount: { id: 'm-1', displayName: 'Monarch RRSP' },
        syncEnabled: true,
        lastSyncDate: null,
        isOrphanedFromApi: false,
      };
      const missingDate = {
        canadalifeAccount: { id: 'no-date', agreementId: 'no-date' },
        monarchAccount: null,
        syncEnabled: true,
        isOrphanedFromApi: false,
      };
      const malformedDate = {
        canadalifeAccount: { id: 'bad-date', agreementId: 'bad-date', EnrollmentDate: 'not-a-date' },
        monarchAccount: null,
        syncEnabled: true,
        isOrphanedFromApi: false,
      };

      const result = inferDefaultClosureDate([missingDate, malformedDate, noShortName], null);

      expect(result.date).toBe('2026-11-23');
      expect(result.hint).toContain('NextSteps Retirement Plan');
    });

    test('uses most recent active account EnrollmentDate on NEXTSTEP sponsor when all active accounts are already synced', () => {
      const earlier = makeAccount('ns-1', 'RRSP1', {
        isOrphanedFromApi: false,
        canadalifeAccount: { EnrollmentDate: '2026-10-01T00:00:00' },
      });
      const later = makeAccount('ns-2', 'RRSP2', {
        isOrphanedFromApi: false,
        canadalifeAccount: { EnrollmentDate: '2026-11-24T00:00:00' },
      });

      const result = inferDefaultClosureDate([earlier, later], {
        adminSystemId: 'ENC_ID',
        sponsorName: 'NEXTSTEP',
        sponsorId: 'ENC_Y',
        isMultiSponsor: true,
        hasSavingsPlans: true,
        grsPlanId: '62396',
      });

      expect(result.date).toBe('2026-11-24');
      expect(result.hint).toContain('RRSP2');
    });

    test('falls back to today when no active account EnrollmentDate is available', () => {
      const oldRrsp = makeAccount('old-rrsp', 'RRSP', { isOrphanedFromApi: true });

      const result = inferDefaultClosureDate([oldRrsp], null);

      expect(result.date).toBe('2026-11-26');
      expect(result.hint).toContain('confirm or adjust');
    });
  });

  describe('buildClosedAccountsPromptText', () => {
    test('explains no-savings sponsor and multi-sponsor note', () => {
      const text = buildClosedAccountsPromptText({
        adminSystemId: null,
        sponsorName: 'AMAZON CANADA FULFILLMENT SERVICES',
        sponsorId: 'ENC_X',
        isMultiSponsor: true,
        hasSavingsPlans: false,
        grsPlanId: null,
      });

      expect(text.description).toContain('AMAZON CANADA FULFILLMENT SERVICES');
      expect(text.description).toContain('NextSteps');
      expect(text.note).toContain('multiple sponsors');
    });

    test('uses fallback sponsor label when no-savings sponsor has empty name', () => {
      const text = buildClosedAccountsPromptText({
        adminSystemId: null,
        sponsorName: '',
        sponsorId: 'ENC_X',
        isMultiSponsor: false,
        hasSavingsPlans: false,
        grsPlanId: null,
      });

      expect(text.description).toContain('your current Canada Life sponsor');
      expect(text.note).toBeUndefined();
    });

    test('mentions NextSteps when on NEXTSTEP sponsor', () => {
      const text = buildClosedAccountsPromptText({
        adminSystemId: 'ENC_ID',
        sponsorName: 'NEXTSTEP',
        sponsorId: 'ENC_Y',
        isMultiSponsor: true,
        hasSavingsPlans: true,
        grsPlanId: '62396',
      });

      expect(text.description).toContain('NEXTSTEP');
      expect(text.description).toContain('NextSteps');
    });

    test('uses generic copy when sponsorInfo is null', () => {
      const text = buildClosedAccountsPromptText(null);
      expect(text.description).toContain('not returned by Canada Life');
      expect(text.note).toBeUndefined();
    });
  });

  describe('closeCanadaLifeAccount', () => {
    test('uploads $0 balance CSV for confirmed date, calls closeAccount(id, closedDate), and marks closed in uploader', async () => {
      const account = makeAccount('agr1', 'RRSP', { isOrphanedFromApi: true });

      const result = await closeCanadaLifeAccount(account, {
        closeInMonarch: true,
        closedDate: '2026-11-24',
      });

      expect(monarchApi.uploadBalance).toHaveBeenCalledWith(
        'monarch-agr1',
        '"Date","Total Equity","Account Name"\n"2026-11-24","0","Long RRSP"\n',
        '2026-11-24',
        '2026-11-24',
      );
      expect(monarchApi.closeAccount).toHaveBeenCalledWith('monarch-agr1', '2026-11-24');
      expect(accountService.updateAccountInList).toHaveBeenCalledWith('canadalife', 'agr1', expect.objectContaining({
        status: 'closed',
        closedDate: '2026-11-24',
        syncEnabled: false,
        lastSyncBalance: 0,
      }));
      expect(result.closedInUploader).toBe(true);
      expect(result.closedInMonarch).toBe(true);
    });

    test('still closes in Monarch if best-effort $0 CSV upload fails', async () => {
      monarchApi.uploadBalance.mockRejectedValueOnce(new Error('CSV endpoint down'));
      const account = makeAccount('agr1', 'RRSP', { isOrphanedFromApi: true });

      const result = await closeCanadaLifeAccount(account, {
        closeInMonarch: true,
        closedDate: '2026-11-24',
      });

      expect(monarchApi.closeAccount).toHaveBeenCalledWith('monarch-agr1', '2026-11-24');
      expect(result.closedInUploader).toBe(true);
      expect(result.closedInMonarch).toBe(true);
    });

    test('marks closed in uploader when Monarch account was already deleted', async () => {
      monarchApi.closeAccount.mockRejectedValueOnce(new Error('Account not found: monarch-agr1'));
      const account = makeAccount('agr1', 'RRSP', { isOrphanedFromApi: true });

      const result = await closeCanadaLifeAccount(account, {
        closeInMonarch: true,
        closedDate: '2026-11-24',
      });

      expect(result.closedInUploader).toBe(true);
      expect(result.closedInMonarch).toBe(false);
      expect(result.monarchNotFound).toBe(true);
      expect(accountService.updateAccountInList).toHaveBeenCalledWith('canadalife', 'agr1', expect.objectContaining({
        status: 'closed',
        closedDate: '2026-11-24',
        syncEnabled: false,
      }));
    });

    test('leaves account open in uploader when Monarch fails with transient error', async () => {
      monarchApi.closeAccount.mockRejectedValueOnce(new Error('Network timeout'));
      const account = makeAccount('agr1', 'RRSP', { isOrphanedFromApi: true });

      const result = await closeCanadaLifeAccount(account, {
        closeInMonarch: true,
        closedDate: '2026-11-24',
      });

      expect(result.closedInUploader).toBe(false);
      expect(result.monarchError).toBe('Network timeout');
      expect(accountService.updateAccountInList).not.toHaveBeenCalled();
    });

    test('marks closed only in uploader when closeInMonarch is false or unmapped', async () => {
      const account = makeAccount('agr1', 'RRSP', { isOrphanedFromApi: true });

      const result = await closeCanadaLifeAccount(account, {
        closeInMonarch: false,
        closedDate: '2026-11-24',
      });

      expect(monarchApi.uploadBalance).not.toHaveBeenCalled();
      expect(monarchApi.closeAccount).not.toHaveBeenCalled();
      expect(result.closedInUploader).toBe(true);
      expect(result.closedInMonarch).toBe(false);
    });

    test('defaults closedDate to today and handles fallback names and non-Error rejections', async () => {
      const shortNameOnly = {
        canadalifeAccount: { id: 'agr-short', EnglishShortName: 'RRSP' },
        monarchAccount: null,
      };
      const idOnly = {
        canadalifeAccount: { id: 'agr-id-only' },
        monarchAccount: null,
      };
      const nameless = {
        canadalifeAccount: {},
        monarchAccount: null,
      };

      const r1 = await closeCanadaLifeAccount(shortNameOnly, { closeInMonarch: false });
      const r2 = await closeCanadaLifeAccount(idOnly, { closeInMonarch: false });
      const r3 = await closeCanadaLifeAccount(nameless, { closeInMonarch: false });

      expect(r1.accountName).toBe('RRSP');
      expect(r2.accountName).toBe('agr-id-only');
      expect(r3.accountName).toBe('Account');
      expect(accountService.updateAccountInList).toHaveBeenCalledWith(
        'canadalife',
        'agr-short',
        expect.objectContaining({ closedDate: '2026-11-26' }),
      );

      monarchApi.closeAccount.mockRejectedValueOnce('string failure');
      const r4 = await closeCanadaLifeAccount(makeAccount('agr-str', 'RRSP'), {
        closeInMonarch: true,
        closedDate: '2026-11-24',
      });
      expect(r4.closedInUploader).toBe(false);
      expect(r4.monarchError).toBe('string failure');
    });
  });

  describe('promptForClosedAccounts, closeAccountWithProgress & uploadAllCanadaLifeAccountsToMonarch integration', () => {
    test('handles old no-savings sponsor with 0 plans and shows info toast instead of error', async () => {
      canadalife.loadCanadaLifeAccounts.mockResolvedValue([]);
      canadalife.getCachedSponsorInfo.mockReturnValue({
        adminSystemId: null,
        sponsorName: 'AMAZON CANADA FULFILLMENT SERVICES',
        sponsorId: 'ENC_X',
        isMultiSponsor: true,
        hasSavingsPlans: false,
        grsPlanId: null,
      });

      await uploadAllCanadaLifeAccountsToMonarch();

      expect(toast.show).toHaveBeenCalledWith(
        'No active savings plans found under AMAZON CANADA FULFILLMENT SERVICES',
        'info',
      );
      expect(showProgressDialog).not.toHaveBeenCalled();
    });

    test('shows closed accounts in progress dialog with single Close account step on NEXTSTEP transfer', async () => {
      const rrsp2 = {
        canadalifeAccount: {
          id: 'rrsp2',
          agreementId: 'rrsp2',
          EnglishShortName: 'RRSP2',
          LongNameEnglish: 'Long RRSP2',
          EnrollmentDate: '2026-11-24T00:00:00',
        },
        monarchAccount: null,
        syncEnabled: true,
        lastSyncDate: null,
        isOrphanedFromApi: false,
      };
      const oldRrsp = makeAccount('old-rrsp', 'RRSP', { isOrphanedFromApi: true });
      const oldDpsp = makeAccount('old-dpsp', 'DPSP', { isOrphanedFromApi: true });
      canadalife.loadCanadaLifeAccounts.mockResolvedValue([rrsp2, oldRrsp, oldDpsp]);
      canadalife.getCachedSponsorInfo.mockReturnValue({
        adminSystemId: 'ENC_ID',
        sponsorName: 'NEXTSTEP',
        sponsorId: 'ENC_Y',
        isMultiSponsor: true,
        hasSavingsPlans: true,
        grsPlanId: '62396',
      });
      showClosedAccountsDialog.mockResolvedValue({
        confirmed: true,
        selectedAccountIds: ['old-rrsp', 'old-dpsp'],
        closeInMonarch: true,
        closedDate: '2026-11-24',
      });

      const dialog = makeProgressDialog();
      showProgressDialog.mockReturnValue(dialog);

      await uploadAllCanadaLifeAccountsToMonarch();

      expect(canadalife.loadCanadaLifeAccounts).toHaveBeenCalledWith({ forceRefresh: true });
      expect(showClosedAccountsDialog).toHaveBeenCalledWith(expect.objectContaining({
        defaultClosedDate: '2026-11-24',
      }));
      expect(showProgressDialog).toHaveBeenCalledWith(
        [
          { key: 'rrsp2', nickname: 'Long RRSP2', name: 'RRSP2' },
          { key: 'old-rrsp', nickname: 'Long RRSP', name: 'RRSP', status: 'closed' },
          { key: 'old-dpsp', nickname: 'Long DPSP', name: 'DPSP', status: 'closed' },
        ],
        'Uploading Canada Life Balance & Transactions to Monarch',
      );
      expect(dialog.initSteps).toHaveBeenCalledWith('old-rrsp', [{ key: 'closeAccount', name: 'Close account' }]);
      expect(dialog.updateStepStatus).toHaveBeenCalledWith('old-rrsp', 'closeAccount', 'processing', 'Closing in Monarch...');
      expect(dialog.updateStepStatus).toHaveBeenCalledWith('old-rrsp', 'closeAccount', 'success', 'Closed (2026-11-24)');
      expect(dialog.initSteps).toHaveBeenCalledWith('old-dpsp', [{ key: 'closeAccount', name: 'Close account' }]);
      expect(dialog.updateStepStatus).toHaveBeenCalledWith('old-dpsp', 'closeAccount', 'success', 'Closed (2026-11-24)');
      expect(monarchApi.closeAccount).toHaveBeenCalledWith('monarch-old-rrsp', '2026-11-24');
      expect(monarchApi.closeAccount).toHaveBeenCalledWith('monarch-old-dpsp', '2026-11-24');
      expect(dialog.showSummary).toHaveBeenCalledWith(expect.objectContaining({ success: 3, failed: 0, total: 3 }));
    });

    test('shows progress dialog when closing orphaned accounts on old no-savings sponsor (0 active accounts)', async () => {
      const oldRrsp = makeAccount('old-rrsp', 'RRSP', { isOrphanedFromApi: true });
      const oldDpsp = makeAccount('old-dpsp', 'DPSP', { isOrphanedFromApi: true });
      canadalife.loadCanadaLifeAccounts.mockResolvedValue([oldRrsp, oldDpsp]);
      showClosedAccountsDialog.mockResolvedValue({
        confirmed: true,
        selectedAccountIds: ['old-rrsp', 'old-dpsp'],
        closeInMonarch: true,
        closedDate: '2026-11-24',
      });

      const dialog = makeProgressDialog();
      showProgressDialog.mockReturnValue(dialog);

      await uploadAllCanadaLifeAccountsToMonarch();

      expect(showProgressDialog).toHaveBeenCalledWith(
        [
          { key: 'old-rrsp', nickname: 'Long RRSP', name: 'RRSP', status: 'closed' },
          { key: 'old-dpsp', nickname: 'Long DPSP', name: 'DPSP', status: 'closed' },
        ],
        'Uploading Canada Life Balance & Transactions to Monarch',
      );
      expect(dialog.initSteps).toHaveBeenCalledWith('old-rrsp', [{ key: 'closeAccount', name: 'Close account' }]);
      expect(dialog.updateStepStatus).toHaveBeenCalledWith('old-rrsp', 'closeAccount', 'success', 'Closed (2026-11-24)');
      expect(dialog.hideCancel).toHaveBeenCalled();
      expect(dialog.showSummary).toHaveBeenCalledWith(expect.objectContaining({ success: 2, failed: 0, total: 2 }));
      expect(toast.show).toHaveBeenCalledWith('Closed 2 account(s) in Monarch ($0 balance) and uploader', 'info');
    });

    test('skips orphaned accounts cleanly without opening progress dialog when old sponsor has 0 active plans and user skips', async () => {
      const oldRrsp = makeAccount('old-rrsp', 'RRSP', { isOrphanedFromApi: true });
      canadalife.loadCanadaLifeAccounts.mockResolvedValue([oldRrsp]);
      showClosedAccountsDialog.mockResolvedValue({
        confirmed: false,
        selectedAccountIds: [],
        closeInMonarch: false,
        closedDate: '',
      });

      await uploadAllCanadaLifeAccountsToMonarch();

      expect(showProgressDialog).not.toHaveBeenCalled();
      expect(toast.show).toHaveBeenCalledWith('No active Canada Life accounts to sync on current plan.', 'info');
    });

    test('excludes already-closed accounts without prompting again', async () => {
      const closedAccount = makeAccount('old-rrsp', 'RRSP', {
        isOrphanedFromApi: true,
        status: 'closed',
        syncEnabled: false,
      });
      canadalife.loadCanadaLifeAccounts.mockResolvedValue([closedAccount]);

      await uploadAllCanadaLifeAccountsToMonarch();

      expect(showClosedAccountsDialog).not.toHaveBeenCalled();
      expect(showProgressDialog).not.toHaveBeenCalled();
      expect(toast.show).toHaveBeenCalledWith(
        'All Canada Life accounts are marked as closed. No active accounts to sync.',
        'info',
      );
    });

    test('updates step to error and reports warning when one Monarch close fails', async () => {
      const a1 = makeAccount('a1', 'RRSP', { isOrphanedFromApi: true });
      const a2 = makeAccount('a2', 'DPSP', { isOrphanedFromApi: true });
      canadalife.loadCanadaLifeAccounts.mockResolvedValue([a1, a2]);
      showClosedAccountsDialog.mockResolvedValue({
        confirmed: true,
        selectedAccountIds: ['a1', 'a2'],
        closeInMonarch: true,
        closedDate: '2026-11-24',
      });
      monarchApi.closeAccount
        .mockResolvedValueOnce({ deactivatedAt: '2026-11-24' })
        .mockRejectedValueOnce(new Error('500 Server Error'));

      const dialog = makeProgressDialog();
      showProgressDialog.mockReturnValue(dialog);

      await uploadAllCanadaLifeAccountsToMonarch();

      expect(dialog.updateStepStatus).toHaveBeenCalledWith('a1', 'closeAccount', 'success', 'Closed (2026-11-24)');
      expect(dialog.updateStepStatus).toHaveBeenCalledWith('a2', 'closeAccount', 'error', '500 Server Error');
      expect(dialog.showSummary).toHaveBeenCalledWith(expect.objectContaining({ success: 1, failed: 1, total: 2 }));
      expect(toast.show).toHaveBeenCalledWith(expect.stringContaining('failed in Monarch'), 'warning');
    });

    test('promptForClosedAccounts, closeAccountWithProgress, and reportClosedAccountOutcomes work standalone', async () => {
      const a1 = makeAccount('a1', 'RRSP', { isOrphanedFromApi: true, monarchAccount: null });
      const a2 = makeAccount('a2', 'DPSP', { isOrphanedFromApi: true });
      showClosedAccountsDialog.mockResolvedValue({
        confirmed: true,
        selectedAccountIds: ['a1'],
        closeInMonarch: false,
        closedDate: '2026-11-24',
      });

      const plan = await promptForClosedAccounts([a1, a2], null);
      expect(plan.prompted).toBe(true);
      expect(plan.accountsToClose).toEqual([a1]);
      expect(plan.skippedOrphanIds).toEqual(new Set(['a2']));
      expect(showClosedAccountsDialog).toHaveBeenCalledWith(expect.objectContaining({
        accounts: expect.arrayContaining([
          expect.objectContaining({ id: 'a1', monarchAccountName: null }),
        ]),
      }));

      const dialog = makeProgressDialog();
      const res = await closeAccountWithProgress(a1, { closeInMonarch: false, closedDate: '2026-11-24' }, dialog);
      expect(dialog.updateStepStatus).toHaveBeenCalledWith('a1', 'closeAccount', 'processing', 'Marking closed...');
      expect(dialog.updateStepStatus).toHaveBeenCalledWith('a1', 'closeAccount', 'success', 'Closed in uploader (2026-11-24)');

      reportClosedAccountOutcomes([res], false);
      expect(toast.show).toHaveBeenCalledWith('Marked 1 account(s) as closed in uploader', 'info');
    });

    test('closeAccountWithProgress and reportClosedAccountOutcomes handle Monarch not-found and all-failed outcomes', async () => {
      const a1 = makeAccount('a1', 'RRSP', { isOrphanedFromApi: true });
      const dialog = makeProgressDialog();

      monarchApi.closeAccount.mockRejectedValueOnce(new Error('Account does not exist'));
      const notFoundRes = await closeAccountWithProgress(a1, { closeInMonarch: true, closedDate: '2026-11-24' }, dialog);
      expect(dialog.updateStepStatus).toHaveBeenCalledWith('a1', 'closeAccount', 'success', 'Closed in uploader (not in Monarch)');

      reportClosedAccountOutcomes([notFoundRes], true);
      expect(toast.show).toHaveBeenCalledWith(
        'Closed 1 account(s) in uploader; 1 already missing from Monarch',
        'warning',
      );

      monarchApi.closeAccount.mockRejectedValueOnce(new Error(''));
      const emptyErrRes = await closeAccountWithProgress(a1, { closeInMonarch: true, closedDate: '2026-11-24' }, dialog);
      expect(dialog.updateStepStatus).toHaveBeenCalledWith('a1', 'closeAccount', 'error', 'Failed to close');

      reportClosedAccountOutcomes([emptyErrRes], true);
      expect(toast.show).toHaveBeenCalledWith('Failed to close selected account(s) in Monarch: ', 'error');
    });

    test('handles no-savings sponsor with empty name and skips unchecked orphaned account while syncing active account', async () => {
      canadalife.loadCanadaLifeAccounts.mockResolvedValueOnce([]);
      canadalife.getCachedSponsorInfo.mockReturnValueOnce({
        adminSystemId: null,
        sponsorName: '',
        sponsorId: 'ENC_X',
        isMultiSponsor: false,
        hasSavingsPlans: false,
        grsPlanId: null,
      });

      await uploadAllCanadaLifeAccountsToMonarch();

      expect(toast.show).toHaveBeenCalledWith(
        'No active savings plans found under your current Canada Life sponsor',
        'info',
      );

      const activeRrsp2 = makeAccount('rrsp2', 'RRSP2', { isOrphanedFromApi: false });
      const skippedOrphan = makeAccount('old-rrsp', 'RRSP', { isOrphanedFromApi: true });
      canadalife.loadCanadaLifeAccounts.mockResolvedValueOnce([activeRrsp2, skippedOrphan]);
      canadalife.getCachedSponsorInfo.mockReturnValueOnce(null);
      showClosedAccountsDialog.mockResolvedValueOnce({
        confirmed: false,
        selectedAccountIds: [],
        closeInMonarch: false,
        closedDate: '',
      });

      const dialog = makeProgressDialog();
      showProgressDialog.mockReturnValue(dialog);

      await uploadAllCanadaLifeAccountsToMonarch();

      expect(dialog.updateProgress).toHaveBeenCalledWith('old-rrsp', 'skipped', 'Not on current plan');
      expect(dialog.showSummary).toHaveBeenCalledWith(expect.objectContaining({ success: 1, failed: 0, total: 1 }));
    });
  });
});
