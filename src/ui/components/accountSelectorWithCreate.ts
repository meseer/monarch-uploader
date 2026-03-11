/**
 * Enhanced Account Selector Component with "Create New Account" option
 * Extends the generic account selector to include account creation functionality
 */

import { debugLog, extractDomain, stringSimilarity, formatBalance } from '../../core/utils';
import stateManager from '../../core/state';
import monarchApi from '../../api/monarch';
import toast from '../toast';
import { addModalKeyboardHandlers, makeItemsKeyboardNavigable } from '../keyboardNavigation';
import { showAccountCreationDialog } from './accountCreationDialog';
import { showConfirmationDialog } from './confirmationDialog';

interface BalanceInfo {
  amount?: number;
  currency?: string;
}

interface CreateDefaults {
  defaultName?: string;
  defaultType?: string;
  defaultSubtype?: string;
  currentBalance?: BalanceInfo;
  balanceOnlyTracking?: boolean;
  accountType?: string;
  warningMessage?: string;
  trackingMethod?: 'balance' | 'holdings';
  [key: string]: unknown;
}

interface AccountDetails {
  id: string;
  displayName?: string;
  currentBalance?: number;
  signedBalance?: number;
  logoUrl?: string;
  type?: { name: string };
  subtype?: { name: string; display?: string };
  isManual?: boolean;
  icon?: string;
  limit?: number;
}

interface AccountEntry {
  id?: string;
  displayName?: string;
  displayBalance?: number;
  signedBalance?: number;
  logoUrl?: string;
  type?: { name: string };
  subtype?: { name: string; display?: string };
  isHidden?: boolean;
  dataProviderDeactivatedAt?: string | null;
  credential?: CredentialInfo | null;
  institution?: InstitutionInfo;
  icon?: string;
  limit?: number;
  details?: AccountDetails;
  similarityScore?: number;
  [key: string]: unknown;
}

interface CredentialInfo {
  id: string;
  institution?: InstitutionInfo;
  dataProvider?: string;
}

interface InstitutionInfo {
  name?: string;
  logo?: string;
  url?: string;
}

interface ConnectionGroup {
  credential: CredentialInfo | null;
  institution?: InstitutionInfo;
  accounts: AccountEntry[];
  isManual: boolean;
}

interface InstitutionEntry {
  credential: CredentialInfo;
  institution?: InstitutionInfo;
  accounts: AccountEntry[];
  hasMatchingAccounts: boolean;
  domainMatchScore: number;
  isManual: boolean;
}

interface AccountTypeSummary {
  type: { name: string };
  accounts: AccountEntry[];
}

interface AccountsData {
  accountTypeSummaries: AccountTypeSummary[];
}

type AccountCallback = (account: Record<string, unknown> | AccountDetails | null) => void;

/**
 * Show Monarch account selector with create option
 * Uses getAccountsByType() to fetch accounts grouped by type, then aggregates by credential
 */
export async function showMonarchAccountSelectorWithCreate(
  accounts: AccountEntry[],
  callback: AccountCallback,
  _originalAccounts: AccountEntry[] | null = null,
  accountType: string | null = null,
  createDefaults: CreateDefaults = {},
): Promise<void> {
  const effectiveAccountType = accountType || 'brokerage';

  debugLog('Starting account selector with create option', {
    accountType: effectiveAccountType,
    createDefaults,
  });

  try {
    // Fetch accounts grouped by type using new API
    debugLog('Fetching accounts by type for account selector');
    const accountsData = await monarchApi.getAccountsByType() as AccountsData;

    // Get current domain for matching
    const currentDomain = extractDomain(window.location.href);

    // Filter accounts by requested type if specified
    let accountsToProcess: AccountEntry[] = [];
    if (effectiveAccountType) {
      const typeSummary = accountsData.accountTypeSummaries.find(
        (s) => s.type.name === effectiveAccountType,
      );
      accountsToProcess = typeSummary?.accounts || [];
    } else {
      // No type filter - include all accounts from all summaries
      accountsToProcess = accountsData.accountTypeSummaries.flatMap((s) => s.accounts);
    }

    debugLog(`Found ${accountsToProcess.length} accounts of type ${effectiveAccountType}`);

    // Aggregate accounts by credential.id (manual accounts have null credential)
    const connectionMap = new Map<string, ConnectionGroup>();

    accountsToProcess.forEach((account) => {
      // Skip hidden or deleted accounts
      if (account.isHidden || account.dataProviderDeactivatedAt) {
        return;
      }

      const credId = account.credential?.id || 'manual';

      if (!connectionMap.has(credId)) {
        connectionMap.set(credId, {
          credential: account.credential || null,
          institution: account.institution || account.credential?.institution,
          accounts: [],
          isManual: credId === 'manual',
        });
      }

      connectionMap.get(credId)!.accounts.push({
        ...account,
        // Create details object for compatibility with existing UI
        details: {
          id: account.id as string,
          displayName: account.displayName,
          currentBalance: account.displayBalance,
          signedBalance: account.signedBalance,
          logoUrl: account.logoUrl,
          type: account.type,
          subtype: account.subtype,
          isManual: account.credential === null,
          icon: account.icon,
          limit: account.limit,
        },
      });
    });

    // Build institution list from connection map
    const institutionList: InstitutionEntry[] = Array.from(connectionMap.values()).map((conn) => {
      const institutionDomain = extractDomain(conn.institution?.url || '');
      const domainMatchScore = institutionDomain && currentDomain && institutionDomain === currentDomain ? 1 : 0;

      return {
        credential: conn.credential || {
          // Fake credential for manual accounts
          id: 'manual',
          institution: { name: 'Manual Accounts', logo: undefined },
          dataProvider: 'Manual',
        },
        institution: conn.institution,
        accounts: conn.accounts,
        hasMatchingAccounts: conn.accounts.length > 0,
        domainMatchScore,
        isManual: conn.isManual,
      };
    });

    // Filter to only institutions with accounts and sort
    const validInstitutions = institutionList.filter((inst) => inst.hasMatchingAccounts);

    // Sort: Manual accounts first, then by domain match, then alphabetically
    validInstitutions.sort((a, b) => {
      // Manual accounts always first
      if (a.isManual && !b.isManual) return -1;
      if (!a.isManual && b.isManual) return 1;

      // Then by domain match
      if (b.domainMatchScore !== a.domainMatchScore) {
        return b.domainMatchScore - a.domainMatchScore;
      }

      // Then alphabetically
      const nameA = a.credential?.institution?.name || a.institution?.name || '';
      const nameB = b.credential?.institution?.name || b.institution?.name || '';
      return nameA.localeCompare(nameB);
    });

    debugLog(`Grouped into ${validInstitutions.length} connections`, {
      connections: validInstitutions.map((i) => ({
        name: i.credential?.institution?.name || i.institution?.name || 'Manual',
        accountCount: i.accounts.length,
        isManual: i.isManual,
      })),
    });

    // Show institution selector with create option
    showInstitutionSelectorWithCreate(validInstitutions, callback, effectiveAccountType, createDefaults);
  } catch (error) {
    debugLog('Failed to get accounts by type:', error);
    // Fall back to flat selector with create option using legacy accounts param
    showFlatAccountSelectorWithCreate(accounts || [], callback, createDefaults);
  }
}

