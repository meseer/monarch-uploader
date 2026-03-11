/**
 * CanadaLife Upload Button Component
 * Creates upload button styled for CanadaLife branding
 */

declare function GM_getValue(key: string, defaultValue?: unknown): unknown;

import { debugLog, getTodayLocal, formatDaysAgoLocal } from '../../../core/utils';
import { COLORS, STORAGE } from '../../../core/config';
import canadalife from '../../../api/canadalife';
import toast from '../../toast';
import { uploadAllCanadaLifeAccountsToMonarch, uploadCanadaLifeAccountWithDateRange, uploadTransactionHistory } from '../../../services/canadalife-upload';
import { ensureMonarchAuthentication } from '../../components/monarchLoginLink';
import { validateSelection, validateDateFormat, validateDateRange } from '../../components/formValidation';

interface CanadaLifeButtonOptions {
  color?: string;
  hoverColor?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
}

interface CanadaLifeSourceAccount {
  EnglishShortName: string;
  LongNameEnglish: string;
  EnrollmentDate?: string;
  agreementId?: string;
  [key: string]: unknown;
}

interface ConsolidatedCanadaLifeAccount {
  canadalifeAccount?: CanadaLifeSourceAccount;
  [key: string]: unknown;
}

interface BalanceData {
  openingBalance: number;
  closingBalance: number;
  change: number;
  date: string;
  account: { name: string; shortName: string };
}

interface HistoricalBalanceData {
  data: (string | number)[][];
  account: { name: string; shortName: string };
  dateRange: { startDate: string; endDate: string };
  totalDays: number;
  apiCallsMade: number;
}

interface TransactionResultDisplay {
  transactionCount: number;
  accountName: string;
  dateRange: { startDate: string; endDate: string };
}

function createCanadaLifeButton(text: string, onClick: ((event: MouseEvent) => void) | null, options: CanadaLifeButtonOptions = {}): HTMLButtonElement {
  const button = document.createElement('button');
  button.textContent = text;
  button.style.cssText = `
    background-color: ${options.color || COLORS.CANADALIFE_BRAND};
    color: white;
    border: none;
    border-radius: 4px;
    padding: 10px 16px;
    margin: 5px 0;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s ease;
    box-shadow: 0 2px 4px rgba(162, 10, 41, 0.2);
    ${options.disabled ? 'opacity: 0.6; cursor: not-allowed;' : ''}
  `;
  if (options.id) { button.id = options.id; }
  if (options.className) { button.className = options.className; }
  button.disabled = Boolean(options.disabled);
  button.addEventListener('mouseover', () => {
    if (!button.disabled) {
      button.style.backgroundColor = options.hoverColor || '#8a0922';
      button.style.transform = 'translateY(-1px)';
      button.style.boxShadow = '0 4px 8px rgba(162, 10, 41, 0.3)';
    }
  });
  button.addEventListener('mouseout', () => {
    if (!button.disabled) {
      button.style.backgroundColor = options.color || COLORS.CANADALIFE_BRAND;
      button.style.transform = 'translateY(0)';
      button.style.boxShadow = '0 2px 4px rgba(162, 10, 41, 0.2)';
    }
  });
  if (onClick && !options.disabled) { button.addEventListener('click', onClick); }
  return button;
}

let cachedAccounts: ConsolidatedCanadaLifeAccount[] = [];
let accountSelectorElement: HTMLSelectElement | null = null;
let dateSelectorElement: HTMLInputElement | null = null;
let startDateSelectorElement: HTMLInputElement | null = null;
let endDateSelectorElement: HTMLInputElement | null = null;
let txStartDateSelectorElement: HTMLInputElement | null = null;
let txEndDateSelectorElement: HTMLInputElement | null = null;
let balanceResultElement: HTMLDivElement | null = null;
let historicalBalanceResultElement: HTMLDivElement | null = null;
let transactionResultElement: HTMLDivElement | null = null;
let accountsLoadingState: 'idle' | 'loading' | 'loaded' | 'error' = 'idle';
let loadAccountsRetryCount = 0;
const MAX_RETRY_COUNT = 3;

