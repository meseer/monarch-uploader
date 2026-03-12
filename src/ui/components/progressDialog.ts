/**
 * Progress Dialog Component
 * Creates and manages the sophisticated progress dialog for bulk account uploads
 *
 * Features:
 * - Accordion-style expandable account rows (collapsed by default)
 * - Per-step progress tracking within each account
 * - Dynamic step initialization based on sync process scope
 * - Balance change display showing: $old (date) → $new (+$change / +%)
 */

import { debugLog } from '../../core/utils';

type StepStatus = 'pending' | 'processing' | 'success' | 'error' | 'skipped';

interface StepDefinition {
  key: string;
  name: string;
}

interface Step {
  key: string;
  name: string;
  status: StepStatus;
  message: string;
  element?: HTMLElement | null;
}

interface AccountInput {
  key?: string;
  id?: string;
  nickname?: string;
  name?: string;
  status?: string;
}

interface BalanceChangeData {
  oldBalance?: number | null;
  newBalance?: number | null;
  lastUploadDate?: string;
  changePercent?: number | null;
  daysUploaded?: number;
  accountType?: string;
  transactionCount?: number | null;
  debtAsPositive?: boolean;
}

interface AccountElement {
  container: HTMLDivElement;
  row: HTMLDivElement;
  expandIcon: HTMLSpanElement;
  icon: HTMLSpanElement;
  status: HTMLDivElement;
  stepsContainer: HTMLDivElement;
  balanceChange: HTMLDivElement;
  steps: Step[];
  balanceChangeData: BalanceChangeData | null;
  isExpanded: () => boolean;
  setExpanded: (expanded: boolean) => void;
}

interface StepSummary {
  complete: number;
  total: number;
  hasError: boolean;
  currentStep: Step | null;
  text: string;
  color: string | null;
}

interface UploadStats {
  success: number;
  failed: number;
  skipped?: number;
}

interface ProgressDialogApi {
  initSteps: (accountId: string, steps: StepDefinition[]) => void;
  updateStepStatus: (accountId: string, stepKey: string, status: StepStatus, message?: string) => void;
  updateProgress: (accountId: string, status: string, message: string) => void;
  updateBalanceChange: (accountId: string, balanceChangeData: BalanceChangeData) => void;
  showError: (accountId: string, error: Error) => Promise<void>;
  showSummary: (stats: UploadStats) => ProgressDialogApi;
  onCancel: (callback: () => void) => void;
  isCancelled: () => boolean;
  hideCancel: () => void;
  close: () => ProgressDialogApi;
}

/**
 * Format a date string (YYYY-MM-DD) as "Jan 20" style
 */