/**
 * Show institution selector with "Create New Account" button
 */
function showInstitutionSelectorWithCreate(
  institutions: InstitutionEntry[],
  callback: AccountCallback,
  accountType: string,
  createDefaults: CreateDefaults,
): void {
  debugLog('Showing institution selector with create option', {
    institutionsCount: institutions ? institutions.length : 0,
    accountType,
  });

  let cleanupKeyboard = (): void => {};

  const overlay = createModalOverlay(() => {
    cleanupKeyboard();
    overlay.remove();
    callback(null);
  });
  overlay.id = 'institution-selector-overlay';

  const modal = document.createElement('div');
  modal.id = 'institution-selector-modal';
  modal.style.cssText = `
    background: var(--mu-bg-primary, white);
    color: var(--mu-text-primary, #333);
    padding: 25px;
    border-radius: 8px;
    width: 90%;
    max-width: 500px;
    max-height: 80vh;
    overflow-y: auto;
  `;

  // Add header
  const header = document.createElement('h2');
  header.id = 'institution-selector-header';
  header.style.cssText = 'margin-top:0; margin-bottom: 15px; font-size: 1.2em;';
  header.textContent = 'Select Institution';
  modal.appendChild(header);

  // Add prominent account banner
  const currentState = stateManager.getState();
  const currentAccountName = currentState.currentAccount.nickname || 'Unknown Account';
  const currentAccountId = currentState.currentAccount.id || '';

  const accountBanner = document.createElement('div');
  accountBanner.id = 'institution-selector-account-banner';
  accountBanner.style.cssText = `
    background: var(--mu-status-processing-bg, #e3f2fd);
    padding: 12px 15px;
    border-radius: 6px;
    margin-bottom: 20px;
    border-left: 4px solid #1976d2;
  `;

  const accountNameDiv = document.createElement('div');
  accountNameDiv.id = 'institution-selector-account-name';
  accountNameDiv.style.cssText = 'font-size: 1.1em; font-weight: bold; color: var(--mu-status-processing-text, #1565c0);';
  accountNameDiv.textContent = `Mapping: ${currentAccountName}`;
  accountBanner.appendChild(accountNameDiv);

  // Display current balance
  if (createDefaults.currentBalance) {
    const balanceDiv = document.createElement('div');
    balanceDiv.id = 'institution-selector-account-balance';
    balanceDiv.style.cssText = 'font-size: 0.85em; color: var(--mu-text-secondary, #666); margin-top: 4px;';
    balanceDiv.textContent = `Balance: ${formatBalance(createDefaults.currentBalance)}`;
    accountBanner.appendChild(balanceDiv);
  }

  // Display account type
  if (createDefaults.accountType) {
    const accountTypeDiv = document.createElement('div');
    accountTypeDiv.id = 'institution-selector-account-type';
    accountTypeDiv.style.cssText = 'font-size: 0.85em; color: var(--mu-text-secondary, #666); margin-top: 4px;';
    accountTypeDiv.textContent = 'Account Type: ';
    const typeCode = document.createElement('code');
    typeCode.style.cssText = 'background-color: #f0f0f0; padding: 2px 4px; border-radius: 3px; font-family: monospace; font-size: 0.95em;';
    typeCode.textContent = createDefaults.accountType;
    accountTypeDiv.appendChild(typeCode);
    accountBanner.appendChild(accountTypeDiv);
  }

  if (currentAccountId) {
    const accountIdDiv = document.createElement('div');
    accountIdDiv.id = 'institution-selector-account-id';
    accountIdDiv.style.cssText = 'font-size: 0.85em; color: var(--mu-text-secondary, #666); margin-top: 4px;';
    accountIdDiv.textContent = `Account ID: ${currentAccountId}`;
    accountBanner.appendChild(accountIdDiv);
  }

  modal.appendChild(accountBanner);

  // Warning message banner (if provided - e.g., when previously mapped account was deleted)
  if (createDefaults.warningMessage) {
    const warningBanner = document.createElement('div');
    warningBanner.id = 'institution-selector-warning-banner';
    warningBanner.style.cssText = `
      background: var(--mu-warning-bg, #fff3cd);
      padding: 12px 15px;
      border-radius: 6px;
      margin-bottom: 15px;
      border-left: 4px solid #ffc107;
      color: var(--mu-warning-text, #856404);
      font-size: 0.95em;
      line-height: 1.4;
    `;

    const warningIcon = document.createElement('span');
    warningIcon.textContent = '⚠️ ';
    warningIcon.style.marginRight = '5px';
    warningBanner.appendChild(warningIcon);

    const warningText = document.createElement('span');
    warningText.textContent = createDefaults.warningMessage;
    warningBanner.appendChild(warningText);

    modal.appendChild(warningBanner);
  }

  // Add "Create New Account" button(s)
  // For investment accounts (brokerage), show two options: Track Balance and Track Holdings
  // Unless balanceOnlyTracking is true (e.g., for Canada Life where holdings are private mutual funds)
  const isInvestmentAccount = accountType === 'brokerage';
  const showHoldingsOption = isInvestmentAccount && !createDefaults.balanceOnlyTracking;

  if (isInvestmentAccount) {
    // Create button for balance tracking
    const createBalanceButton = document.createElement('button');
    createBalanceButton.id = 'create-new-account-balance-button';
    createBalanceButton.type = 'button';
    // Simplify button text if this is the only option
    createBalanceButton.textContent = showHoldingsOption
      ? '+ Create New Account (Track Balance)'
      : '+ Create New Account';
    createBalanceButton.style.cssText = `
      width: 100%;
      padding: 15px;
      background-color: #1976d2;
      color: white;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      font-size: 1em;
      font-weight: bold;
      margin-bottom: ${showHoldingsOption ? '10px' : '20px'};
      transition: background-color 0.2s;
    `;
    createBalanceButton.onmouseover = () => {
      createBalanceButton.style.backgroundColor = '#1565c0';
    };
    createBalanceButton.onmouseout = () => {
      createBalanceButton.style.backgroundColor = '#1976d2';
    };
    createBalanceButton.onclick = async () => {
      cleanupKeyboard();
      overlay.remove();

      const createdAccount = await showAccountCreationDialog({ ...createDefaults, trackingMethod: 'balance' });
      callback(createdAccount);
    };
    modal.appendChild(createBalanceButton);

    // Create button for holdings tracking (only if not balance-only mode)
    if (showHoldingsOption) {
      const createHoldingsButton = document.createElement('button');
      createHoldingsButton.id = 'create-new-account-holdings-button';
      createHoldingsButton.type = 'button';
      createHoldingsButton.textContent = '+ Create Manual Investment Account (Track Holdings)';
      createHoldingsButton.style.cssText = `
        width: 100%;
        padding: 15px;
        background-color: #2e7d32;
        color: white;
        border: none;
        border-radius: 8px;
        cursor: pointer;
        font-size: 1em;
        font-weight: bold;
        margin-bottom: 20px;
        transition: background-color 0.2s;
      `;
      createHoldingsButton.onmouseover = () => {
        createHoldingsButton.style.backgroundColor = '#1b5e20';
      };
      createHoldingsButton.onmouseout = () => {
        createHoldingsButton.style.backgroundColor = '#2e7d32';
      };
      createHoldingsButton.onclick = async () => {
        cleanupKeyboard();
        overlay.remove();

        const createdAccount = await showAccountCreationDialog({ ...createDefaults, trackingMethod: 'holdings' });
        callback(createdAccount);
      };
      modal.appendChild(createHoldingsButton);
    }
  } else {
    // For non-investment accounts, show single create button
    const createAccountButton = document.createElement('button');
    createAccountButton.id = 'create-new-account-button';
    createAccountButton.type = 'button';
    createAccountButton.textContent = '+ Create New Account';
    createAccountButton.style.cssText = `
      width: 100%;
      padding: 15px;
      background-color: #1976d2;
      color: white;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      font-size: 1em;
      font-weight: bold;
      margin-bottom: 20px;
      transition: background-color 0.2s;
    `;
    createAccountButton.onmouseover = () => {
      createAccountButton.style.backgroundColor = '#1565c0';
    };
    createAccountButton.onmouseout = () => {
      createAccountButton.style.backgroundColor = '#1976d2';
    };
    createAccountButton.onclick = async () => {
      cleanupKeyboard();
      overlay.remove();

      const createdAccount = await showAccountCreationDialog(createDefaults);
      callback(createdAccount);
    };
    modal.appendChild(createAccountButton);
  }

  // Skip Account button
  const skipAccountButton = document.createElement('button');
  skipAccountButton.id = 'institution-selector-skip-button';
  skipAccountButton.type = 'button';
  skipAccountButton.textContent = 'Skip Account';
  skipAccountButton.style.cssText = `
    width: 100%;
    padding: 15px;
    background-color: #9e9e9e;
    color: white;
    border: none;
    border-radius: 8px;
    cursor: pointer;
    font-size: 1em;
    font-weight: bold;
    margin-bottom: 20px;
    transition: background-color 0.2s;
  `;
  skipAccountButton.onmouseover = () => {
    skipAccountButton.style.backgroundColor = '#757575';
  };
  skipAccountButton.onmouseout = () => {
    skipAccountButton.style.backgroundColor = '#9e9e9e';
  };
  skipAccountButton.onclick = () => {
    cleanupKeyboard();
    overlay.remove();
    // Pass full account context when skipping
    callback({
      skipped: true,
      accountId: currentState.currentAccount.id,
      accountName: currentAccountName,
      balance: createDefaults.currentBalance,
      accountType: createDefaults.accountType,
    });
  };
  modal.appendChild(skipAccountButton);

  // Divider
  const divider = document.createElement('div');
  divider.id = 'institution-selector-divider';
  divider.style.cssText = `
    text-align: center;
    margin: 20px 0;
    color: var(--mu-text-secondary, #666);
    font-size: 0.9em;
  `;
  divider.textContent = 'Or select existing account:';
  modal.appendChild(divider);

  // No institutions message
  if (!institutions.length) {
    const noInst = document.createElement('div');
    const accountTypeDisplay = accountType === 'credit' ? 'credit card' : accountType === 'brokerage' ? 'investment' : accountType;
    noInst.textContent = `No institutions found with ${accountTypeDisplay} accounts.`;
    noInst.style.cssText = 'color: var(--mu-text-secondary, #666); padding: 20px 0;';
    modal.appendChild(noInst);
  }

  const institutionItems: HTMLElement[] = [];

  // Add each institution
  institutions.forEach((inst) => {
    const item = createInstitutionItem(inst);
    item.onclick = () => {
      debugLog('Navigating to account selector', {
        selectedInstitution: inst.credential.institution?.name || 'Unknown',
      });
      cleanupKeyboard();
      overlay.remove();
      showAccountSelectorWithCreate(inst, callback, institutions, accountType, createDefaults);
    };
    modal.appendChild(item);
    institutionItems.push(item);
  });

  // Add cancel button
  const cancelBtn = document.createElement('button');
  cancelBtn.id = 'institution-selector-cancel';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.style.cssText = `
    padding: 8px 16px;
    background-color: var(--mu-bg-tertiary, #f5f5f5);
    color: var(--mu-text-primary, #333);
    border: none;
    border-radius: 4px;
    cursor: pointer;
    margin-top: 10px;
  `;
  cancelBtn.onclick = () => {
    cleanupKeyboard();
    overlay.remove();
    callback(null);
  };
  modal.appendChild(cancelBtn);

  // Add keyboard handlers
  const cleanupModalHandlers = addModalKeyboardHandlers(overlay, () => {
    cleanupKeyboard();
    overlay.remove();
    callback(null);
  });

  let cleanupItemNavigation = (): void => {};
  if (institutionItems.length > 0) {
    cleanupItemNavigation = makeItemsKeyboardNavigable(
      institutionItems,
      (_item: HTMLElement, index: number) => {
        const inst = institutions[index];
        cleanupKeyboard();
        overlay.remove();
        showAccountSelectorWithCreate(inst, callback, institutions, accountType, createDefaults);
      },
      0,
    );
  }

  cleanupKeyboard = () => {
    cleanupModalHandlers();
    cleanupItemNavigation();
  };

  overlay.appendChild(modal);
  document.body.appendChild(overlay);
}