function createAccountSelector(): HTMLDivElement {
  const container = document.createElement('div');
  container.style.cssText = 'margin: 8px 0;';
  const label = document.createElement('label');
  label.textContent = 'Select Account:';
  label.style.cssText = 'display: block; font-size: 13px; font-weight: 500; margin-bottom: 4px; color: #333;';
  const select = document.createElement('select');
  select.id = 'canadalife-account-selector';
  select.style.cssText = 'width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px; background-color: white;';
  const loadingOption = document.createElement('option');
  loadingOption.value = '';
  loadingOption.textContent = 'Loading accounts...';
  loadingOption.disabled = true;
  loadingOption.selected = true;
  select.appendChild(loadingOption);
  container.appendChild(label);
  container.appendChild(select);
  accountSelectorElement = select;
  autoLoadAccounts();
  return container;
}

function createDateSelector(): HTMLDivElement {
  const container = document.createElement('div');
  container.style.cssText = 'margin: 8px 0;';
  const label = document.createElement('label');
  label.textContent = 'Select Date:';
  label.style.cssText = 'display: block; font-size: 13px; font-weight: 500; margin-bottom: 4px; color: #333;';
  const input = document.createElement('input');
  input.type = 'date';
  input.id = 'canadalife-date-selector';
  input.style.cssText = 'width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px;';
  input.value = getTodayLocal();
  container.appendChild(label);
  container.appendChild(input);
  dateSelectorElement = input;
  return container;
}

function createDateRangeSelector(): HTMLDivElement {
  const container = document.createElement('div');
  container.style.cssText = 'margin: 8px 0;';
  const label = document.createElement('label');
  label.textContent = 'Historical Date Range:';
  label.style.cssText = 'display: block; font-size: 13px; font-weight: 500; margin-bottom: 4px; color: #333;';
  const dateContainer = document.createElement('div');
  dateContainer.style.cssText = 'display: grid; grid-template-columns: 1fr auto 1fr; gap: 8px; align-items: center;';
  const startDateInput = document.createElement('input');
  startDateInput.type = 'date';
  startDateInput.id = 'canadalife-start-date-selector';
  startDateInput.style.cssText = 'padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px;';
  startDateInput.value = formatDaysAgoLocal(7);
  const toText = document.createElement('span');
  toText.textContent = 'to';
  toText.style.cssText = 'font-size: 13px; color: #666; text-align: center;';
  const endDateInput = document.createElement('input');
  endDateInput.type = 'date';
  endDateInput.id = 'canadalife-end-date-selector';
  endDateInput.style.cssText = 'padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px;';
  endDateInput.value = getTodayLocal();
  dateContainer.appendChild(startDateInput);
  dateContainer.appendChild(toText);
  dateContainer.appendChild(endDateInput);
  container.appendChild(label);
  container.appendChild(dateContainer);
  startDateSelectorElement = startDateInput;
  endDateSelectorElement = endDateInput;
  return container;
}

function createTransactionDateRangeSelector(): HTMLDivElement {
  const container = document.createElement('div');
  container.id = 'canadalife-tx-date-range-container';
  container.style.cssText = 'margin: 8px 0;';
  const label = document.createElement('label');
  label.id = 'canadalife-tx-date-range-label';
  label.textContent = 'Transaction Date Range:';
  label.style.cssText = 'display: block; font-size: 13px; font-weight: 500; margin-bottom: 4px; color: #333;';
  const dateContainer = document.createElement('div');
  dateContainer.id = 'canadalife-tx-date-inputs-container';
  dateContainer.style.cssText = 'display: grid; grid-template-columns: 1fr auto 1fr; gap: 8px; align-items: center;';
  const startDateInput = document.createElement('input');
  startDateInput.type = 'date';
  startDateInput.id = 'canadalife-tx-start-date-selector';
  startDateInput.style.cssText = 'padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px;';
  startDateInput.value = formatDaysAgoLocal(365);
  const toText = document.createElement('span');
  toText.id = 'canadalife-tx-date-to-text';
  toText.textContent = 'to';
  toText.style.cssText = 'font-size: 13px; color: #666; text-align: center;';
  const endDateInput = document.createElement('input');
  endDateInput.type = 'date';
  endDateInput.id = 'canadalife-tx-end-date-selector';
  endDateInput.style.cssText = 'padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px;';
  endDateInput.value = getTodayLocal();
  dateContainer.appendChild(startDateInput);
  dateContainer.appendChild(toText);
  dateContainer.appendChild(endDateInput);
  container.appendChild(label);
  container.appendChild(dateContainer);
  txStartDateSelectorElement = startDateInput;
  txEndDateSelectorElement = endDateInput;
  return container;
}

