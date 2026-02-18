/**
 * Tests for MBNA Upload Service
 */

import { syncMbnaAccount, uploadMbnaAccount } from '../../src/services/mbna-upload';

// Mock dependencies
jest.mock('../../src/core/utils', () => ({
  debugLog: jest.fn(),
  getTodayLocal: jest.fn(() => '2025-02-17'),
}));

jest.mock('../../src/core/config', () => ({
  LOGO_CLOUDINARY_IDS: {
    MBNA: 'production/account_logos/test/mbna-logo',
  },
}));

jest.mock('../../src/core/integrationCapabilities', () => ({
  INTEGRATIONS: { MBNA: 'mbna' },
}));

jest.mock('../../src/core/state', () => ({
  __esModule: true,
  default: {
    setAccount: jest.fn(),
  },
}));

jest.mock('../../src/api/monarch', () => ({
  __esModule: true,
  default: {
    setCreditLimit: jest.fn(),
    setAccountLogo: jest.fn(),
  },
}));

jest.mock('../../src/services/common/accountService', () => ({
  __esModule: true,
  default: {
    getAccountData: jest.fn(),
    getMonarchAccountMapping: jest.fn(),
    upsertAccount: jest.fn(() => true),
    updateAccountInList: jest.fn(() => true),
  },
}));

jest.mock('../../src/ui/toast', () => ({
  __esModule: true,
  default: {
    show: jest.fn(),
  },
}));

jest.mock('../../src/ui/components/progressDialog', () => ({
  showProgressDialog: jest.fn(),
}));

jest.mock('../../src/ui/components/accountSelectorWithCreate', () => ({
  showMonarchAccountSelectorWithCreate: jest.fn(),
}));

// Import mocked modules for assertions
import monarchApi from '../../src/api/monarch';
import accountService from '../../src/services/common/accountService';
import stateManager from '../../src/core/state';
import { showProgressDialog } from '../../src/ui/components/progressDialog';
import { showMonarchAccountSelectorWithCreate } from '../../src/ui/components/accountSelectorWithCreate';