/**
 * Show account selector with "Create New Account" option
 */
function showAccountSelectorWithCreate(
  institution: InstitutionEntry,
  callback: AccountCallback,
  allInstitutions: InstitutionEntry[],
  accountType: string,
  createDefaults: CreateDefaults,
): void {
  const allInsts = allInstitutions || [institution];
  const cred = institution.credential;
  const accounts = institution.accounts || [];

  const currentState = stateManager.getState();
  const currentAccountName = currentState.currentAccount.nickname || '';

  debugLog('Showing account selector with create option', {
    institutionName: cred.institution?.name || 'Unknown',
    accountsCount: accounts.length,
  });

  if (!accounts.length) {
    toast.show(`No valid accounts found for ${cred.institution?.name || 'this institution'}`, 'error');
    callback(null);
    return;
  }

  // Calculate similarity scores
  const accountsWithScores = accounts.map((account) => ({
    ...account,
    similarityScore: stringSimilarity(account.details?.displayName || '', currentAccountName || ''),
  }));
  accountsWithScores.sort((a, b) => (b.similarityScore || 0) - (a.similarityScore || 0));

  let cleanupKeyboard = (): void => {};
  let overlay: HTMLDivElement;

  const closeModal = (): void => {
    cleanupKeyboard();
    overlay.remove();
    callback(null);
  };

  const backAction = (): void => {
    cleanupKeyboard();
    overlay.remove();
    showInstitutionSelectorWithCreate(allInsts, callback, accountType, createDefaults);
  };

  overlay = createModalOverlay(closeModal);
  overlay.id = 'account-selector-overlay';

  const modal = document.createElement('div');
  modal.id = 'account-selector-modal';
  modal.style.cssText = `
    background: var(--mu-bg-primary, white);
    color: var(--mu-text-primary, #333);
    padding: 25px;
    border-radius: 8px;
    width: 90%;
    max-width: 500px;
    max-height: 80vh;
    overflow-y: auto;
  `;

  // Back button
  const backButton = document.createElement('div');
  backButton.id = 'account-selector-back';
  backButton.style.cssText = `
    display: flex;
    align-items: center;
    font-size: 0.9em;
    color: var(--mu-link-color, #0066cc);
    cursor: pointer;
    margin-bottom: 20px;
  `;
  backButton.innerHTML = '&lsaquo; Back to institutions';
  backButton.onclick = backAction;
  backButton.setAttribute('tabindex', '0');
  backButton.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      backAction();
    }
  });
  modal.appendChild(backButton);

  // Header
  const header = document.createElement('h2');
  header.id = 'account-selector-header';
  header.style.cssText = 'margin-top:0; margin-bottom: 15px; font-size: 1.2em;';
  header.textContent = cred.institution?.name || 'Select Account';
  modal.appendChild(header);

  // Account banner (enhanced)
  const currentAccountId = currentState.currentAccount.id || '';

  const accountBanner = document.createElement('div');
  accountBanner.id = 'account-selector-account-banner';
  accountBanner.style.cssText = `
    background: var(--mu-status-processing-bg, #e3f2fd);
    padding: 12px 15px;
    border-radius: 6px;
    margin-bottom: 20px;
    border-left: 4px solid #1976d2;
  `;

  const accountNameDiv = document.createElement('div');
  accountNameDiv.id = 'account-selector-account-name';
  accountNameDiv.style.cssText = 'font-size: 1.1em; font-weight: bold; color: var(--mu-status-processing-text, #1565c0);';
  accountNameDiv.textContent = `Mapping: ${currentAccountName}`;
  accountBanner.appendChild(accountNameDiv);

  // Display current balance
  if (createDefaults.currentBalance) {
    const balanceDiv = document.createElement('div');
    balanceDiv.id = 'account-selector-account-balance';
    balanceDiv.style.cssText = 'font-size: 0.85em; color: var(--mu-text-secondary, #666); margin-top: 4px;';
    balanceDiv.textContent = `Balance: ${formatBalance(createDefaults.currentBalance)}`;
    accountBanner.appendChild(balanceDiv);
  }

  // Display account type
  if (createDefaults.accountType) {
    const accountTypeDiv = document.createElement('div');
    accountTypeDiv.id = 'account-selector-account-type';
    accountTypeDiv.style.cssText = 'font-size: 0.85em; color: var(--mu-text-secondary, #666); margin-top: 4px;';
    accountTypeDiv.textContent = 'Account Type: ';
    const typeCode = document.createElement('code');
    typeCode.style.cssText = 'background-color: var(--mu-bg-tertiary, #f0f0f0); padding: 2px 4px; border-radius: 3px; font-family: monospace; font-size: 0.95em; color: var(--mu-text-primary, #333);';
    typeCode.textContent = createDefaults.accountType;
    accountTypeDiv.appendChild(typeCode);
    accountBanner.appendChild(accountTypeDiv);
  }

  if (currentAccountId) {
    const accountIdDiv = document.createElement('div');
    accountIdDiv.id = 'account-selector-account-id';
    accountIdDiv.style.cssText = 'font-size: 0.85em; color: var(--mu-text-secondary, #666); margin-top: 4px;';
    accountIdDiv.textContent = `Account ID: ${currentAccountId}`;
    accountBanner.appendChild(accountIdDiv);
  }

  modal.appendChild(accountBanner);

  // Create New Account button
  const createAccountButton = document.createElement('button');
  createAccountButton.id = 'account-selector-create-button';
  createAccountButton.type = 'button';
  createAccountButton.textContent = '+ Create New Account';
  createAccountButton.style.cssText = `
    width: 100%;
    padding: 12px;
    background-color: #1976d2;
    color: white;
    border: none;
    border-radius: 8px;
    cursor: pointer;
    font-size: 0.95em;
    font-weight: bold;
    margin-bottom: 15px;
    transition: background-color 0.2s;
  `;
  createAccountButton.onmouseover = () => {
    createAccountButton.style.backgroundColor = '#1565c0';
  };
  createAccountButton.onmouseout = () => {
    createAccountButton.style.backgroundColor = '#1976d2';
  };
  createAccountButton.onclick = async () => {
    cleanupKeyboard();
    overlay.remove();

    const createdAccount = await showAccountCreationDialog(createDefaults);
    callback(createdAccount);
  };
  modal.appendChild(createAccountButton);

  // Skip Account button
  const skipAccountButton = document.createElement('button');
  skipAccountButton.id = 'account-selector-skip-button';
  skipAccountButton.type = 'button';
  skipAccountButton.textContent = 'Skip Account';
  skipAccountButton.style.cssText = `
    width: 100%;
    padding: 12px;
    background-color: #9e9e9e;
    color: white;
    border: none;
    border-radius: 8px;
    cursor: pointer;
    font-size: 0.95em;
    font-weight: bold;
    margin-bottom: 15px;
    transition: background-color 0.2s;
  `;
  skipAccountButton.onmouseover = () => {
    skipAccountButton.style.backgroundColor = '#757575';
  };
  skipAccountButton.onmouseout = () => {
    skipAccountButton.style.backgroundColor = '#9e9e9e';
  };
  skipAccountButton.onclick = () => {
    cleanupKeyboard();
    overlay.remove();
    // Pass full account context when skipping
    callback({
      skipped: true,
      accountId: currentState.currentAccount.id,
      accountName: currentAccountName,
      balance: createDefaults.currentBalance,
      accountType: createDefaults.accountType,
    });
  };
  modal.appendChild(skipAccountButton);

  // Divider
  const divider = document.createElement('div');
  divider.id = 'account-selector-divider';
  divider.style.cssText = `
    text-align: center;
    margin: 15px 0;
    color: var(--mu-text-secondary, #666);
    font-size: 0.85em;
  `;
  divider.textContent = 'Or select existing:';
  modal.appendChild(divider);

  const accountItems: HTMLElement[] = [];

  // Add accounts
  accountsWithScores.forEach((account, index) => {
    const item = createAccountItem(account, cred, index);
    item.onclick = () => {
      cleanupKeyboard();
      overlay.remove();
      callback(account.details!);
    };
    modal.appendChild(item);
    accountItems.push(item);
  });

  // Cancel button
  const cancelBtn = document.createElement('button');
  cancelBtn.id = 'account-selector-cancel';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.style.cssText = `
    padding: 8px 16px;
    background-color: var(--mu-cancel-btn-bg, #f5f5f5);
    color: var(--mu-cancel-btn-text, #333);
    border: none;
    border-radius: 4px;
    cursor: pointer;
    margin-top: 10px;
  `;
  cancelBtn.onclick = async () => {
    const confirmed = await showConfirmationDialog(
      'Are you sure you want to cancel the sync for all remaining accounts?',
      'Yes, Cancel All',
      'No, Continue',
    );
    if (confirmed) {
      cleanupKeyboard();
      overlay.remove();
      callback({ cancelled: true });
    }
  };
  modal.appendChild(cancelBtn);

  // Keyboard handlers
  const cleanupModalHandlers = addModalKeyboardHandlers(overlay, closeModal);

  let cleanupItemNavigation = (): void => {};
  if (accountItems.length > 0) {
    cleanupItemNavigation = makeItemsKeyboardNavigable(
      accountItems,
      (_item: HTMLElement, index: number) => {
        const account = accountsWithScores[index];
        cleanupKeyboard();
        overlay.remove();
        callback(account.details!);
      },
      0,
    );
  }

  cleanupKeyboard = () => {
    cleanupModalHandlers();
    cleanupItemNavigation();
  };

  overlay.appendChild(modal);
  document.body.appendChild(overlay);
}

