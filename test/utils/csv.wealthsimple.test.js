/**
 * Tests for CSV Conversion Utilities - Wealthsimple
 *
 * Covers: convertWealthsimpleTransactionsToMonarchCSV
 * (split out of csv.test.js to stay within the project file-size limit)
 *
 * Note on scope: assertions that an id is absent target the **Notes** column,
 * not the whole CSV string. The `Id` column carries `ws-tx:{id}` on every row by
 * design (Monarch's importer can match on it — see
 * docs/design/monarch-native-transaction-ids.md), so a whole-CSV substring check
 * would conflate the two mechanisms. What these tests are about is what the user
 * sees in Notes.
 */

import { convertWealthsimpleTransactionsToMonarchCSV } from '../../src/utils/csv';

// Mock dependencies
jest.mock('../../src/core/utils', () => ({
  debugLog: jest.fn(),
}));

jest.mock('../../src/mappers/merchant', () => ({
  applyMerchantMapping: jest.fn((merchant) => merchant || 'Unknown Merchant'),
}));

jest.mock('../../src/mappers/category', () => ({
  applyCategoryMapping: jest.fn((category) => category || 'Uncategorized'),
}));

/**
 * Read one named column out of a data row.
 *
 * Named rather than positional: the Monarch column list grows over time (`Owner`,
 * then `Id`), so assertions like `endsWith(',EUR,')` quietly stop describing the
 * Tags column the moment anything is appended. Quote-aware for commas, since
 * Tags legitimately holds `"Pending,EUR"`.
 */