function createTransactionResultDisplay(): HTMLDivElement {
  const container = document.createElement('div');
  container.id = 'canadalife-transaction-result';
  container.style.cssText = 'margin: 8px 0; padding: 12px; background-color: #f8f9fa; border: 1px solid #e9ecef; border-radius: 4px; display: none;';
  transactionResultElement = container;
  return container;
}

function getTransactionDateRange(): { startDate: string; endDate: string } | null {
  if (!txStartDateSelectorElement || !txEndDateSelectorElement) return null;
  const startDate = txStartDateSelectorElement.value;
  const endDate = txEndDateSelectorElement.value;
  if (!startDate || !endDate) return null;
  return { startDate, endDate };
}

function updateTransactionStartDateFromAccount(account: CanadaLifeSourceAccount): void {
  if (!txStartDateSelectorElement || !account) return;
  if (account.EnrollmentDate) {
    const enrollmentDate = new Date(account.EnrollmentDate);
    if (!Number.isNaN(enrollmentDate.getTime())) {
      const year = enrollmentDate.getFullYear();
      const month = String(enrollmentDate.getMonth() + 1).padStart(2, '0');
      const day = String(enrollmentDate.getDate()).padStart(2, '0');
      txStartDateSelectorElement.value = `${year}-${month}-${day}`;
      debugLog(`Set transaction start date to enrollment date: ${txStartDateSelectorElement.value}`);
    }
  }
}

function displayTransactionResult(result: TransactionResultDisplay): void {
  if (!transactionResultElement) return;
  const { transactionCount, accountName, dateRange } = result;
  transactionResultElement.innerHTML = `
    <h4 style="margin: 0 0 8px 0; color: #333;">Transaction Upload Result</h4>
    <div style="margin-bottom: 8px;"><strong>Account:</strong> ${accountName}</div>
    <div style="margin-bottom: 8px;"><strong>Date Range:</strong> ${dateRange.startDate} to ${dateRange.endDate}</div>
    <div style="padding: 8px; background-color: #d4edda; border-radius: 4px;">
      <div style="font-size: 13px; color: #666;">Transactions Uploaded</div>
      <div style="font-size: 18px; font-weight: 600; color: #28a745;">${transactionCount}</div>
    </div>
  `;
  transactionResultElement.style.display = 'block';
}

function createHistoricalBalanceResultDisplay(): HTMLDivElement {
  const container = document.createElement('div');
  container.id = 'canadalife-historical-balance-result';
  container.style.cssText = 'margin: 8px 0; padding: 12px; background-color: #f8f9fa; border: 1px solid #e9ecef; border-radius: 4px; display: none; max-height: 400px; overflow-y: auto;';
  historicalBalanceResultElement = container;
  return container;
}

function createBalanceResultDisplay(): HTMLDivElement {
  const container = document.createElement('div');
  container.id = 'canadalife-balance-result';
  container.style.cssText = 'margin: 8px 0; padding: 12px; background-color: #f8f9fa; border: 1px solid #e9ecef; border-radius: 4px; display: none;';
  balanceResultElement = container;
  return container;
}

function extractSourceAccount(account: ConsolidatedCanadaLifeAccount): CanadaLifeSourceAccount {
  if (account.canadalifeAccount) {
    return account.canadalifeAccount;
  }
  return account as unknown as CanadaLifeSourceAccount;
}

function updateAccountSelector(accounts: ConsolidatedCanadaLifeAccount[]): void {
  if (!accountSelectorElement) return;
  cachedAccounts = accounts;
  accountSelectorElement.innerHTML = '';
  const defaultOption = document.createElement('option');
  defaultOption.value = '';
  defaultOption.textContent = 'Select an account...';
  defaultOption.selected = true;
  accountSelectorElement.appendChild(defaultOption);
  accounts.forEach((account, index) => {
    const sourceAccount = extractSourceAccount(account);
    const option = document.createElement('option');
    option.value = index.toString();
    option.textContent = `${sourceAccount.EnglishShortName} - ${sourceAccount.LongNameEnglish}`;
    accountSelectorElement!.appendChild(option);
  });
  accountsLoadingState = 'loaded';
  toast.show(`Loaded ${accounts.length} Canada Life accounts`, 'debug');
}