/**
 * Fallback flat account selector with create option
 */
function showFlatAccountSelectorWithCreate(
  accounts: AccountEntry[],
  callback: AccountCallback,
  createDefaults: CreateDefaults,
): void {
  const overlay = createModalOverlay(() => {
    overlay.remove();
    callback(null);
  });
  overlay.id = 'flat-account-selector-overlay';

  const modal = document.createElement('div');
  modal.id = 'flat-account-selector-modal';
  modal.style.cssText = `
    background: var(--mu-bg-primary, white);
    color: var(--mu-text-primary, #333);
    padding: 25px;
    border-radius: 8px;
    width: 90%;
    max-width: 500px;
    max-height: 80vh;
    overflow-y: auto;
  `;

  const currentState = stateManager.getState();
  const currentAccountName = currentState.currentAccount.nickname || 'Unknown Account';
  const currentAccountId = currentState.currentAccount.id || '';

  const title = document.createElement('h2');
  title.id = 'flat-account-selector-title';
  title.style.cssText = 'margin-top:0; margin-bottom: 15px; font-size: 1.2em;';
  title.textContent = 'Select Monarch Account';
  modal.appendChild(title);

  // Add prominent account banner
  const accountBanner = document.createElement('div');
  accountBanner.id = 'flat-account-selector-account-banner';
  accountBanner.style.cssText = `
    background: var(--mu-status-processing-bg, #e3f2fd);
    padding: 12px 15px;
    border-radius: 6px;
    margin-bottom: 20px;
    border-left: 4px solid #1976d2;
  `;

  const accountNameDiv = document.createElement('div');
  accountNameDiv.id = 'flat-account-selector-account-name';
  accountNameDiv.style.cssText = 'font-size: 1.1em; font-weight: bold; color: var(--mu-status-processing-text, #1565c0);';
  accountNameDiv.textContent = `Mapping: ${currentAccountName}`;
  accountBanner.appendChild(accountNameDiv);

  // Display current balance
  if (createDefaults.currentBalance) {
    const balanceDiv = document.createElement('div');
    balanceDiv.id = 'flat-account-selector-account-balance';
    balanceDiv.style.cssText = 'font-size: 0.85em; color: var(--mu-text-secondary, #666); margin-top: 4px;';
    balanceDiv.textContent = `Balance: ${formatBalance(createDefaults.currentBalance)}`;
    accountBanner.appendChild(balanceDiv);
  }

  // Display account type
  if (createDefaults.accountType) {
    const accountTypeDiv = document.createElement('div');
    accountTypeDiv.id = 'flat-account-selector-account-type';
    accountTypeDiv.style.cssText = 'font-size: 0.85em; color: var(--mu-text-secondary, #666); margin-top: 4px;';
    accountTypeDiv.textContent = 'Account Type: ';
    const typeCode = document.createElement('code');
    typeCode.style.cssText = 'background-color: var(--mu-bg-tertiary, #f0f0f0); padding: 2px 4px; border-radius: 3px; font-family: monospace; font-size: 0.95em; color: var(--mu-text-primary, #333);';
    typeCode.textContent = createDefaults.accountType;
    accountTypeDiv.appendChild(typeCode);
    accountBanner.appendChild(accountTypeDiv);
  }

  if (currentAccountId) {
    const accountIdDiv = document.createElement('div');
    accountIdDiv.id = 'flat-account-selector-account-id';
    accountIdDiv.style.cssText = 'font-size: 0.85em; color: var(--mu-text-secondary, #666); margin-top: 4px;';
    accountIdDiv.textContent = `Account ID: ${currentAccountId}`;
    accountBanner.appendChild(accountIdDiv);
  }

  modal.appendChild(accountBanner);

  // Create New Account button
  const createAccountButton = document.createElement('button');
  createAccountButton.id = 'flat-account-selector-create-button';
  createAccountButton.type = 'button';
  createAccountButton.textContent = '+ Create New Account';
  createAccountButton.style.cssText = `
    width: 100%;
    padding: 12px;
    background-color: #1976d2;
    color: white;
    border: none;
    border-radius: 8px;
    cursor: pointer;
    font-size: 0.95em;
    font-weight: bold;
    margin-bottom: 15px;
    transition: background-color 0.2s;
  `;
  createAccountButton.onmouseover = () => {
    createAccountButton.style.backgroundColor = '#1565c0';
  };
  createAccountButton.onmouseout = () => {
    createAccountButton.style.backgroundColor = '#1976d2';
  };
  createAccountButton.onclick = async () => {
    overlay.remove();
    const createdAccount = await showAccountCreationDialog(createDefaults);
    callback(createdAccount);
  };
  modal.appendChild(createAccountButton);

  // Divider
  const divider = document.createElement('div');
  divider.style.cssText = `
    text-align: center;
    margin: 15px 0;
    color: var(--mu-text-secondary, #666);
    font-size: 0.85em;
  `;
  divider.textContent = 'Or select existing:';
  modal.appendChild(divider);

  // Add accounts
  accounts.forEach((acc) => {
    const item = document.createElement('div');
    item.style.cssText = `
      display: flex;
      align-items: center;
      padding: 10px;
      border-radius: 5px;
      cursor: pointer;
      margin-bottom: 10px;
      border: 1px solid var(--mu-border-light, #eee);
    `;

    if (acc.logoUrl) {
      GM_addElement(item, 'img', {
        src: acc.logoUrl,
        style: 'width: 40px; height: 40px; margin-right: 15px; border-radius: 5px;',
      });
    }

    const infoDiv = document.createElement('div');
    infoDiv.style.flexGrow = '1';

    const nameDiv = document.createElement('div');
    nameDiv.style.cssText = 'font-weight: bold;';
    nameDiv.textContent = acc.displayName || '';
    infoDiv.appendChild(nameDiv);

    if (acc.displayBalance !== undefined) {
      const balanceDiv = document.createElement('div');
      balanceDiv.style.cssText = 'font-size: 0.9em; color: var(--mu-text-secondary, #555);';
      balanceDiv.textContent = `Balance: ${new Intl.NumberFormat().format(acc.displayBalance)}`;
      infoDiv.appendChild(balanceDiv);
    }

    item.appendChild(infoDiv);

    item.onmouseover = () => {
      item.style.backgroundColor = 'var(--mu-bg-tertiary, #f5f5f5)';
      item.style.borderColor = 'var(--mu-border-color, #ddd)';
    };
    item.onmouseout = () => {
      item.style.backgroundColor = '';
      item.style.borderColor = 'var(--mu-border-light, #eee)';
    };

    item.onclick = () => {
      overlay.remove();
      callback(acc as Record<string, unknown>);
    };

    modal.appendChild(item);
  });

  // Cancel button
  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Cancel';
  cancelBtn.style.cssText = `
    padding: 8px 16px;
    background-color: var(--mu-cancel-btn-bg, #f5f5f5);
    color: var(--mu-cancel-btn-text, #333);
    border: none;
    border-radius: 4px;
    cursor: pointer;
    margin-top: 10px;
  `;
  cancelBtn.onclick = () => {
    overlay.remove();
    callback(null);
  };
  modal.appendChild(cancelBtn);

  overlay.appendChild(modal);
  document.body.appendChild(overlay);
}