function formatShortDate(dateString: string): string {
  if (!dateString) return '';

  try {
    const [year, month, day] = dateString.split('-').map(Number);
    const date = new Date(year, month - 1, day);

    if (Number.isNaN(date.getTime())) {
      return dateString;
    }

    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${monthNames[date.getMonth()]} ${date.getDate()}`;
  } catch {
    return dateString;
  }
}

/**
 * Format a currency amount with proper formatting
 */
function formatCurrency(amount: number | undefined | null, showSign = false): string {
  if (amount === undefined || amount === null) return '';

  const absAmount = Math.abs(amount);
  const formatted = `$${absAmount.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

  if (showSign) {
    if (amount > 0) return `+${formatted}`;
    if (amount < 0) return `-${formatted}`;
  }

  return amount < 0 ? `-${formatted}` : formatted;
}

/**
 * Calculate step summary for display in collapsed account row
 */
function calculateStepSummary(steps: Step[], balanceChangeData: BalanceChangeData | null = null): StepSummary {
  if (!steps || steps.length === 0) {
    return { complete: 0, total: 0, hasError: false, currentStep: null, text: '', color: null };
  }

  let complete = 0;
  let errors = 0;
  let skipped = 0;
  let currentStep: Step | null = null;

  steps.forEach((step) => {
    if (step.status === 'success') {
      complete += 1;
    } else if (step.status === 'error') {
      errors += 1;
    } else if (step.status === 'skipped') {
      skipped += 1;
    } else if (step.status === 'processing' && !currentStep) {
      currentStep = step;
    }
  });

  const total = steps.length;
  const hasError = errors > 0;
  const allDone = complete + errors + skipped === total;

  let text: string;
  let color: string | null = null;

  if (currentStep) {
    text = currentStep.message || currentStep.name || 'Processing...';
  } else if (hasError) {
    text = `${complete}/${total} complete, ${errors} error${errors > 1 ? 's' : ''}`;
  } else if (allDone && balanceChangeData) {
    const summaryResult = formatCollapsedBalanceSummary(balanceChangeData);
    text = summaryResult.text;
    color = summaryResult.color;
  } else if (allDone) {
    text = 'Complete';
  } else {
    text = 'Pending';
  }

  return { complete, total, hasError, currentStep, text, color };
}

/**
 * Format balance change summary for collapsed row display
 */
function formatCollapsedBalanceSummary(balanceChangeData: BalanceChangeData): { text: string; color: string | null } {
  const {
    accountType, changePercent, oldBalance, newBalance,
    transactionCount, debtAsPositive,
  } = balanceChangeData;

  if (accountType === 'investment') {
    if (oldBalance !== undefined && oldBalance !== null
        && newBalance !== undefined && newBalance !== null) {
      const dollarChange = newBalance - oldBalance;
      const formattedDollarChange = formatCurrency(dollarChange, true);
      const changeSymbol = (changePercent || 0) > 0 ? '+' : '';
      const formattedPercent = `${changeSymbol}${(changePercent || 0).toFixed(2)}%`;

      let color: string;
      if ((changePercent || 0) > 0) {
        color = 'var(--mu-status-success-text, #2e7d32)';
      } else if ((changePercent || 0) < 0) {
        color = 'var(--mu-status-error-text, #c62828)';
      } else {
        color = 'var(--mu-text-muted, #666)';
      }

      const balanceText = `${formattedDollarChange} / ${formattedPercent}`;
      const txPrefix = (transactionCount !== null && transactionCount !== undefined && transactionCount > 0)
        ? `${transactionCount} new • `
        : '';
      return { text: `${txPrefix}${balanceText}`, color };
    }
    return { text: 'Complete', color: null };
  }

  const parts: string[] = [];

  if (transactionCount !== undefined && transactionCount !== null && transactionCount > 0) {
    parts.push(`${transactionCount} new`);
  }

  if (newBalance !== undefined && newBalance !== null) {
    const formattedBalance = formatCurrency(newBalance);
    parts.push(formattedBalance);
  }

  let color: string = 'var(--mu-text-muted, #666)';
  if (changePercent !== undefined && changePercent !== null) {
    if (debtAsPositive) {
      if (changePercent > 0) {
        color = 'var(--mu-status-error-text, #c62828)';
      } else if (changePercent < 0) {
        color = 'var(--mu-status-success-text, #2e7d32)';
      }
    } else {
      if (newBalance !== undefined && newBalance !== null && newBalance < 0) {
        if (changePercent > 0) {
          color = 'var(--mu-status-success-text, #2e7d32)';
        } else if (changePercent < 0) {
          color = 'var(--mu-status-error-text, #c62828)';
        }
      } else {
        if (changePercent > 0) {
          color = 'var(--mu-status-success-text, #2e7d32)';
        } else if (changePercent < 0) {
          color = 'var(--mu-status-error-text, #c62828)';
        }
      }
    }
  }

  if (parts.length === 0) {
    return { text: 'Complete', color: null };
  }

  return { text: parts.join(' • '), color };
}

/**
 * Get status icon for a step
 */
function getStepIcon(status: string): string {
  switch (status) {
  case 'processing':
    return '⟳';
  case 'success':
    return '✓';
  case 'error':
    return '✗';
  case 'skipped':
    return '○';
  case 'pending':
  default:
    return '○';
  }
}

/**
 * Get status color for a step
 */
function getStepColor(status: string): string {
  switch (status) {
  case 'processing':
    return 'var(--mu-status-processing-text, #1565c0)';
  case 'success':
    return 'var(--mu-status-success-text, #2e7d32)';
  case 'error':
    return 'var(--mu-status-error-text, #c62828)';
  case 'skipped':
    return 'var(--mu-text-muted, #888)';
  case 'pending':
  default:
    return 'var(--mu-text-muted, #888)';
  }
}

/**
 * Creates and displays a progress dialog for tracking bulk account uploads
 */
export function showProgressDialog(
  accounts: AccountInput[],
  title = 'Uploading Balance History for All Accounts',
): ProgressDialogApi {
  const timestamp = Date.now();

  const overlay = document.createElement('div');
  overlay.id = `balance-uploader-overlay-${timestamp}`;
  overlay.style.cssText = `
    position: fixed; top: 0; left: 0; width: 100%; height: 100%;
    background: var(--mu-overlay-bg, rgba(0,0,0,0.7));
    display: flex; align-items: center; justify-content: center; z-index: 10000;
  `;

  const modal = document.createElement('div');
  modal.id = `balance-uploader-modal-${timestamp}`;
  modal.style.cssText = `
    background: var(--mu-bg-primary, white); color: var(--mu-text-primary, #333);
    padding: 25px; border-radius: 8px; width: 90%; max-width: 650px;
    max-height: 80vh; overflow-y: auto; display: flex; flex-direction: column;
  `;

  const header = document.createElement('h2');
  header.id = `balance-uploader-header-${timestamp}`;
  header.style.cssText = 'margin-top: 0; margin-bottom: 15px; font-size: 1.2em;';
  header.textContent = title;
  modal.appendChild(header);

  const accountList = document.createElement('div');
  accountList.id = `balance-uploader-account-list-${timestamp}`;
  accountList.style.cssText = 'margin-bottom: 20px; max-height: 400px; overflow-y: auto; position: relative;';
  modal.appendChild(accountList);

  // Auto-scroll state
  let autoScrollEnabled = true;
  let isProgrammaticAction = false;
  let programmaticActionCount = 0;
  let isScrollMonitoringActive = false;

  function beginProgrammaticAction(durationMs: number): void {
    programmaticActionCount += 1;
    isProgrammaticAction = true;
    setTimeout(() => {
      programmaticActionCount -= 1;
      if (programmaticActionCount <= 0) {
        programmaticActionCount = 0;
        isProgrammaticAction = false;
      }
    }, durationMs);
  }

  accountList.addEventListener('scroll', () => {
    if (!isProgrammaticAction && isScrollMonitoringActive) {
      autoScrollEnabled = false;
      debugLog('Auto-scroll disabled due to user scroll interaction');
    }
  });

  // Create account rows
  const accountElements: Record<string, AccountElement> = {};
  accounts.forEach((account) => {
    if (!account) return;

    const accountKey = account.key || account.id || '';

    const accountContainer = document.createElement('div');
    accountContainer.id = `balance-uploader-account-container-${accountKey}`;
    accountContainer.style.cssText = 'border: 1px solid var(--mu-border-light, #eee); border-radius: 6px; margin-bottom: 8px; overflow: hidden;';

    const accountRow = document.createElement('div');
    accountRow.id = `balance-uploader-account-row-${accountKey}`;
    accountRow.style.cssText = 'display: flex; align-items: center; padding: 12px; cursor: pointer; transition: background-color 0.2s;';

    const expandIcon = document.createElement('span');
    expandIcon.id = `balance-uploader-expand-icon-${accountKey}`;
    expandIcon.style.cssText = 'margin-right: 8px; font-size: 0.8em; color: var(--mu-text-secondary, #666); transition: transform 0.2s; display: inline-block;';
    expandIcon.textContent = '▶';
    accountRow.appendChild(expandIcon);

    const statusIcon = document.createElement('span') as HTMLSpanElement & { dataset: DOMStringMap };
    statusIcon.id = `balance-uploader-account-icon-${accountKey}`;
    statusIcon.style.cssText = 'margin-right: 10px; font-size: 1.2em;';
    statusIcon.textContent = '○';
    statusIcon.dataset.status = 'pending';
    accountRow.appendChild(statusIcon);

    const accountNameContainer = document.createElement('div');
    accountNameContainer.id = `balance-uploader-account-info-${accountKey}`;
    accountNameContainer.style.cssText = 'flex-grow: 1; display: flex; flex-direction: column; gap: 2px;';

    const accountNameRow = document.createElement('div');
    accountNameRow.style.cssText = 'display: flex; align-items: center; gap: 8px;';

    const accountName = document.createElement('div');
    accountName.style.cssText = 'font-weight: 500;';
    accountName.textContent = account.nickname || account.name || 'Account';
    accountNameRow.appendChild(accountName);

    const isClosed = account.status === 'closed';
    if (isClosed) {
      const closedBadge = document.createElement('span');
      closedBadge.id = `balance-uploader-closed-badge-${accountKey}`;
      closedBadge.style.cssText = 'background: var(--mu-closed-badge-bg, #9e9e9e); color: white; font-size: 0.7em; padding: 2px 6px; border-radius: 10px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.5px;';
      closedBadge.textContent = 'Closed';
      accountNameRow.appendChild(closedBadge);
      accountRow.style.opacity = '0.7';
      accountRow.style.backgroundColor = 'var(--mu-bg-tertiary, #f5f5f5)';
    }

    accountNameContainer.appendChild(accountNameRow);

    const accountIdDiv = document.createElement('div');
    accountIdDiv.style.cssText = 'font-size: 0.85em; color: var(--mu-text-muted, #888); font-weight: normal;';
    accountIdDiv.textContent = accountKey;
    accountNameContainer.appendChild(accountIdDiv);

    accountRow.appendChild(accountNameContainer);

    const statusText = document.createElement('div');
    statusText.id = `balance-uploader-account-status-${accountKey}`;
    statusText.style.cssText = 'margin-left: 10px; color: var(--mu-text-muted, #888); min-width: 120px; max-width: 180px; word-wrap: break-word; text-align: right; font-size: 0.9em;';
    statusText.textContent = 'Pending';
    accountRow.appendChild(statusText);

    accountContainer.appendChild(accountRow);

    const stepsContainer = document.createElement('div');
    stepsContainer.id = `balance-uploader-steps-container-${accountKey}`;
    stepsContainer.style.cssText = 'display: none; background: var(--mu-bg-secondary, #f9f9f9); border-top: 1px solid var(--mu-border-light, #eee); padding: 0;';
    accountContainer.appendChild(stepsContainer);

    const balanceChangeDiv = document.createElement('div');
    balanceChangeDiv.id = `balance-uploader-balance-change-${accountKey}`;
    balanceChangeDiv.style.cssText = 'display: none; padding: 8px 15px; margin: 8px 12px; border-radius: 4px; font-size: 0.9em; font-weight: 500; text-align: center;';

    let isExpanded = false;

    accountRow.addEventListener('click', () => {
      if (!isProgrammaticAction) {
        autoScrollEnabled = false;
        debugLog('Auto-scroll disabled due to user click on account row');
      }
      isExpanded = !isExpanded;
      stepsContainer.style.display = isExpanded ? 'block' : 'none';
      expandIcon.style.transform = isExpanded ? 'rotate(90deg)' : 'rotate(0deg)';
    });

    accountRow.addEventListener('mouseenter', () => {
      if (accountRow.style.backgroundColor === '' || accountRow.style.backgroundColor === 'transparent') {
        accountRow.style.backgroundColor = 'var(--mu-hover-bg, #f5f5f5)';
      }
    });
    accountRow.addEventListener('mouseleave', () => {
      const currentStatus = statusIcon.dataset.status;
      if (currentStatus === 'processing') {
        accountRow.style.backgroundColor = 'var(--mu-status-processing-bg, #e3f2fd)';
      } else if (currentStatus === 'success') {
        accountRow.style.backgroundColor = 'var(--mu-status-success-bg, #e8f5e9)';
      } else if (currentStatus === 'error') {
        accountRow.style.backgroundColor = 'var(--mu-status-error-bg, #ffebee)';
      } else {
        accountRow.style.backgroundColor = 'transparent';
      }
    });

    accountList.appendChild(accountContainer);

    accountElements[accountKey] = {
      container: accountContainer,
      row: accountRow,
      expandIcon,
      icon: statusIcon,
      status: statusText,
      stepsContainer,
      balanceChange: balanceChangeDiv,
      steps: [],
      balanceChangeData: null,
      isExpanded: () => isExpanded,
      setExpanded: (expanded: boolean) => {
        isExpanded = expanded;
        stepsContainer.style.display = isExpanded ? 'block' : 'none';
        expandIcon.style.transform = isExpanded ? 'rotate(90deg)' : 'rotate(0deg)';
      },
    };
  });

  const errorContainer = document.createElement('div');
  errorContainer.id = `balance-uploader-error-container-${timestamp}`;
  errorContainer.style.cssText = 'border: 1px solid var(--mu-error-border, #f44336); border-radius: 5px; padding: 15px; margin-bottom: 20px; display: none; background: var(--mu-bg-primary, white);';
  modal.appendChild(errorContainer);

  const summary = document.createElement('div');
  summary.id = `balance-uploader-summary-${timestamp}`;
  summary.style.cssText = 'margin-bottom: 20px; font-weight: bold;';
  summary.textContent = `Total: ${accounts.length} accounts`;
  modal.appendChild(summary);

  const buttonsContainer = document.createElement('div');
  buttonsContainer.id = `balance-uploader-buttons-${timestamp}`;
  buttonsContainer.style.cssText = 'display: flex; justify-content: flex-end; gap: 10px;';
  modal.appendChild(buttonsContainer);

  const cancelButton = document.createElement('button');
  cancelButton.textContent = 'Cancel Upload';
  cancelButton.style.cssText = 'padding: 8px 16px; border: none; border-radius: 4px; background: var(--mu-danger-bg, #dc3545); color: var(--mu-danger-text, white); cursor: pointer; margin-right: 10px;';
  buttonsContainer.appendChild(cancelButton);

  const closeButton = document.createElement('button');
  closeButton.textContent = 'Close';
  closeButton.style.cssText = 'padding: 8px 16px; border: none; border-radius: 4px; background: var(--mu-close-btn-bg, #6c757d); color: white; cursor: pointer; display: none;';
  buttonsContainer.appendChild(closeButton);

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  const acknowledgmentPromise: { promise: Promise<void> | null; resolve: (() => void) | null } = {
    promise: null,
    resolve: null,
  };

  let cancelCallback: (() => void) | null = null;
  let isCancelled = false;
  let uploadState = 'pending';

  function updateStepSummaryDisplay(accountId: string): void {
    const el = accountElements[accountId];
    if (!el || !el.steps || el.steps.length === 0) return;

    const summaryData = calculateStepSummary(el.steps, el.balanceChangeData);
    if (summaryData.text) {
      el.status.textContent = summaryData.text;
      if (summaryData.color) {
        el.status.style.color = summaryData.color;
      }
    }
  }

  function createStepElement(accountId: string, step: Step): HTMLElement | null {
    const el = accountElements[accountId];
    if (!el) return null;

    const stepDiv = document.createElement('div');
    stepDiv.id = `balance-uploader-step-${accountId}-${step.key}`;
    stepDiv.style.cssText = 'display: flex; align-items: flex-start; padding: 8px 12px 8px 36px; border-bottom: 1px solid var(--mu-border-light, #eee); font-size: 0.9em;';

    const stepIconSpan = document.createElement('span');
    stepIconSpan.id = `balance-uploader-step-icon-${accountId}-${step.key}`;
    stepIconSpan.style.cssText = `margin-right: 8px; color: ${getStepColor(step.status)};`;
    stepIconSpan.textContent = getStepIcon(step.status);
    stepDiv.appendChild(stepIconSpan);

    const stepNameSpan = document.createElement('span');
    stepNameSpan.id = `balance-uploader-step-name-${accountId}-${step.key}`;
    stepNameSpan.style.cssText = 'flex-grow: 1; color: var(--mu-text-primary, #333);';
    stepNameSpan.textContent = step.name;
    stepDiv.appendChild(stepNameSpan);

    const stepMessageSpan = document.createElement('span');
    stepMessageSpan.id = `balance-uploader-step-message-${accountId}-${step.key}`;
    stepMessageSpan.style.cssText = `color: ${getStepColor(step.status)}; text-align: right; max-width: 250px; word-wrap: break-word;`;
    stepMessageSpan.textContent = step.message || '';
    stepDiv.appendChild(stepMessageSpan);

    el.stepsContainer.appendChild(stepDiv);
    return stepDiv;
  }

  function updateStepElement(accountId: string, step: Step): void {
    const iconEl = document.getElementById(`balance-uploader-step-icon-${accountId}-${step.key}`);
    const messageEl = document.getElementById(`balance-uploader-step-message-${accountId}-${step.key}`);

    if (iconEl) {
      iconEl.textContent = getStepIcon(step.status);
      iconEl.style.color = getStepColor(step.status);
    }

    if (messageEl) {
      messageEl.textContent = step.message || '';
      messageEl.style.color = getStepColor(step.status);
    }
  }

  const dialog: ProgressDialogApi = {
    initSteps: (accountId: string, steps: StepDefinition[]) => {
      const el = accountElements[accountId];
      if (!el) {
        debugLog(`Warning: Account element not found for ID: ${accountId}`);
        return;
      }

      el.stepsContainer.innerHTML = '';
      el.steps = [];

      steps.forEach((stepDef) => {
        const step: Step = {
          key: stepDef.key,
          name: stepDef.name,
          status: 'pending',
          message: '',
        };
        el.steps.push(step);
        step.element = createStepElement(accountId, step);
      });

      el.stepsContainer.appendChild(el.balanceChange);
      debugLog(`Initialized ${steps.length} steps for account ${accountId}`);
    },

    updateStepStatus: (accountId: string, stepKey: string, status: StepStatus, message = '') => {
      const el = accountElements[accountId];
      if (!el) {
        debugLog(`Warning: Account element not found for ID: ${accountId}`);
        return;
      }

      const step = el.steps.find((s) => s.key === stepKey);
      if (!step) {
        debugLog(`Warning: Step ${stepKey} not found for account ${accountId}`);
        return;
      }

      step.status = status;
      step.message = message;
      updateStepElement(accountId, step);
      updateStepSummaryDisplay(accountId);

      const allSuccess = el.steps.every((s) => s.status === 'success' || s.status === 'skipped');
      const hasError = el.steps.some((s) => s.status === 'error');
      const hasProcessing = el.steps.some((s) => s.status === 'processing');

      let accountStatus: string;
      if (hasError) {
        accountStatus = 'error';
      } else if (hasProcessing) {
        accountStatus = 'processing';
      } else if (allSuccess && el.steps.length > 0) {
        accountStatus = 'success';
      } else {
        accountStatus = 'pending';
      }

      el.icon.textContent = getStepIcon(accountStatus);
      el.icon.style.color = getStepColor(accountStatus);
      el.icon.dataset.status = accountStatus;

      if (accountStatus === 'processing') {
        el.row.style.backgroundColor = 'var(--mu-status-processing-bg, #e3f2fd)';
      } else if (accountStatus === 'success') {
        el.row.style.backgroundColor = 'var(--mu-status-success-bg, #e8f5e9)';
      } else if (accountStatus === 'error') {
        el.row.style.backgroundColor = 'var(--mu-status-error-bg, #ffebee)';
      } else {
        el.row.style.backgroundColor = 'transparent';
      }

      if (autoScrollEnabled) {
        const allDone = el.steps.every((s) =>
          s.status === 'success' || s.status === 'error' || s.status === 'skipped');

        if (accountStatus === 'processing' && status === 'processing') {
          if (!isScrollMonitoringActive) {
            isScrollMonitoringActive = true;
            debugLog('Scroll monitoring activated - first account started processing');
          }

          beginProgrammaticAction(600);
          el.setExpanded(true);

          const containerTop = el.container.offsetTop;
          const targetScrollTop = Math.max(0, containerTop - 10);
          accountList.scrollTo({ top: targetScrollTop, behavior: 'smooth' });
          debugLog(`Auto-scrolled to account ${accountId}, scrollTop: ${targetScrollTop}`);
        } else if (allDone && el.isExpanded()) {
          const allAccountsDone = Object.values(accountElements).every((acctEl) => {
            if (!acctEl.steps || acctEl.steps.length === 0) return true;
            return acctEl.steps.every((s) =>
              s.status === 'success' || s.status === 'error' || s.status === 'skipped');
          });

          if (!allAccountsDone) {
            beginProgrammaticAction(150);
            el.setExpanded(false);
            debugLog(`Auto-collapsed completed account ${accountId}`);
          } else {
            debugLog(`Kept last completed account ${accountId} expanded`);
          }
        }
      }

      debugLog(`Updated step ${stepKey} for account ${accountId}: ${status} - ${message}`);
    },

    updateProgress: (accountId: string, status: string, message: string) => {
      const el = accountElements[accountId];
      if (!el) {
        debugLog(`Warning: Account element not found for ID: ${accountId}`);
        return;
      }

      if (status === 'processing' && uploadState === 'pending') {
        uploadState = 'active';
      }

      if (el.steps && el.steps.length > 0) {
        if (status === 'success' || status === 'error') {
          el.icon.textContent = getStepIcon(status);
          el.icon.style.color = getStepColor(status);
          el.icon.dataset.status = status;
        }
      } else {
        // No steps initialized, use legacy behavior
        el.status.textContent = message || status;
        el.icon.textContent = getStepIcon(status);
        el.icon.dataset.status = status;
      }

      // Update colors
      if (status === 'processing') {
        el.row.style.backgroundColor = 'var(--mu-status-processing-bg, #e3f2fd)';
        el.status.style.color = 'var(--mu-status-processing-text, #1565c0)';
      } else if (status === 'success') {
        el.row.style.backgroundColor = 'var(--mu-status-success-bg, #e8f5e9)';
        el.status.style.color = 'var(--mu-status-success-text, #2e7d32)';
      } else if (status === 'error') {
        el.row.style.backgroundColor = 'var(--mu-status-error-bg, #ffebee)';
        el.status.style.color = 'var(--mu-status-error-text, #c62828)';
      } else if (status === 'skipped') {
        el.row.style.backgroundColor = 'var(--mu-status-skipped-bg, #f5f5f5)';
        el.status.style.color = 'var(--mu-text-muted, #888)';
      } else {
        el.row.style.backgroundColor = 'transparent';
        el.status.style.color = 'var(--mu-text-muted, #888)';
      }

      el.icon.style.color = el.status.style.color;
    },

    updateBalanceChange: (accountId: string, balanceChangeData: BalanceChangeData) => {
      const el = accountElements[accountId];
      if (!el || !el.balanceChange) {
        debugLog(`Warning: Balance change element not found for ID: ${accountId}`);
        return;
      }

      try {
        // Store balance change data for collapsed summary display
        el.balanceChangeData = balanceChangeData;

        const {
          oldBalance, newBalance, lastUploadDate, changePercent, debtAsPositive,
        } = balanceChangeData;

        let displayText = '';
        let effectiveChangePercent = changePercent;

        if (oldBalance !== undefined && oldBalance !== null
            && newBalance !== undefined && newBalance !== null
            && lastUploadDate) {
          const dollarChange = newBalance - oldBalance;

          if (effectiveChangePercent === undefined || effectiveChangePercent === null) {
            effectiveChangePercent = oldBalance !== 0
              ? ((newBalance - oldBalance) / Math.abs(oldBalance)) * 100
              : 0;
          }

          // For debtAsPositive accounts, invert the display values
          const displayDollarChange = debtAsPositive ? -dollarChange : dollarChange;
          const displayChangePercent = debtAsPositive ? -effectiveChangePercent : effectiveChangePercent;

          const formattedOldBalance = formatCurrency(oldBalance);
          const formattedDate = formatShortDate(lastUploadDate);
          const formattedNewBalance = formatCurrency(newBalance);
          const formattedDollarChange = formatCurrency(displayDollarChange, true);
          const changeSymbol = displayChangePercent > 0 ? '+' : '';
          const formattedPercent = `${changeSymbol}${displayChangePercent.toFixed(2)}%`;

          displayText = `${formattedOldBalance} (${formattedDate}) → ${formattedNewBalance} (${formattedDollarChange} / ${formattedPercent})`;
        } else if (newBalance !== undefined && newBalance !== null) {
          displayText = formatCurrency(newBalance);
        } else {
          debugLog(`No balance data available for ${accountId}`);
          return;
        }

        el.balanceChange.textContent = displayText;

        let backgroundColor: string;
        let textColor: string;
        if (effectiveChangePercent !== undefined && effectiveChangePercent !== null) {
          let isPositiveChange: boolean;
          if (debtAsPositive) {
            isPositiveChange = effectiveChangePercent < 0;
          } else {
            isPositiveChange = effectiveChangePercent > 0;
          }

          if (effectiveChangePercent === 0) {
            backgroundColor = 'var(--mu-balance-neutral-bg, #f5f5f5)';
            textColor = 'var(--mu-balance-neutral-text, #666)';
          } else if (isPositiveChange) {
            backgroundColor = 'var(--mu-status-success-bg, #e8f5e9)';
            textColor = 'var(--mu-status-success-text, #2e7d32)';
          } else {
            backgroundColor = 'var(--mu-status-error-bg, #ffebee)';
            textColor = 'var(--mu-status-error-text, #c62828)';
          }
        } else {
          backgroundColor = 'var(--mu-balance-info-bg, #e3f2fd)';
          textColor = 'var(--mu-balance-info-text, #1565c0)';
        }

        el.balanceChange.style.backgroundColor = backgroundColor;
        el.balanceChange.style.color = textColor;
        el.balanceChange.style.display = 'block';

        updateStepSummaryDisplay(accountId);

        debugLog(`Updated balance change for ${accountId}: ${displayText}`);
      } catch (error) {
        debugLog(`Error updating balance change for ${accountId}:`, error);
      }
    },

    showError: (accountId: string, error: Error) => {
      // Mark upload as completed on error
      uploadState = 'completed';
      debugLog('Upload state changed to completed due to error');

      dialog.hideCancel();

      errorContainer.style.display = 'block';
      errorContainer.innerHTML = `
        <div style="margin-bottom: 10px; font-weight: bold; color: var(--mu-error-text, #f44336);">
          Error uploading account ${accountId}:
        </div>
        <div style="margin-bottom: 15px; white-space: pre-wrap; word-wrap: break-word; color: var(--mu-text-primary, #333);">
          ${error.message || error.toString()}
        </div>
        <div style="display: flex; gap: 10px; justify-content: flex-end;">
          <button id="error-close-button" style="
            padding: 8px 16px;
            border: none;
            border-radius: 4px;
            background: var(--mu-close-btn-bg, #6c757d);
            color: white;
            cursor: pointer;
          ">Close</button>
          <button id="error-ack-button" style="
            padding: 8px 16px;
            border: none;
            border-radius: 4px;
            background: var(--mu-error-border, #f44336);
            color: white;
            cursor: pointer;
          ">Continue</button>
        </div>
      `;

      acknowledgmentPromise.promise = new Promise<void>((resolve) => {
        acknowledgmentPromise.resolve = resolve;
      });

      (document.getElementById('error-ack-button') as HTMLButtonElement).onclick = () => {
        errorContainer.style.display = 'none';
        if (acknowledgmentPromise.resolve) {
          acknowledgmentPromise.resolve();
          acknowledgmentPromise.resolve = null;
        }
      };

      (document.getElementById('error-close-button') as HTMLButtonElement).onclick = () => {
        errorContainer.style.display = 'none';
        dialog.close();
      };

      return acknowledgmentPromise.promise as Promise<void>;
    },

    showSummary: (stats: UploadStats) => {
      const skipped = stats.skipped || 0;
      let summaryText = `Summary: ${stats.success} success, ${stats.failed} failed`;
      if (skipped > 0) {
        summaryText += `, ${skipped} skipped`;
      }
      summary.textContent = summaryText;
      return dialog;
    },

    onCancel: (callback: () => void) => {
      cancelCallback = callback;
    },

    isCancelled: () => isCancelled,

    hideCancel: () => {
      cancelButton.style.display = 'none';
      closeButton.style.display = 'inline-block';
    },

    close: () => {
      overlay.remove();
      return dialog;
    },
  };

  // Set up cancel button handler
  cancelButton.onclick = () => {
    debugLog('Cancel button clicked', {
      hasCallback: Boolean(cancelCallback),
      isCancelled,
      uploadState,
    });

    if (!cancelCallback) {
      debugLog('Warning: Cancel button clicked but no callback registered');
      return;
    }

    if (isCancelled) {
      debugLog('Warning: Cancel already in progress');
      return;
    }

    debugLog('Executing cancel callback');
    isCancelled = true;
    uploadState = 'completed';
    cancelButton.textContent = 'Cancelling...';
    cancelButton.disabled = true;
    cancelButton.style.opacity = '0.6';

    try {
      cancelCallback();
      debugLog('Cancel callback executed successfully');
    } catch (error) {
      debugLog('Error executing cancel callback:', error);
    }
  };

  // Set up close button handler
  closeButton.onclick = dialog.close;

  debugLog('Progress dialog created with accounts:', accounts);
  return dialog;
}

export default {
  showProgressDialog,
};