function updateAccountSelectorLoadingState(state: 'loading' | 'error', message = ''): void {
  if (!accountSelectorElement) return;
  accountsLoadingState = state;
  accountSelectorElement.innerHTML = '';
  const option = document.createElement('option');
  option.value = '';
  option.disabled = true;
  option.selected = true;
  if (state === 'loading') {
    option.textContent = message || 'Loading accounts...';
  } else if (state === 'error') {
    option.textContent = message || 'Failed to load accounts';
  }
  accountSelectorElement.appendChild(option);
}

async function autoLoadAccounts(): Promise<ConsolidatedCanadaLifeAccount[] | null> {
  if (accountsLoadingState === 'loaded') {
    return cachedAccounts;
  }
  try {
    updateAccountSelectorLoadingState('loading');
    debugLog('Auto-loading Canada Life accounts...');
    const accounts = await canadalife.loadCanadaLifeAccounts() as unknown as ConsolidatedCanadaLifeAccount[];
    updateAccountSelector(accounts);
    loadAccountsRetryCount = 0;
    return accounts;
  } catch (error) {
    debugLog('Error auto-loading Canada Life accounts:', error);
    loadAccountsRetryCount += 1;
    if (loadAccountsRetryCount < MAX_RETRY_COUNT) {
      updateAccountSelectorLoadingState('loading', `Retrying... (${loadAccountsRetryCount}/${MAX_RETRY_COUNT})`);
      const delay = 2 ** loadAccountsRetryCount * 1000;
      setTimeout(() => autoLoadAccounts(), delay);
    } else {
      updateAccountSelectorLoadingState('error', 'Failed to load accounts. Please refresh page.');
      toast.show(`Failed to load accounts after ${MAX_RETRY_COUNT} attempts: ${(error as Error).message}`, 'error');
    }
    return null;
  }
}

function getSelectedAccount(): CanadaLifeSourceAccount | null {
  if (!accountSelectorElement || !cachedAccounts.length) return null;
  const selectedIndex = accountSelectorElement.value;
  if (!selectedIndex || selectedIndex === '') return null;
  const consolidated = cachedAccounts[parseInt(selectedIndex, 10)];
  return extractSourceAccount(consolidated);
}

function getSelectedDate(): string | null {
  if (!dateSelectorElement) return null;
  const date = dateSelectorElement.value;
  return date || null;
}

function getSelectedDateRange(): { startDate: string; endDate: string } | null {
  if (!startDateSelectorElement || !endDateSelectorElement) return null;
  const startDate = startDateSelectorElement.value;
  const endDate = endDateSelectorElement.value;
  if (!startDate || !endDate) return null;
  return { startDate, endDate };
}

function displayHistoricalBalanceResult(historicalData: HistoricalBalanceData): void {
  if (!historicalBalanceResultElement) return;
  const { data, account, dateRange, totalDays, apiCallsMade } = historicalData;
  const optimizationRatio = Math.round((1 - apiCallsMade / totalDays) * 100);
  let tableHTML = `
    <div style="margin-bottom: 12px;">
      <h4 style="margin: 0 0 8px 0; color: #333;">${account.name} - Historical Balance</h4>
      <div style="font-size: 13px; color: #666; margin-bottom: 8px;">
        <strong>Date Range:</strong> ${dateRange.startDate} to ${dateRange.endDate}<br>
        <strong>Business Days:</strong> ${totalDays} | <strong>API Calls:</strong> ${apiCallsMade} | <strong>Optimization:</strong> ${optimizationRatio}% fewer calls
      </div>
    </div>
    <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
  `;
  data.forEach((row, index) => {
    const isHeader = index === 0;
    let rowStyle: string;
    if (isHeader) {
      rowStyle = 'background-color: #e9ecef; font-weight: 600;';
    } else if (index % 2 === 1) {
      rowStyle = 'background-color: #f8f9fa;';
    } else {
      rowStyle = '';
    }
    tableHTML += `<tr style="${rowStyle}">`;
    row.forEach((cell, cellIndex) => {
      const cellTag = isHeader ? 'th' : 'td';
      const cellStyle = 'padding: 8px; border: 1px solid #dee2e6; text-align: left;';
      let cellContent: string | number = cell;
      if (!isHeader && cellIndex === 1 && typeof cell === 'number') {
        cellContent = new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(cell);
      }
      tableHTML += `<${cellTag} style="${cellStyle}">${cellContent}</${cellTag}>`;
    });
    tableHTML += '</tr>';
  });
  tableHTML += `
    </table>
    <div style="margin-top: 8px; font-size: 12px; color: #666;">
      <em>Historical balance data loaded successfully. Business days only (weekends skipped).</em>
    </div>
  `;
  historicalBalanceResultElement.innerHTML = tableHTML;
  historicalBalanceResultElement.style.display = 'block';
  toast.show(`Historical balance loaded for ${account.shortName}: ${totalDays} days, ${apiCallsMade} API calls`, 'debug');
}