/**
 * Add a letter-based logo fallback
 */
function addLogoFallback(container: HTMLElement, name: string | undefined): void {
  const fallback = document.createElement('div');
  fallback.style.cssText = `
    width: 40px;
    height: 40px;
    background-color: var(--mu-bg-tertiary, #ddd);
    color: var(--mu-text-secondary, #666);
    border-radius: 5px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: bold;
    font-size: 1.2em;
  `;
  fallback.textContent = (name || 'U')[0].toUpperCase();
  container.appendChild(fallback);
}

/**
 * Add institution logo to container with proper handling of URLs vs base64
 */
function addInstitutionLogo(
  container: HTMLElement,
  cred: CredentialInfo,
  accounts: AccountEntry[] | null = null,
): boolean {
  let logoHandled = false;

  // Priority 1: Institution logo (base64 or URL)
  if (cred.institution?.logo && !logoHandled) {
    try {
      const isUrl = typeof cred.institution.logo === 'string'
                   && (cred.institution.logo.trim().toLowerCase().startsWith('http')
                    || cred.institution.logo.trim().toLowerCase().startsWith('//'));

      if (isUrl) {
        // It's a URL - use GM_addElement to avoid CSP issues
        GM_addElement(container, 'img', {
          src: cred.institution.logo,
          style: 'width: 40px; height: 40px; border-radius: 5px; object-fit: contain;',
        });
        logoHandled = true;
      } else {
        // It's base64 data - add data URI prefix
        const logoImg = document.createElement('img');
        logoImg.src = `data:image/png;base64,${cred.institution.logo}`;
        logoImg.style.cssText = 'width: 40px; height: 40px; border-radius: 5px; object-fit: contain;';
        container.appendChild(logoImg);
        logoHandled = true;
      }
    } catch (e) {
      debugLog('Error processing institution logo:', e);
    }
  }

  // Priority 2: Account logoUrl (fallback)
  if (!logoHandled && accounts) {
    const accountWithLogo = accounts.find((acc) => acc.details?.logoUrl);
    if (accountWithLogo && accountWithLogo.details!.logoUrl) {
      try {
        GM_addElement(container, 'img', {
          src: accountWithLogo.details!.logoUrl,
          style: 'width: 40px; height: 40px; border-radius: 5px; object-fit: contain;',
        });
        logoHandled = true;
      } catch (e) {
        debugLog('Error loading account logo:', e);
      }
    }
  }

  // Priority 3: Letter-based fallback
  if (!logoHandled) {
    addLogoFallback(container, cred.institution?.name);
    logoHandled = true;
  }

  return logoHandled;
}

