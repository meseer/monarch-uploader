/**
 * MBNA Balance Reconstruction
 *
 * Handles balance reconstruction from MBNA statement data.
 * Uses statement closing balances as checkpoints and walks through
 * transactions day by day to build a balance history.
 *
 * This is institution-specific, sink-agnostic logic.
 * For Monarch-specific formatting, see sinks/monarch/balanceFormatter.js
 *
 * @module integrations/mbna/source/balanceReconstruction
 */

import { debugLog } from '../../../core/utils';

/**
 * Build balance history from statement data and current balance.
 *
 * Strategy:
 * 1. Use each statement's closing balance as a checkpoint
 * 2. For the current cycle (between last statement and today), use the live balance
 * 3. Walk backwards through statement balances to create daily entries
 *
 * MBNA balance convention:
 * - Positive balance = money owed (charges)
 * - Negative balance = credit (overpayment)
 *
 * @param {Object} params - Balance reconstruction parameters
 * @param {number} params.currentBalance - Current live balance from snapshot
 * @param {Array} params.statements - Statement data from getTransactions
 *   Each: { closingDate, statementBalance, transactions }
 * @param {Array} params.currentCycleSettled - Settled transactions in current billing cycle
 * @param {string} params.startDate - Earliest date to include (YYYY-MM-DD)
 * @returns {Array<{date: string, balance: number}>} Daily balance entries, oldest first
 */
export function buildBalanceHistory({ currentBalance, statements, currentCycleSettled, startDate }) {
  const balanceEntries = new Map(); // date → balance

  // Sort statements oldest first for chronological processing
  const sortedStatements = [...statements].sort((a, b) => a.closingDate.localeCompare(b.closingDate));

  // Step 1: Add statement closing date checkpoints
  for (const statement of sortedStatements) {
    if (statement.closingDate && statement.statementBalance !== null && statement.statementBalance !== undefined) {
      if (!startDate || statement.closingDate >= startDate) {
        balanceEntries.set(statement.closingDate, statement.statementBalance);
      }
    }
  }

  // Step 2: Reconstruct balances between statement dates using transactions
  // For each pair of consecutive statements, walk through transactions
  for (let i = 0; i < sortedStatements.length; i += 1) {
    const statement = sortedStatements[i];
    const transactions = statement.transactions || [];

    if (transactions.length === 0 || statement.statementBalance === null || statement.statementBalance === undefined) {
      continue;
    }

    // Get the previous statement's closing date (or startDate as boundary)
    const prevClosingDate = i > 0 ? sortedStatements[i - 1].closingDate : null;

    // Reconstruct daily balances within this statement period
    reconstructPeriodBalances(
      balanceEntries,
      transactions,
      statement.statementBalance,
      statement.closingDate,
      prevClosingDate,
      startDate,
    );
  }

  // Step 3: Reconstruct current cycle balances (from last statement to today)
  if (currentBalance !== null && currentBalance !== undefined && currentCycleSettled) {
    const today = new Date().toISOString().split('T')[0];
    balanceEntries.set(today, currentBalance);

    const lastStatementDate = sortedStatements.length > 0
      ? sortedStatements[sortedStatements.length - 1].closingDate
      : null;

    reconstructPeriodBalances(
      balanceEntries,
      currentCycleSettled,
      currentBalance,
      today,
      lastStatementDate,
      startDate,
    );
  }

  // Convert to sorted array (oldest first)
  const result = Array.from(balanceEntries.entries())
    .map(([date, balance]) => ({ date, balance }))
    .filter((entry) => !startDate || entry.date >= startDate)
    .sort((a, b) => a.date.localeCompare(b.date));

  debugLog('Balance history reconstruction:', {
    entries: result.length,
    statements: sortedStatements.length,
    startDate,
    firstEntry: result[0],
    lastEntry: result[result.length - 1],
  });

  return result;
}

/**
 * Reconstruct daily balances within a billing period by walking backwards
 * from the closing balance through transactions.
 *
 * @param {Map} balanceEntries - Map to add entries to (date → balance)
 * @param {Array} transactions - Transactions in this period
 * @param {number} endBalance - Balance at the end of the period (closing balance)
 * @param {string} endDate - End date of the period (closing date)
 * @param {string|null} startBoundary - Start boundary (previous closing date, exclusive)
 * @param {string|null} filterStartDate - Overall filter start date
 */
function reconstructPeriodBalances(balanceEntries, transactions, endBalance, endDate, startBoundary, filterStartDate) {
  // Sort transactions by date descending (newest first) for backward walking
  const sorted = [...transactions]
    .filter((tx) => tx.transactionDate || tx.postingDate)
    .sort((a, b) => {
      const dateA = a.transactionDate || a.postingDate;
      const dateB = b.transactionDate || b.postingDate;
      return dateB.localeCompare(dateA);
    });

  if (sorted.length === 0) return;

  // Walk backwards from endBalance, subtracting each transaction's amount
  let runningBalance = endBalance;

  // Group transactions by date
  const txByDate = new Map();
  for (const tx of sorted) {
    const txDate = tx.transactionDate || tx.postingDate;
    if (!txByDate.has(txDate)) {
      txByDate.set(txDate, []);
    }
    txByDate.get(txDate).push(tx);
  }

  // Get unique dates sorted descending
  const dates = Array.from(txByDate.keys()).sort((a, b) => b.localeCompare(a));

  for (const date of dates) {
    // Skip if outside boundaries
    if (startBoundary && date <= startBoundary) continue;
    if (filterStartDate && date < filterStartDate) continue;

    // Set balance at this date (after all transactions on this date)
    if (!balanceEntries.has(date)) {
      balanceEntries.set(date, roundBalance(runningBalance));
    }

    // Subtract this date's transactions to get balance before them
    const dayTransactions = txByDate.get(date);
    for (const tx of dayTransactions) {
      const amount = tx.amount ?? 0;
      runningBalance -= amount;
    }
  }

  // Set the balance at the day before the earliest transaction (the "opening" balance)
  if (dates.length > 0) {
    const earliestDate = dates[dates.length - 1];
    const dayBefore = getPreviousDate(earliestDate);
    if (dayBefore && (!startBoundary || dayBefore > startBoundary) && (!filterStartDate || dayBefore >= filterStartDate)) {
      if (!balanceEntries.has(dayBefore)) {
        balanceEntries.set(dayBefore, roundBalance(runningBalance));
      }
    }
  }
}

/**
 * Get the previous calendar date
 * @param {string} dateStr - Date in YYYY-MM-DD format
 * @returns {string} Previous date in YYYY-MM-DD format
 */
function getPreviousDate(dateStr) {
  const date = new Date(`${dateStr}T12:00:00`);
  date.setDate(date.getDate() - 1);
  return date.toISOString().split('T')[0];
}

/**
 * Round a balance to 2 decimal places to avoid floating point issues
 * @param {number} balance - Balance value
 * @returns {number} Rounded balance
 */
function roundBalance(balance) {
  return Math.round(balance * 100) / 100;
}

export default {
  buildBalanceHistory,
};