function displayBalanceResult(balanceData: BalanceData): void {
  if (!balanceResultElement) return;
  const formattedOpeningBalance = new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(balanceData.openingBalance);
  const formattedClosingBalance = new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(balanceData.closingBalance);
  const formattedChange = new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', signDisplay: 'always' }).format(balanceData.change);
  const changeColor = balanceData.change >= 0 ? '#28a745' : '#dc3545';
  balanceResultElement.innerHTML = `
    <h4 style="margin: 0 0 8px 0; color: #333;">${balanceData.account.name}</h4>
    <div style="margin-bottom: 8px;"><strong>Date:</strong> ${balanceData.date}</div>
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 8px;">
      <div>
        <div style="font-size: 13px; color: #666;">Opening Balance</div>
        <div style="font-size: 16px; font-weight: 500;">${formattedOpeningBalance}</div>
      </div>
      <div>
        <div style="font-size: 13px; color: #666;">Closing Balance</div>
        <div style="font-size: 16px; font-weight: 500;">${formattedClosingBalance}</div>
      </div>
    </div>
    <div style="padding: 8px; background-color: ${balanceData.change >= 0 ? '#d4edda' : '#f8d7da'}; border-radius: 4px;">
      <div style="font-size: 13px; color: #666;">Daily Change</div>
      <div style="font-size: 16px; font-weight: 600; color: ${changeColor};">${formattedChange}</div>
    </div>
  `;
  balanceResultElement.style.display = 'block';
  toast.show(`Balance loaded for ${balanceData.account.shortName}: ${formattedClosingBalance}`, 'debug');
}