/**
 * Add account logo to container with fallback chain: account.logoUrl → institution logo → letter
 */
function addAccountLogo(
  container: HTMLElement,
  account: AccountEntry,
  cred: CredentialInfo,
): boolean {
  let logoHandled = false;
  const accountLogoUrl = account.details?.logoUrl || account.logoUrl;

  // Priority 1: Account's own logo URL
  if (accountLogoUrl && !logoHandled) {
    try {
      GM_addElement(container, 'img', {
        src: accountLogoUrl,
        style: 'width: 40px; height: 40px; border-radius: 5px; object-fit: contain;',
      });
      logoHandled = true;
    } catch (e) {
      debugLog('Error loading account logo:', e);
    }
  }

  // Priority 2: Institution logo from credential (base64 or URL)
  if (!logoHandled && cred.institution?.logo) {
    try {
      const isUrl = typeof cred.institution.logo === 'string'
                   && (cred.institution.logo.trim().toLowerCase().startsWith('http')
                    || cred.institution.logo.trim().toLowerCase().startsWith('//'));

      if (isUrl) {
        GM_addElement(container, 'img', {
          src: cred.institution.logo,
          style: 'width: 40px; height: 40px; border-radius: 5px; object-fit: contain;',
        });
        logoHandled = true;
      } else {
        // It's base64 data
        const logoImg = document.createElement('img');
        logoImg.src = `data:image/png;base64,${cred.institution.logo}`;
        logoImg.style.cssText = 'width: 40px; height: 40px; border-radius: 5px; object-fit: contain;';
        container.appendChild(logoImg);
        logoHandled = true;
      }
    } catch (e) {
      debugLog('Error processing institution logo:', e);
    }
  }

  // Priority 3: Letter-based fallback (use account name, not institution)
  if (!logoHandled) {
    const accountName = account.details?.displayName || account.displayName || 'Unknown';
    addLogoFallback(container, accountName);
    logoHandled = true;
  }

  return logoHandled;
}