describe('MBNA Upload Service', () => {
  let mockProgressDialog;
  let mockApi;

  const SAMPLE_ACCOUNT = {
    accountId: '00240691635',
    displayName: 'Amazon.ca Rewards Mastercard® (4201)',
    endingIn: '4201',
    cardName: 'Amazon.ca Rewards Mastercard®',
  };

  const SAMPLE_MONARCH_ACCOUNT = {
    id: 'monarch-123',
    displayName: 'MBNA Amazon Card',
  };

  beforeEach(() => {
    jest.clearAllMocks();

    // Create mock progress dialog
    mockProgressDialog = {
      initSteps: jest.fn(),
      updateStepStatus: jest.fn(),
      updateProgress: jest.fn(),
      updateBalanceChange: jest.fn(),
      onCancel: jest.fn(),
      hideCancel: jest.fn(),
      showSummary: jest.fn(),
      close: jest.fn(),
    };
    showProgressDialog.mockReturnValue(mockProgressDialog);

    // Create mock API
    mockApi = {
      getCreditLimit: jest.fn(),
      getBalance: jest.fn(),
      getAccountSnapshot: jest.fn(),
    };

    // Default: no stored data
    accountService.getAccountData.mockReturnValue(null);
  });

  describe('syncMbnaAccount', () => {
    it('should set account in state manager', async () => {
      mockApi.getCreditLimit.mockResolvedValue(29900);
      monarchApi.setCreditLimit.mockResolvedValue({ limit: 29900 });

      await syncMbnaAccount(SAMPLE_ACCOUNT, SAMPLE_MONARCH_ACCOUNT, mockApi);

      expect(stateManager.setAccount).toHaveBeenCalledWith(
        '00240691635',
        'Amazon.ca Rewards Mastercard® (4201)',
      );
    });

    it('should create progress dialog with correct account info', async () => {
      mockApi.getCreditLimit.mockResolvedValue(29900);
      monarchApi.setCreditLimit.mockResolvedValue({ limit: 29900 });

      await syncMbnaAccount(SAMPLE_ACCOUNT, SAMPLE_MONARCH_ACCOUNT, mockApi);

      expect(showProgressDialog).toHaveBeenCalledWith(
        [expect.objectContaining({
          key: '00240691635',
          nickname: 'Amazon.ca Rewards Mastercard® (4201)',
        })],
        'Syncing MBNA Data to Monarch Money',
      );
    });

    it('should initialize 4 sync steps', async () => {
      mockApi.getCreditLimit.mockResolvedValue(29900);
      monarchApi.setCreditLimit.mockResolvedValue({ limit: 29900 });

      await syncMbnaAccount(SAMPLE_ACCOUNT, SAMPLE_MONARCH_ACCOUNT, mockApi);

      expect(mockProgressDialog.initSteps).toHaveBeenCalledWith(
        '00240691635',
        [
          { key: 'creditLimit', name: 'Credit limit sync' },
          { key: 'balance', name: 'Balance upload' },
          { key: 'transactions', name: 'Transaction sync' },
          { key: 'pending', name: 'Pending reconciliation' },
        ],
      );
    });

    it('should sync credit limit successfully', async () => {
      mockApi.getCreditLimit.mockResolvedValue(29900);
      monarchApi.setCreditLimit.mockResolvedValue({ limit: 29900 });

      const result = await syncMbnaAccount(SAMPLE_ACCOUNT, SAMPLE_MONARCH_ACCOUNT, mockApi);

      expect(result.success).toBe(true);
      expect(monarchApi.setCreditLimit).toHaveBeenCalledWith('monarch-123', 29900);

      // Verify credit limit step was marked as success
      const creditLimitCalls = mockProgressDialog.updateStepStatus.mock.calls
        .filter((c) => c[1] === 'creditLimit');
      const lastCreditLimitCall = creditLimitCalls[creditLimitCalls.length - 1];
      expect(lastCreditLimitCall[2]).toBe('success');
      expect(lastCreditLimitCall[3]).toContain('29,900');
    });

    it('should skip credit limit sync when value unchanged', async () => {
      mockApi.getCreditLimit.mockResolvedValue(29900);
      accountService.getAccountData.mockReturnValue({ lastSyncedCreditLimit: 29900 });

      const result = await syncMbnaAccount(SAMPLE_ACCOUNT, SAMPLE_MONARCH_ACCOUNT, mockApi);

      expect(result.success).toBe(true);
      // Should NOT call Monarch API since limit is unchanged
      expect(monarchApi.setCreditLimit).not.toHaveBeenCalled();

      // Should still show success with "unchanged" message
      const creditLimitCalls = mockProgressDialog.updateStepStatus.mock.calls
        .filter((c) => c[1] === 'creditLimit');
      const lastCreditLimitCall = creditLimitCalls[creditLimitCalls.length - 1];
      expect(lastCreditLimitCall[2]).toBe('success');
      expect(lastCreditLimitCall[3]).toContain('unchanged');
    });

    it('should save lastSyncedCreditLimit after successful sync', async () => {
      mockApi.getCreditLimit.mockResolvedValue(29900);
      monarchApi.setCreditLimit.mockResolvedValue({ limit: 29900 });

      await syncMbnaAccount(SAMPLE_ACCOUNT, SAMPLE_MONARCH_ACCOUNT, mockApi);

      expect(accountService.updateAccountInList).toHaveBeenCalledWith(
        'mbna',
        '00240691635',
        expect.objectContaining({ lastSyncedCreditLimit: 29900 }),
      );
    });

    it('should handle credit limit fetch error gracefully', async () => {
      mockApi.getCreditLimit.mockRejectedValue(new Error('API error'));

      const result = await syncMbnaAccount(SAMPLE_ACCOUNT, SAMPLE_MONARCH_ACCOUNT, mockApi);

      // Should still succeed overall (credit limit is not fatal)
      expect(result.success).toBe(true);

      const creditLimitCalls = mockProgressDialog.updateStepStatus.mock.calls
        .filter((c) => c[1] === 'creditLimit');
      const errorCall = creditLimitCalls.find((c) => c[2] === 'error');
      expect(errorCall).toBeTruthy();
    });

    it('should handle null credit limit from API', async () => {
      mockApi.getCreditLimit.mockResolvedValue(null);

      const result = await syncMbnaAccount(SAMPLE_ACCOUNT, SAMPLE_MONARCH_ACCOUNT, mockApi);

      expect(result.success).toBe(true);
      expect(monarchApi.setCreditLimit).not.toHaveBeenCalled();

      // Credit limit step should be skipped
      const creditLimitCalls = mockProgressDialog.updateStepStatus.mock.calls
        .filter((c) => c[1] === 'creditLimit');
      const skippedCall = creditLimitCalls.find((c) => c[2] === 'skipped');
      expect(skippedCall).toBeTruthy();
    });

    it('should mark balance step as skipped', async () => {
      mockApi.getCreditLimit.mockResolvedValue(null);

      await syncMbnaAccount(SAMPLE_ACCOUNT, SAMPLE_MONARCH_ACCOUNT, mockApi);

      expect(mockProgressDialog.updateStepStatus).toHaveBeenCalledWith(
        '00240691635', 'balance', 'skipped', 'Coming soon',
      );
    });

    it('should mark transactions step as skipped', async () => {
      mockApi.getCreditLimit.mockResolvedValue(null);

      await syncMbnaAccount(SAMPLE_ACCOUNT, SAMPLE_MONARCH_ACCOUNT, mockApi);

      expect(mockProgressDialog.updateStepStatus).toHaveBeenCalledWith(
        '00240691635', 'transactions', 'skipped', 'Coming soon',
      );
    });

    it('should mark pending step as skipped', async () => {
      mockApi.getCreditLimit.mockResolvedValue(null);

      await syncMbnaAccount(SAMPLE_ACCOUNT, SAMPLE_MONARCH_ACCOUNT, mockApi);

      expect(mockProgressDialog.updateStepStatus).toHaveBeenCalledWith(
        '00240691635', 'pending', 'skipped', 'Coming soon',
      );
    });

    it('should update lastSyncDate after successful sync', async () => {
      mockApi.getCreditLimit.mockResolvedValue(29900);
      monarchApi.setCreditLimit.mockResolvedValue({ limit: 29900 });

      await syncMbnaAccount(SAMPLE_ACCOUNT, SAMPLE_MONARCH_ACCOUNT, mockApi);

      expect(accountService.updateAccountInList).toHaveBeenCalledWith(
        'mbna',
        '00240691635',
        expect.objectContaining({ lastSyncDate: '2025-02-17' }),
      );
    });

    it('should show summary on completion', async () => {
      mockApi.getCreditLimit.mockResolvedValue(29900);
      monarchApi.setCreditLimit.mockResolvedValue({ limit: 29900 });

      await syncMbnaAccount(SAMPLE_ACCOUNT, SAMPLE_MONARCH_ACCOUNT, mockApi);

      expect(mockProgressDialog.hideCancel).toHaveBeenCalled();
      expect(mockProgressDialog.showSummary).toHaveBeenCalledWith({
        success: 1, failed: 0, total: 1,
      });
    });

    it('should handle credit limit verification failure', async () => {
      mockApi.getCreditLimit.mockResolvedValue(29900);
      // API returns a different limit than what was set
      monarchApi.setCreditLimit.mockResolvedValue({ limit: 25000 });

      await syncMbnaAccount(SAMPLE_ACCOUNT, SAMPLE_MONARCH_ACCOUNT, mockApi);

      // Should NOT save the credit limit since verification failed
      const updateCalls = accountService.updateAccountInList.mock.calls
        .filter((c) => c[2]?.lastSyncedCreditLimit !== undefined);
      expect(updateCalls).toHaveLength(0);

      // Credit limit step should show error
      const creditLimitCalls = mockProgressDialog.updateStepStatus.mock.calls
        .filter((c) => c[1] === 'creditLimit');
      const errorCall = creditLimitCalls.find((c) => c[2] === 'error');
      expect(errorCall).toBeTruthy();
    });

    it('should use fallback display name when displayName is missing', async () => {
      const accountNoName = { accountId: '123', endingIn: '9999' };
      mockApi.getCreditLimit.mockResolvedValue(null);

      await syncMbnaAccount(accountNoName, SAMPLE_MONARCH_ACCOUNT, mockApi);

      expect(stateManager.setAccount).toHaveBeenCalledWith('123', 'MBNA Card (9999)');
    });
  });

  describe('uploadMbnaAccount', () => {
    it('should set state manager BEFORE showing account selector for unmapped accounts', async () => {
      // No existing mapping
      accountService.getMonarchAccountMapping.mockReturnValue(null);
      accountService.getAccountData.mockReturnValue(null);

      // Track call order
      const callOrder = [];
      stateManager.setAccount.mockImplementation(() => {
        callOrder.push('setAccount');
      });
      showMonarchAccountSelectorWithCreate.mockImplementation((_accounts, callback) => {
        callOrder.push('showSelector');
        // Simulate user cancelling
        callback(null);
      });

      await uploadMbnaAccount(SAMPLE_ACCOUNT, mockApi);

      expect(callOrder[0]).toBe('setAccount');
      expect(callOrder[1]).toBe('showSelector');
      expect(stateManager.setAccount).toHaveBeenCalledWith(
        '00240691635',
        'Amazon.ca Rewards Mastercard® (4201)',
      );
    });

    it('should set state manager for already-mapped accounts', async () => {
      // Existing mapping — will skip selector and go straight to sync
      accountService.getMonarchAccountMapping.mockReturnValue(SAMPLE_MONARCH_ACCOUNT);
      mockApi.getCreditLimit.mockResolvedValue(null);

      await uploadMbnaAccount(SAMPLE_ACCOUNT, mockApi);

      // setAccount should be called at least once in uploadMbnaAccount (before selector check)
      const firstCall = stateManager.setAccount.mock.calls[0];
      expect(firstCall).toEqual(['00240691635', 'Amazon.ca Rewards Mastercard® (4201)']);
    });

    it('should return cancelled when user cancels account selector', async () => {
      accountService.getMonarchAccountMapping.mockReturnValue(null);
      accountService.getAccountData.mockReturnValue(null);

      showMonarchAccountSelectorWithCreate.mockImplementation((_accounts, callback) => {
        callback(null);
      });

      const result = await uploadMbnaAccount(SAMPLE_ACCOUNT, mockApi);

      expect(result.success).toBe(false);
      expect(result.message).toBe('Cancelled');
    });

    it('should save skipped account when user skips', async () => {
      accountService.getMonarchAccountMapping.mockReturnValue(null);
      accountService.getAccountData.mockReturnValue(null);

      showMonarchAccountSelectorWithCreate.mockImplementation((_accounts, callback) => {
        callback({ skipped: true });
      });

      const result = await uploadMbnaAccount(SAMPLE_ACCOUNT, mockApi);

      expect(result.success).toBe(true);
      expect(result.skipped).toBe(true);
      expect(accountService.upsertAccount).toHaveBeenCalledWith(
        'mbna',
        expect.objectContaining({
          syncEnabled: false,
          monarchAccount: null,
        }),
      );
    });

    it('should set account logo on newly created accounts', async () => {
      accountService.getMonarchAccountMapping.mockReturnValue(null);
      accountService.getAccountData.mockReturnValue(null);

      const newlyCreatedAccount = {
        id: 'monarch-new',
        displayName: 'New MBNA Card',
        newlyCreated: true,
      };
      showMonarchAccountSelectorWithCreate.mockImplementation((_accounts, callback) => {
        callback(newlyCreatedAccount);
      });
      monarchApi.setAccountLogo.mockResolvedValue(true);
      mockApi.getCreditLimit.mockResolvedValue(null);

      await uploadMbnaAccount(SAMPLE_ACCOUNT, mockApi);

      expect(monarchApi.setAccountLogo).toHaveBeenCalledWith(
        'monarch-new',
        'production/account_logos/test/mbna-logo',
      );
    });
  });
});