export function createCanadaLifeUploadButton(): HTMLDivElement {
  const container = document.createElement('div');
  container.className = 'canadalife-upload-button-container';
  container.style.cssText = 'margin: 8px 0;';
  const authStatus = canadalife.checkAuth() as { authenticated: boolean };
  if (!authStatus.authenticated) {
    const message = document.createElement('div');
    message.textContent = 'Please log in to CanadaLife to enable upload functionality';
    message.style.cssText = 'padding: 8px 12px; background-color: #fff3cd; color: #856404; border: 1px solid #ffeaa7; border-radius: 4px; font-size: 13px; margin: 5px 0;';
    container.appendChild(message);
    return container;
  }

  const uploadAllButton = createCanadaLifeButton('Upload All to Monarch', async () => {
    const authenticated = await ensureMonarchAuthentication(null, 'upload Canada Life accounts');
    if (!authenticated) return;
    try {
      uploadAllButton.disabled = true;
      uploadAllButton.textContent = 'Uploading...';
      debugLog('Starting upload all Canada Life accounts to Monarch...');
      await uploadAllCanadaLifeAccountsToMonarch();
    } catch (error) {
      debugLog('Error in upload all Canada Life accounts:', error);
      toast.show(`Upload failed: ${(error as Error).message}`, 'error');
    } finally {
      uploadAllButton.disabled = false;
      uploadAllButton.textContent = 'Upload All to Monarch';
    }
  }, { color: '#28a745' });

  const uploadCustomRangeButton = createCanadaLifeButton('Upload Custom Range', async () => {
    const authenticated = await ensureMonarchAuthentication(null, 'upload Canada Life account with custom range');
    if (!authenticated) return;
    try {
      uploadCustomRangeButton.disabled = true;
      uploadCustomRangeButton.textContent = 'Uploading...';
      debugLog('Starting custom range upload for Canada Life account...');
      await uploadCanadaLifeAccountWithDateRange();
    } catch (error) {
      debugLog('Error in custom range upload:', error);
      toast.show(`Upload failed: ${(error as Error).message}`, 'error');
    } finally {
      uploadCustomRangeButton.disabled = false;
      uploadCustomRangeButton.textContent = 'Upload Custom Range';
    }
  }, { color: '#17a2b8' });

  const mainUploadContainer = document.createElement('div');
  mainUploadContainer.style.cssText = 'display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 12px;';
  mainUploadContainer.appendChild(uploadAllButton);
  mainUploadContainer.appendChild(uploadCustomRangeButton);
  container.appendChild(mainUploadContainer);

  const isDevelopmentMode = GM_getValue(STORAGE.DEVELOPMENT_MODE, false);
  if (!isDevelopmentMode) {
    return container;
  }

  // Create collapsible testing section (only visible in Development Mode)
  const testingSection = document.createElement('div');
  testingSection.style.cssText = 'border: 1px solid var(--mu-border, #ddd); border-radius: 4px; margin: 8px 0; background-color: var(--mu-bg-secondary, #fafafa);';

  const testingHeader = document.createElement('div');
  testingHeader.style.cssText = 'padding: 8px 12px; background-color: var(--mu-bg-tertiary, #f0f0f0); border-bottom: 1px solid var(--mu-border, #ddd); cursor: pointer; user-select: none; display: flex; justify-content: space-between; align-items: center; font-size: 13px; font-weight: 500; color: var(--mu-text-secondary, #666);';

  const testingTitle = document.createElement('span');
  testingTitle.textContent = '🧪 Testing (for development only)';
  const testingToggle = document.createElement('span');
  testingToggle.textContent = '▼';
  testingToggle.style.cssText = 'transition: transform 0.2s ease; font-size: 12px; transform: rotate(-90deg);';
  testingHeader.appendChild(testingTitle);
  testingHeader.appendChild(testingToggle);

  const testingContent = document.createElement('div');
  testingContent.style.cssText = 'padding: 12px; display: none;';

  // Load balance button
  const loadBalanceButton = createCanadaLifeButton('Load Balance', async () => {
    try {
      if (!validateSelection(accountSelectorElement as HTMLSelectElement, 'Please select an account')) return;
      if (!validateDateFormat(dateSelectorElement as HTMLInputElement, 'Please select a date')) return;
      const selectedAccount = getSelectedAccount();
      const selectedDate = getSelectedDate();
      loadBalanceButton.disabled = true;
      loadBalanceButton.textContent = 'Loading...';
      debugLog('Loading account balance...', { account: selectedAccount!.EnglishShortName, date: selectedDate });
      const balanceData = await canadalife.loadAccountActivityReport(selectedAccount as Parameters<typeof canadalife.loadAccountActivityReport>[0], selectedDate, selectedDate) as unknown as BalanceData;
      displayBalanceResult(balanceData);
    } catch (error) {
      debugLog('Error loading account balance:', error);
      toast.show(`Failed to load balance: ${(error as Error).message}`, 'error');
    } finally {
      loadBalanceButton.disabled = false;
      loadBalanceButton.textContent = 'Load Balance';
    }
  });

  // Upload transaction history button
  const uploadTransactionHistoryButton = createCanadaLifeButton('Upload Transaction History', async () => {
    try {
      if (!validateSelection(accountSelectorElement as HTMLSelectElement, 'Please select an account')) return;
      if (!validateDateFormat(txStartDateSelectorElement as HTMLInputElement, 'Please select a start date')) return;
      if (!validateDateFormat(txEndDateSelectorElement as HTMLInputElement, 'Please select an end date')) return;
      if (!validateDateRange(txStartDateSelectorElement as HTMLInputElement, txEndDateSelectorElement as HTMLInputElement, 'Start date must be before end date')) return;
      const authenticated = await ensureMonarchAuthentication(null, 'upload Canada Life transactions');
      if (!authenticated) return;
      const selectedAccount = getSelectedAccount();
      const txDateRange = getTransactionDateRange();
      uploadTransactionHistoryButton.disabled = true;
      uploadTransactionHistoryButton.textContent = 'Uploading...';
      debugLog('Uploading transaction history...', { account: selectedAccount!.EnglishShortName, startDate: txDateRange!.startDate, endDate: txDateRange!.endDate });
      const progressCallback = (message: string) => { uploadTransactionHistoryButton.textContent = message; };
      const result = await uploadTransactionHistory(selectedAccount, txDateRange!.startDate, txDateRange!.endDate,
        { onProgress: progressCallback },
      ) as unknown as TransactionResultDisplay;
      displayTransactionResult({
        ...result,
        accountName: selectedAccount!.LongNameEnglish || selectedAccount!.EnglishShortName,
        dateRange: txDateRange!,
      });
    } catch (error) {
      debugLog('Error uploading transaction history:', error);
      toast.show(`Failed to upload transactions: ${(error as Error).message}`, 'error');
    } finally {
      uploadTransactionHistoryButton.disabled = false;
      uploadTransactionHistoryButton.textContent = 'Upload Transaction History';
    }
  }, { color: '#6c757d' });

  // Load historical balance button
  const loadHistoricalBalanceButton = createCanadaLifeButton('Load Historical Balance', async () => {
    try {
      if (!validateSelection(accountSelectorElement as HTMLSelectElement, 'Please select an account')) return;
      if (!validateDateFormat(startDateSelectorElement as HTMLInputElement, 'Please select a start date')) return;
      if (!validateDateFormat(endDateSelectorElement as HTMLInputElement, 'Please select an end date')) return;
      if (!validateDateRange(startDateSelectorElement as HTMLInputElement, endDateSelectorElement as HTMLInputElement, 'Start date must be before end date')) return;
      const selectedAccount = getSelectedAccount();
      const selectedDateRange = getSelectedDateRange();
      loadHistoricalBalanceButton.disabled = true;
      loadHistoricalBalanceButton.textContent = 'Loading...';
      debugLog('Loading historical account balance...', { account: selectedAccount!.EnglishShortName, startDate: selectedDateRange!.startDate, endDate: selectedDateRange!.endDate });
      const progressCallback = (current: number, total: number, percentage: number) => {
        loadHistoricalBalanceButton.textContent = `Loaded ${current}/${total} (${percentage}%)`;
      };
      const historicalData = await canadalife.loadAccountBalanceHistory(selectedAccount as Parameters<typeof canadalife.loadAccountBalanceHistory>[0], selectedDateRange!.startDate, selectedDateRange!.endDate, progressCallback) as unknown as HistoricalBalanceData;
      displayHistoricalBalanceResult(historicalData);
    } catch (error) {
      debugLog('Error loading historical account balance:', error);
      toast.show(`Failed to load historical balance: ${(error as Error).message}`, 'error');
    } finally {
      loadHistoricalBalanceButton.disabled = false;
      loadHistoricalBalanceButton.textContent = 'Load Historical Balance';
    }
  });

  // Create account selector for testing
  const accountSelector = createAccountSelector();

  // Add change listener to update transaction start date when account is selected
  if (accountSelectorElement) {
    accountSelectorElement.addEventListener('change', () => {
      const selectedAccount = getSelectedAccount();
      if (selectedAccount) {
        updateTransactionStartDateFromAccount(selectedAccount);
      }
    });
  }

  testingContent.appendChild(accountSelector);

  // Create date selector with load balance button for testing
  const dateSelector = createDateSelector();
  dateSelector.appendChild(loadBalanceButton);
  testingContent.appendChild(dateSelector);

  // Create date range selector with load historical balance button for testing
  const dateRangeSelector = createDateRangeSelector();
  dateRangeSelector.appendChild(loadHistoricalBalanceButton);
  testingContent.appendChild(dateRangeSelector);

  // Create balance result display area inside testing section
  const balanceResult = createBalanceResultDisplay();
  testingContent.appendChild(balanceResult);

  // Create historical balance result display area inside testing section
  const historicalBalanceResult = createHistoricalBalanceResultDisplay();
  testingContent.appendChild(historicalBalanceResult);

  // Create transaction date range selector with upload button for testing
  const txDateRangeSelector = createTransactionDateRangeSelector();
  txDateRangeSelector.appendChild(uploadTransactionHistoryButton);
  testingContent.appendChild(txDateRangeSelector);

  // Create transaction result display area inside testing section
  const transactionResult = createTransactionResultDisplay();
  testingContent.appendChild(transactionResult);

  // Add toggle functionality
  testingHeader.addEventListener('click', () => {
    const isCollapsed = testingContent.style.display === 'none';
    testingContent.style.display = isCollapsed ? 'block' : 'none';
    testingToggle.style.transform = isCollapsed ? 'rotate(0deg)' : 'rotate(-90deg)';
  });

  // Assemble testing section
  testingSection.appendChild(testingHeader);
  testingSection.appendChild(testingContent);
  container.appendChild(testingSection);

  return container;
}

export default {
  createCanadaLifeButton,
  createCanadaLifeUploadButton,
};