const field = (csv, rowIndex, columnName) => {
  const splitRow = (row) => {
    const values = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < row.length; i += 1) {
      const ch = row[i];
      if (ch === '"') {
        if (inQuotes && row[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === ',' && !inQuotes) {
        values.push(current);
        current = '';
      } else {
        current += ch;
      }
    }

    values.push(current);
    return values;
  };

  const lines = csv.split('\n');
  const header = splitRow(lines[0]);
  return splitRow(lines[rowIndex + 1])[header.indexOf(columnName)];
};

describe('CSV Conversion Utilities - Wealthsimple', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('convertWealthsimpleTransactionsToMonarchCSV', () => {
    test('should convert Wealthsimple transactions to Monarch CSV format', () => {
      const transactions = [
        {
          id: 'tx123',
          date: '2024-01-15',
          merchant: 'STARBUCKS',
          originalMerchant: 'STARBUCKS #1234',
          amount: -5.50,
          subType: 'PURCHASE',
          resolvedMonarchCategory: 'Dining & Drinks',
        },
        {
          id: 'tx124',
          date: '2024-01-14',
          merchant: 'GROCERY STORE',
          originalMerchant: 'GROCERY STORE LTD',
          amount: -75.25,
          subType: 'PURCHASE',
          resolvedMonarchCategory: 'Groceries',
        },
      ];

      const accountName = 'Wealthsimple Cash Card';
      const result = convertWealthsimpleTransactionsToMonarchCSV(transactions, accountName);

      expect(result).toContain('Date,Merchant,Category,Account,Original Statement,Notes,Amount,Tags');
      expect(result).toContain('2024-01-15');
      expect(result).toContain('STARBUCKS');
      expect(result).toContain('Wealthsimple Cash Card');
      expect(result).toContain('-5.5');
      expect(result).toContain('-75.25');
    });

    test('should NOT include transaction details in notes for settled transactions (storeTransactionDetailsInNotes has no effect)', () => {
      const transactions = [
        {
          id: 'tx-unique-123',
          date: '2024-01-15',
          merchant: 'STARBUCKS',
          originalMerchant: 'STARBUCKS #1234',
          amount: -5.50,
          subType: 'PURCHASE',
          status: 'settled',
          resolvedMonarchCategory: 'Dining & Drinks',
        },
      ];

      // Even with storeTransactionDetailsInNotes: true, settled transactions don't include transaction ID
      const result = convertWealthsimpleTransactionsToMonarchCSV(
        transactions,
        'Test Account',
        { storeTransactionDetailsInNotes: true },
      );

      // Settled transactions should NOT have transaction ID in notes
      expect(field(result, 0, 'Notes')).toBe('');
      expect(result).not.toContain('PURCHASE');
    });

    test('should NOT include transaction details in notes for settled transactions when storeTransactionDetailsInNotes is false', () => {
      const transactions = [
        {
          id: 'tx-unique-123',
          date: '2024-01-15',
          merchant: 'STARBUCKS',
          originalMerchant: 'STARBUCKS #1234',
          amount: -5.50,
          subType: 'PURCHASE',
          resolvedMonarchCategory: 'Dining & Drinks',
        },
      ];

      const result = convertWealthsimpleTransactionsToMonarchCSV(
        transactions,
        'Test Account',
        { storeTransactionDetailsInNotes: false },
      );

      // Notes should be empty when disabled
      expect(result).not.toContain('PURCHASE');
      expect(field(result, 0, 'Notes')).toBe('');
    });

    test('should default to NOT including transaction details in notes', () => {
      const transactions = [
        {
          id: 'tx-unique-123',
          date: '2024-01-15',
          merchant: 'STARBUCKS',
          originalMerchant: 'STARBUCKS #1234',
          amount: -5.50,
          subType: 'PURCHASE',
          resolvedMonarchCategory: 'Dining & Drinks',
        },
      ];

      // No options provided (should default to false)
      const result = convertWealthsimpleTransactionsToMonarchCSV(transactions, 'Test Account');

      // Notes should be empty when disabled (default)
      expect(field(result, 0, 'Notes')).toBe('');
    });

    test('should handle empty options object', () => {
      const transactions = [
        {
          id: 'tx-unique-123',
          date: '2024-01-15',
          merchant: 'STARBUCKS',
          subType: 'PURCHASE',
          resolvedMonarchCategory: 'Dining & Drinks',
        },
      ];

      const result = convertWealthsimpleTransactionsToMonarchCSV(transactions, 'Test Account', {});

      // Notes should be empty when disabled (default)
      expect(field(result, 0, 'Notes')).toBe('');
    });

    test('should handle transactions without subType', () => {
      const transactions = [
        {
          id: 'tx123',
          date: '2024-01-15',
          merchant: 'MERCHANT',
          amount: -10.00,
          status: 'settled',
          // No subType
          resolvedMonarchCategory: 'Shopping',
        },
      ];

      // Settled transactions don't include transaction ID regardless of storeTransactionDetailsInNotes
      const resultWithDetails = convertWealthsimpleTransactionsToMonarchCSV(
        transactions,
        'Test Account',
        { storeTransactionDetailsInNotes: true },
      );
      // Settled transactions should NOT have transaction ID in notes
      expect(field(resultWithDetails, 0, 'Notes')).toBe('');

      const resultWithoutDetails = convertWealthsimpleTransactionsToMonarchCSV(
        transactions,
        'Test Account',
        { storeTransactionDetailsInNotes: false },
      );
      // Notes should be empty when disabled
      const lines = resultWithoutDetails.split('\n');
      expect(lines.length).toBe(2); // Header + data row
    });

    test('should handle empty transactions array', () => {
      const result = convertWealthsimpleTransactionsToMonarchCSV([], 'Test Account');
      expect(result).toBe('');
    });

    test('should handle null transactions', () => {
      const result = convertWealthsimpleTransactionsToMonarchCSV(null, 'Test Account');
      expect(result).toBe('');
    });

    test('should use Uncategorized for missing resolvedMonarchCategory', () => {
      const transactions = [
        {
          id: 'tx123',
          date: '2024-01-15',
          merchant: 'MERCHANT',
          amount: -10.00,
          subType: 'PURCHASE',
          // No resolvedMonarchCategory
        },
      ];

      const result = convertWealthsimpleTransactionsToMonarchCSV(transactions, 'Test Account');
      expect(result).toContain('Uncategorized');
    });

    test('should pass through empty string category when resolvedMonarchCategory is empty (skip categorization)', () => {
      const transactions = [
        {
          id: 'tx-skip',
          date: '2024-01-15',
          merchant: 'STARBUCKS',
          originalMerchant: 'STARBUCKS #1234',
          amount: -5.50,
          subType: 'PURCHASE',
          resolvedMonarchCategory: '',
        },
      ];

      const result = convertWealthsimpleTransactionsToMonarchCSV(transactions, 'Test Account');
      // Empty category should produce empty field (not 'Uncategorized')
      const lines = result.split('\n');
      const dataRow = lines[1];
      // CSV: Date,Merchant,Category,Account,...
      expect(dataRow).toContain('STARBUCKS,,Test Account');
    });

    test('should preserve original merchant in Original Statement field', () => {
      const transactions = [
        {
          id: 'tx123',
          date: '2024-01-15',
          merchant: 'Starbucks', // Cleaned up merchant name
          originalMerchant: 'STARBUCKS #1234 VANCOUVER BC', // Original from bank
          amount: -5.50,
          subType: 'PURCHASE',
          resolvedMonarchCategory: 'Dining & Drinks',
        },
      ];

      const result = convertWealthsimpleTransactionsToMonarchCSV(transactions, 'Test Account');
      expect(result).toContain('STARBUCKS #1234 VANCOUVER BC');
    });

    test('should add "Pending" tag for authorized transactions', () => {
      const transactions = [
        {
          id: 'tx-authorized',
          date: '2024-01-15',
          merchant: 'STARBUCKS',
          originalMerchant: 'STARBUCKS #1234',
          amount: -5.50,
          subType: 'PURCHASE',
          status: 'authorized',
          resolvedMonarchCategory: 'Dining & Drinks',
        },
      ];

      const result = convertWealthsimpleTransactionsToMonarchCSV(transactions, 'Test Account');
      expect(result).toContain('Pending');
    });

    test('should NOT add "Pending" tag for settled transactions', () => {
      const transactions = [
        {
          id: 'tx-settled',
          date: '2024-01-15',
          merchant: 'STARBUCKS',
          originalMerchant: 'STARBUCKS #1234',
          amount: -5.50,
          subType: 'PURCHASE',
          status: 'settled',
          resolvedMonarchCategory: 'Dining & Drinks',
        },
      ];

      const result = convertWealthsimpleTransactionsToMonarchCSV(transactions, 'Test Account');

      // Tags column should be empty for settled transactions
      expect(field(result, 0, 'Tags')).toBe('');
    });

    test('should always include transaction ID in notes for authorized transactions', () => {
      const transactions = [
        {
          id: 'tx-unique-pending-123',
          date: '2024-01-15',
          merchant: 'STARBUCKS',
          originalMerchant: 'STARBUCKS #1234',
          amount: -5.50,
          subType: 'PURCHASE',
          status: 'authorized',
          resolvedMonarchCategory: 'Dining & Drinks',
        },
      ];

      // Even with storeTransactionDetailsInNotes = false, pending transactions should have ID in notes
      const result = convertWealthsimpleTransactionsToMonarchCSV(
        transactions,
        'Test Account',
        { storeTransactionDetailsInNotes: false },
      );

      // Pending transactions include transaction ID with ws-tx: prefix (no transaction type)
      expect(result).toContain('ws-tx:tx-unique-pending-123');
      // Transaction type is NOT included in notes anymore
      expect(result).not.toContain('PURCHASE /');
    });

    test('should NOT include transaction ID in notes for settled transactions when storeTransactionDetailsInNotes is false', () => {
      const transactions = [
        {
          id: 'tx-settled-456',
          date: '2024-01-15',
          merchant: 'STARBUCKS',
          originalMerchant: 'STARBUCKS #1234',
          amount: -5.50,
          subType: 'PURCHASE',
          status: 'settled',
          resolvedMonarchCategory: 'Dining & Drinks',
        },
      ];

      const result = convertWealthsimpleTransactionsToMonarchCSV(
        transactions,
        'Test Account',
        { storeTransactionDetailsInNotes: false },
      );

      // Notes should NOT contain transaction ID for settled transactions when setting is disabled
      expect(field(result, 0, 'Notes')).toBe('');
    });

    test('should handle mixed settled and authorized transactions correctly', () => {
      const transactions = [
        {
          id: 'tx-settled',
          date: '2024-01-15',
          merchant: 'SETTLED MERCHANT',
          originalMerchant: 'SETTLED MERCHANT',
          amount: -10.00,
          subType: 'PURCHASE',
          status: 'settled',
          resolvedMonarchCategory: 'Shopping',
        },
        {
          id: 'tx-pending',
          date: '2024-01-16',
          merchant: 'PENDING MERCHANT',
          originalMerchant: 'PENDING MERCHANT',
          amount: -20.00,
          subType: 'PURCHASE',
          status: 'authorized',
          resolvedMonarchCategory: 'Shopping',
        },
      ];

      const result = convertWealthsimpleTransactionsToMonarchCSV(
        transactions,
        'Test Account',
        { storeTransactionDetailsInNotes: false },
      );

      const lines = result.split('\n');
      expect(lines).toHaveLength(3); // Header + 2 data rows

      // First transaction (settled) should NOT have Pending tag or transaction ID in notes
      expect(lines[1]).toContain('SETTLED MERCHANT');
      expect(field(result, 0, 'Notes')).toBe('');
      expect(field(result, 0, 'Tags')).toBe('');

      // Second transaction (authorized) should have Pending tag and transaction ID in notes
      expect(lines[2]).toContain('PENDING MERCHANT');
      expect(field(result, 1, 'Tags')).toBe('Pending');
      expect(field(result, 1, 'Notes')).toBe('ws-tx:tx-pending');
    });

    describe('Foreign currency tag', () => {
      /** Base settled foreign transaction shape produced by the WS transaction service */
      const buildForeignTransaction = (overrides = {}) => ({
        id: 'tx-fx',
        date: '2026-08-21',
        merchant: 'Cafe Berlin',
        originalMerchant: 'CREDIT_CARD:PURCHASE:CAFE BERLIN',
        amount: -47.16,
        subType: 'PURCHASE',
        status: 'settled',
        notes: 'Amount: 29.29 EUR (rate: 1.610106)',
        resolvedMonarchCategory: 'Dining & Drinks',
        foreignCurrency: 'EUR',
        ...overrides,
      });

      test('writes the currency code into the Tags column for a settled foreign transaction', () => {
        const result = convertWealthsimpleTransactionsToMonarchCSV(
          [buildForeignTransaction()],
          'Test Account',
        );

        expect(field(result, 0, 'Tags')).toBe('EUR');
      });

      test('includes the FX notes alongside the currency tag', () => {
        const result = convertWealthsimpleTransactionsToMonarchCSV(
          [buildForeignTransaction()],
          'Test Account',
        );

        expect(result).toContain('Amount: 29.29 EUR (rate: 1.610106)');
        expect(result).toContain('EUR');
      });

      test('leaves the Tags column empty for a settled domestic transaction', () => {
        const result = convertWealthsimpleTransactionsToMonarchCSV(
          [buildForeignTransaction({ foreignCurrency: null, notes: '' })],
          'Test Account',
        );

        expect(field(result, 0, 'Tags')).toBe('');
        // Wealthsimple has no cardholder data, so Owner is always empty
        expect(field(result, 0, 'Owner')).toBe('');
      });

      test('leaves the Tags column empty when foreignCurrency is absent entirely', () => {
        const transaction = buildForeignTransaction({ notes: '' });
        delete transaction.foreignCurrency;

        const result = convertWealthsimpleTransactionsToMonarchCSV([transaction], 'Test Account');

        expect(field(result, 0, 'Tags')).toBe('');
      });

      test('emits both the Pending and currency tags for a pending foreign transaction', () => {
        // Wealthsimple populates FX data for some authorizations before they settle,
        // so both tags apply: "Pending" for reconciliation and the currency code for
        // filtering. Monarch reads multiple tags as a comma-separated list.
        // Notes are cleared here so the row stays on a single line (pending notes
        // otherwise contain a newline before the ws-tx: ID).
        const result = convertWealthsimpleTransactionsToMonarchCSV(
          [buildForeignTransaction({ status: 'authorized', notes: '' })],
          'Test Account',
        );

        expect(field(result, 0, 'Tags')).toBe('Pending,EUR');
      });

      test('emits only the Pending tag for a pending domestic transaction', () => {
        const result = convertWealthsimpleTransactionsToMonarchCSV(
          [buildForeignTransaction({ status: 'authorized', notes: '', foreignCurrency: null })],
          'Test Account',
        );

        expect(field(result, 0, 'Tags')).toBe('Pending');
        expect(result).not.toContain('EUR');
      });

      test('includes the FX notes alongside both tags while pending', () => {
        const result = convertWealthsimpleTransactionsToMonarchCSV(
          [buildForeignTransaction({ status: 'authorized' })],
          'Test Account',
        );

        expect(result).toContain('Amount: 29.29 EUR (rate: 1.610106)');
        expect(result).toContain('ws-tx:tx-fx');
        expect(result).toContain('"Pending,EUR"');
      });

      test('tags each transaction with its own currency', () => {
        const result = convertWealthsimpleTransactionsToMonarchCSV(
          [
            buildForeignTransaction({ id: 'tx-eur', foreignCurrency: 'EUR' }),
            buildForeignTransaction({ id: 'tx-usd', foreignCurrency: 'USD', merchant: 'US Store' }),
            buildForeignTransaction({ id: 'tx-cad', foreignCurrency: null, merchant: 'CA Store', notes: '' }),
          ],
          'Test Account',
        );

        expect(field(result, 0, 'Tags')).toBe('EUR');
        expect(field(result, 1, 'Tags')).toBe('USD');
        expect(field(result, 2, 'Tags')).toBe('');
      });
    });

    describe('Id column', () => {
      // Monarch's importer can match transactions on an `id` column, so the same
      // `ws-tx:{id}` string the notes carry is also emitted as a column. See
      // docs/design/monarch-native-transaction-ids.md.
      const wsTx = (overrides = {}) => ({
        id: 'card-activity-123-VI-00-456-ABC',
        date: '2024-01-15',
        merchant: 'STARBUCKS',
        originalMerchant: 'STARBUCKS #1234',
        amount: -5.50,
        status: 'settled',
        resolvedMonarchCategory: 'Dining & Drinks',
        notes: '',
        ...overrides,
      });

      test('writes the prefixed id for a settled transaction', () => {
        // Note the asymmetry with the notes, which deliberately omit the id on
        // settled rows: the column is not user-visible, so it is unconditional.
        const result = convertWealthsimpleTransactionsToMonarchCSV([wsTx()], 'Test Account');

        expect(field(result, 0, 'Id')).toBe('ws-tx:card-activity-123-VI-00-456-ABC');
        expect(field(result, 0, 'Notes')).toBe('');
      });

      test('writes the same id a pending row puts in its notes', () => {
        const result = convertWealthsimpleTransactionsToMonarchCSV(
          [wsTx({ status: 'authorized' })],
          'Test Account',
        );

        const id = 'ws-tx:card-activity-123-VI-00-456-ABC';
        expect(field(result, 0, 'Id')).toBe(id);
        expect(field(result, 0, 'Notes')).toBe(id);
      });

      test('leaves the Id column empty when the transaction has no id', () => {
        // An empty Id must never look like a real match key
        const transaction = wsTx();
        delete transaction.id;

        const result = convertWealthsimpleTransactionsToMonarchCSV([transaction], 'Test Account');

        expect(field(result, 0, 'Id')).toBe('');
      });

      describe('resolveUploadedId — the settlement id change', () => {
        // Wealthsimple appends a segment to externalCanonicalId when card
        // activity settles:
        //   pending: card-activity-…-QIRIAS
        //   settled: card-activity-…-QIRIAS-0tk4pfcsob83
        //
        // The Monarch row was created with the PENDING id, so that is the only
        // value an `id` match can hit. resolveUploadedId supplies it.
        const PENDING_ID = 'card-activity-527000993851-VI-00-0306231535741989-QIRIAS';
        const SETTLED_ID = `${PENDING_ID}-0tk4pfcsob83`;

        test('uses the pending-era id for a settled transaction that was uploaded while pending', () => {
          const result = convertWealthsimpleTransactionsToMonarchCSV(
            [wsTx({ id: SETTLED_ID })],
            'Test Account',
            { resolveUploadedId: (id) => (id === SETTLED_ID ? PENDING_ID : null) },
          );

          expect(field(result, 0, 'Id')).toBe(`ws-tx:${PENDING_ID}`);
        });

        test('falls back to the transaction\'s own id when it was never uploaded', () => {
          // A brand-new transaction creates its own Monarch row, so its own id
          // is the correct match key.
          const result = convertWealthsimpleTransactionsToMonarchCSV(
            [wsTx({ id: SETTLED_ID })],
            'Test Account',
            { resolveUploadedId: () => null },
          );

          expect(field(result, 0, 'Id')).toBe(`ws-tx:${SETTLED_ID}`);
        });

        test('falls back to the transaction\'s own id when no resolver is supplied', () => {
          const result = convertWealthsimpleTransactionsToMonarchCSV(
            [wsTx({ id: SETTLED_ID })],
            'Test Account',
          );

          expect(field(result, 0, 'Id')).toBe(`ws-tx:${SETTLED_ID}`);
        });

        test('tolerates a resolver returning undefined', () => {
          const result = convertWealthsimpleTransactionsToMonarchCSV(
            [wsTx({ id: SETTLED_ID })],
            'Test Account',
            { resolveUploadedId: () => undefined },
          );

          expect(field(result, 0, 'Id')).toBe(`ws-tx:${SETTLED_ID}`);
        });

        test('leaves the NOTES carrying the current id, not the uploaded one', () => {
          // Pending reconciliation resolves the variant itself and reads the
          // notes; changing what the notes carry would break it. The two
          // mechanisms are deliberately independent until Phase 3.
          const result = convertWealthsimpleTransactionsToMonarchCSV(
            [wsTx({ id: SETTLED_ID, status: 'authorized' })],
            'Test Account',
            { resolveUploadedId: () => PENDING_ID },
          );

          expect(field(result, 0, 'Notes')).toBe(`ws-tx:${SETTLED_ID}`);
          expect(field(result, 0, 'Id')).toBe(`ws-tx:${PENDING_ID}`);
        });

        test('is not called for a transaction with no id', () => {
          const resolveUploadedId = jest.fn();
          const transaction = wsTx();
          delete transaction.id;

          convertWealthsimpleTransactionsToMonarchCSV([transaction], 'Test Account', { resolveUploadedId });

          expect(resolveUploadedId).not.toHaveBeenCalled();
        });

        test('resolves each row independently', () => {
          const result = convertWealthsimpleTransactionsToMonarchCSV(
            [
              wsTx({ id: SETTLED_ID }),
              wsTx({ id: 'tx-never-seen', merchant: 'OTHER' }),
            ],
            'Test Account',
            { resolveUploadedId: (id) => (id === SETTLED_ID ? PENDING_ID : null) },
          );

          expect(field(result, 0, 'Id')).toBe(`ws-tx:${PENDING_ID}`);
          expect(field(result, 1, 'Id')).toBe('ws-tx:tx-never-seen');
        });
      });
    });

    describe('Interac memo handling', () => {
      test('should include Interac memo in notes for settled transactions when storeTransactionDetailsInNotes is false', () => {
        const transactions = [
          {
            id: 'funding_intent-abc123',
            date: '2024-01-15',
            merchant: 'e-Transfer from John Doe',
            originalMerchant: 'Interac e-Transfer from John Doe (john@example.com)',
            amount: 500.00,
            subType: 'E_TRANSFER',
            status: 'settled',
            resolvedMonarchCategory: 'Transfer',
            notes: 'Rent payment for January', // Interac memo from funding intent
            technicalDetails: '', // No technical details for incoming
          },
        ];

        const result = convertWealthsimpleTransactionsToMonarchCSV(
          transactions,
          'Test Account',
          { storeTransactionDetailsInNotes: false },
        );

        // Only the Interac memo should appear in notes
        expect(field(result, 0, 'Notes')).toBe('Rent payment for January');
        expect(result).not.toContain('E_TRANSFER');
      });

      test('should include memo and technical details only for settled transactions (storeTransactionDetailsInNotes has no effect on transaction ID)', () => {
        const transactions = [
          {
            id: 'funding_intent-def456',
            date: '2024-01-15',
            merchant: 'e-Transfer to Jane Smith',
            originalMerchant: 'Interac e-Transfer to Jane Smith (jane@example.com)',
            amount: -200.00,
            subType: 'E_TRANSFER',
            status: 'settled',
            resolvedMonarchCategory: 'Transfer',
            notes: 'Payment for groceries',
            technicalDetails: 'Auto Deposit: No; Reference Number: CAkJgEwf',
          },
        ];

        const result = convertWealthsimpleTransactionsToMonarchCSV(
          transactions,
          'Test Account',
          { storeTransactionDetailsInNotes: true },
        );

        // Settled transactions: include memo and technical details, but NOT transaction ID
        expect(result).toContain('Payment for groceries');
        expect(result).toContain('Auto Deposit: No; Reference Number: CAkJgEwf');
        // Transaction ID is never stored in the NOTES for settled transactions
        expect(field(result, 0, 'Notes')).not.toContain('ws-tx:funding_intent-def456');
        expect(result).not.toContain('E_TRANSFER');
      });

      test('should include Interac memo and transaction ID in notes for pending transactions', () => {
        const transactions = [
          {
            id: 'funding_intent-pending123',
            date: '2024-01-15',
            merchant: 'e-Transfer to Someone',
            originalMerchant: 'Interac e-Transfer to Someone',
            amount: -100.00,
            subType: 'E_TRANSFER',
            isPending: true,
            resolvedMonarchCategory: 'Transfer',
            notes: 'Pending transfer memo',
            technicalDetails: 'Auto Deposit: Yes; Reference Number: XYZ123',
          },
        ];

        const result = convertWealthsimpleTransactionsToMonarchCSV(
          transactions,
          'Test Account',
          { storeTransactionDetailsInNotes: false },
        );

        // Pending transactions always include transaction ID (just ws-tx: format, no transaction type)
        expect(result).toContain('Pending transfer memo');
        expect(result).toContain('Auto Deposit: Yes; Reference Number: XYZ123');
        expect(result).toContain('ws-tx:funding_intent-pending123');
        // Transaction type is no longer included in notes
        expect(result).not.toContain('E_TRANSFER /');
        expect(result).toContain('Pending'); // Tag
      });

      test('should handle transactions with empty notes but technical details', () => {
        const transactions = [
          {
            id: 'funding_intent-techonly',
            date: '2024-01-15',
            merchant: 'e-Transfer to Unknown',
            originalMerchant: 'Interac e-Transfer to Unknown',
            amount: -50.00,
            subType: 'E_TRANSFER',
            status: 'settled',
            resolvedMonarchCategory: 'Transfer',
            notes: '', // Empty memo
            technicalDetails: 'Auto Deposit: No; Reference Number: ABC123',
          },
        ];

        const result = convertWealthsimpleTransactionsToMonarchCSV(
          transactions,
          'Test Account',
          { storeTransactionDetailsInNotes: false },
        );

        // Technical details should be present even without memo
        expect(result).toContain('Auto Deposit: No; Reference Number: ABC123');
        expect(result).not.toContain('E_TRANSFER'); // No transaction ID when storeTransactionDetailsInNotes is false
      });

      test('should handle transactions with empty notes and technicalDetails', () => {
        const transactions = [
          {
            id: 'funding_intent-nomemo',
            date: '2024-01-15',
            merchant: 'e-Transfer from Unknown',
            originalMerchant: 'Interac e-Transfer from Unknown',
            amount: 50.00,
            subType: 'E_TRANSFER',
            status: 'settled',
            resolvedMonarchCategory: 'Transfer',
            notes: '', // Empty memo
            technicalDetails: '', // Empty technical details
          },
        ];

        const result = convertWealthsimpleTransactionsToMonarchCSV(
          transactions,
          'Test Account',
          { storeTransactionDetailsInNotes: false },
        );

        // Notes should be empty when no memo, no technical details, and details are disabled
        const lines = result.split('\n');
        expect(lines).toHaveLength(2);
        // The Notes field should be empty (empty string between commas)
        expect(lines[1]).toContain(',,'); // Empty notes field
      });

      test('should handle transactions without notes or technicalDetails properties', () => {
        const transactions = [
          {
            id: 'funding_intent-nonotesprop',
            date: '2024-01-15',
            merchant: 'e-Transfer from Unknown',
            originalMerchant: 'Interac e-Transfer from Unknown',
            amount: 50.00,
            subType: 'E_TRANSFER',
            status: 'settled',
            resolvedMonarchCategory: 'Transfer',
            // No notes or technicalDetails properties at all
          },
        ];

        const result = convertWealthsimpleTransactionsToMonarchCSV(
          transactions,
          'Test Account',
          { storeTransactionDetailsInNotes: false },
        );

        // Should not crash and notes should be empty
        const lines = result.split('\n');
        expect(lines).toHaveLength(2);
      });

      test('should escape special characters in Interac memo', () => {
        const transactions = [
          {
            id: 'funding_intent-special',
            date: '2024-01-15',
            merchant: 'e-Transfer from Test',
            originalMerchant: 'Interac e-Transfer from Test',
            amount: 100.00,
            subType: 'E_TRANSFER',
            status: 'settled',
            resolvedMonarchCategory: 'Transfer',
            notes: 'Memo with "quotes" and, commas',
            technicalDetails: '',
          },
        ];

        const result = convertWealthsimpleTransactionsToMonarchCSV(
          transactions,
          'Test Account',
          { storeTransactionDetailsInNotes: false },
        );

        // CSV escaping should handle the special characters
        expect(result).toContain('"Memo with ""quotes"" and, commas"');
      });

      test('should format notes with memo and technical details for settled transactions (no transaction ID)', () => {
        const transactions = [
          {
            id: 'funding_intent-fullformat',
            date: '2024-01-15',
            merchant: 'e-Transfer to Test',
            originalMerchant: 'Interac e-Transfer to Test',
            amount: -100.00,
            subType: 'E_TRANSFER',
            status: 'settled',
            resolvedMonarchCategory: 'Transfer',
            notes: 'Testing interac notes',
            technicalDetails: 'Auto Deposit: No; Reference Number: CAkJgEwf',
          },
        ];

        const result = convertWealthsimpleTransactionsToMonarchCSV(
          transactions,
          'Test Account',
          { storeTransactionDetailsInNotes: true },
        );

        // Settled transactions include memo and technical details, but NOT transaction ID
        expect(result).toContain('Testing interac notes');
        expect(result).toContain('Auto Deposit: No; Reference Number: CAkJgEwf');
        // Transaction ID is never stored in the NOTES for settled transactions
        expect(field(result, 0, 'Notes')).not.toContain('ws-tx:funding_intent-fullformat');
        expect(result).not.toContain('E_TRANSFER /');
      });

      test('should format notes correctly when only memo exists for settled transactions', () => {
        const transactions = [
          {
            id: 'funding_intent-memoonly',
            date: '2024-01-15',
            merchant: 'e-Transfer from Test',
            originalMerchant: 'Interac e-Transfer from Test',
            amount: 100.00,
            subType: 'E_TRANSFER',
            status: 'settled',
            resolvedMonarchCategory: 'Transfer',
            notes: 'Just a memo',
            technicalDetails: '',
          },
        ];

        const result = convertWealthsimpleTransactionsToMonarchCSV(
          transactions,
          'Test Account',
          { storeTransactionDetailsInNotes: true },
        );

        // Settled transactions: only memo, no transaction ID in the notes
        expect(field(result, 0, 'Notes')).toBe('Just a memo');
        expect(result).not.toContain('E_TRANSFER /');
      });

      test('should format notes correctly when only technical details exist for settled transactions', () => {
        const transactions = [
          {
            id: 'funding_intent-techonly2',
            date: '2024-01-15',
            merchant: 'e-Transfer to Test',
            originalMerchant: 'Interac e-Transfer to Test',
            amount: -100.00,
            subType: 'E_TRANSFER',
            status: 'settled',
            resolvedMonarchCategory: 'Transfer',
            notes: '',
            technicalDetails: 'Auto Deposit: Yes; Reference Number: XYZ789',
          },
        ];

        const result = convertWealthsimpleTransactionsToMonarchCSV(
          transactions,
          'Test Account',
          { storeTransactionDetailsInNotes: true },
        );

        // Settled transactions: only technical details, no transaction ID in the notes
        expect(field(result, 0, 'Notes')).toBe('Auto Deposit: Yes; Reference Number: XYZ789');
        expect(result).not.toContain('E_TRANSFER /');
      });
    });
  });
});