/**
 * Create institution item element
 */
function createInstitutionItem(inst: InstitutionEntry): HTMLDivElement {
  const cred = inst.credential;
  const item = document.createElement('div');
  item.style.cssText = `
    display: flex;
    align-items: center;
    padding: 15px;
    border-radius: 8px;
    cursor: pointer;
    margin-bottom: 15px;
    border: 1px solid var(--mu-border-light, #eee);
    transition: all 0.2s;
    position: relative;
  `;

  const logoContainer = document.createElement('div');
  logoContainer.style.cssText = 'margin-right: 15px; flex-shrink: 0;';

  // For manual accounts group, always show letter fallback
  if (inst.isManual) {
    addLogoFallback(logoContainer, 'Manual Accounts');
  } else {
    // Add logo using shared helper for connected accounts
    addInstitutionLogo(logoContainer, cred, inst.accounts);
  }
  item.appendChild(logoContainer);

  const infoDiv = document.createElement('div');
  infoDiv.style.cssText = 'flex-grow: 1;';

  const nameDiv = document.createElement('div');
  nameDiv.style.cssText = 'font-weight: bold; font-size: 1.1em;';
  nameDiv.textContent = cred.institution?.name || 'Unknown Institution';
  infoDiv.appendChild(nameDiv);

  const providerDiv = document.createElement('div');
  providerDiv.style.cssText = 'font-size: 0.9em; color: var(--mu-text-secondary, #666);';
  providerDiv.textContent = cred.dataProvider || '';
  infoDiv.appendChild(providerDiv);

  item.appendChild(infoDiv);

  if (inst.domainMatchScore > 0) {
    const badge = document.createElement('div');
    badge.style.cssText = `
      position: absolute;
      top: 8px;
      right: 8px;
      background-color: var(--mu-status-processing-bg, #e3f2fd);
      color: var(--mu-status-processing-text, #1565c0);
      font-size: 0.75em;
      padding: 2px 6px;
      border-radius: 4px;
    `;
    badge.textContent = 'Recommended';
    item.appendChild(badge);
  }

  const arrowContainer = document.createElement('div');
  arrowContainer.style.cssText = `
    margin-left: 15px;
    font-size: 1.5em;
    color: var(--mu-text-secondary, #aaa);
  `;
  arrowContainer.innerHTML = '&rsaquo;';
  item.appendChild(arrowContainer);

  item.onmouseover = () => {
    item.style.backgroundColor = 'var(--mu-bg-tertiary, #f5f5f5)';
    item.style.borderColor = 'var(--mu-border-color, #ddd)';
  };
  item.onmouseout = () => {
    item.style.backgroundColor = '';
    item.style.borderColor = 'var(--mu-border-light, #eee)';
  };

  return item;
}

/**
 * Create account item element
 */
function createAccountItem(
  account: AccountEntry,
  cred: CredentialInfo,
  index: number,
): HTMLDivElement {
  const item = document.createElement('div');
  item.style.cssText = `
    display: flex;
    align-items: center;
    padding: 15px;
    border-radius: 8px;
    cursor: pointer;
    margin-bottom: 15px;
    border: 1px solid var(--mu-border-light, #eee);
    transition: all 0.2s;
    position: relative;
  `;

  if (index === 0) {
    item.style.backgroundColor = 'var(--mu-item-recommended-bg, #f5f8ff)';
    item.style.borderColor = 'var(--mu-item-recommended-border, #d0d9e6)';
  }

  const logoContainer = document.createElement('div');
  logoContainer.style.cssText = 'margin-right: 15px; flex-shrink: 0;';

  // Add account logo with fallback chain: account.logoUrl → institution logo → letter
  addAccountLogo(logoContainer, account, cred);
  item.appendChild(logoContainer);

  const textContainer = document.createElement('div');
  textContainer.style.flexGrow = '1';

  const nameDiv = document.createElement('div');
  nameDiv.style.cssText = 'font-weight: bold;';
  nameDiv.textContent = account.details?.displayName || account.displayName || 'Unknown Account';
  textContainer.appendChild(nameDiv);

  if (account.details?.currentBalance !== undefined) {
    const balanceDiv = document.createElement('div');
    balanceDiv.style.cssText = 'font-size: 0.9em; color: var(--mu-text-secondary, #555);';
    balanceDiv.textContent = `Balance: ${new Intl.NumberFormat().format(account.details.currentBalance)}`;
    textContainer.appendChild(balanceDiv);
  }

  // Show subtype only (e.g., "Credit Card")
  if (account.subtype?.display) {
    const subtypeDiv = document.createElement('div');
    subtypeDiv.style.cssText = 'font-size: 0.85em; color: var(--mu-text-secondary, #666);';
    subtypeDiv.textContent = account.subtype.display;
    textContainer.appendChild(subtypeDiv);
  }

  if (index === 0) {
    const badge = document.createElement('div');
    badge.style.cssText = `
      position: absolute;
      top: 8px;
      right: 8px;
      background-color: var(--mu-status-success-bg, #e8f5e9);
      color: var(--mu-status-success-text, #2e7d32);
      font-size: 0.75em;
      padding: 2px 6px;
      border-radius: 4px;
    `;
    badge.textContent = 'Recommended';
    item.appendChild(badge);
  }

  item.appendChild(textContainer);

  item.onmouseover = () => {
    if (index !== 0) {
      item.style.backgroundColor = 'var(--mu-bg-tertiary, #f5f5f5)';
    } else {
      item.style.backgroundColor = 'var(--mu-item-recommended-hover-bg, #eef2fd)';
    }
    item.style.borderColor = 'var(--mu-border-color, #ddd)';
  };
  item.onmouseout = () => {
    if (index !== 0) {
      item.style.backgroundColor = '';
    } else {
      item.style.backgroundColor = 'var(--mu-item-recommended-bg, #f5f8ff)';
      item.style.borderColor = 'var(--mu-item-recommended-border, #d0d9e6)';
    }
  };

  return item;
}

/**
 * Create a modal overlay
 */
function createModalOverlay(onClose: () => void): HTMLDivElement {
  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background-color: var(--mu-overlay-bg, rgba(0, 0, 0, 0.5));
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: 10000;
  `;

  overlay.onclick = (e: MouseEvent) => {
    if (e.target === overlay) {
      onClose();
    }
  };

  return overlay;
}

export default {
  showMonarchAccountSelectorWithCreate,
};
