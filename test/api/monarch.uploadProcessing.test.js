/**
 * Monarch API - waiting for an uploaded statement to finish processing.
 *
 * Monarch imports a transactions CSV asynchronously, so uploadTransactionsToMonarch
 * polls the upload session until it completes. Giving up while Monarch is still
 * processing is what produces duplicates: the sync saves no dedup IDs, Monarch
 * finishes the import anyway, and the next sync uploads the same transactions
 * again. These tests pin the wait budget, the fail-fast terminal statuses, the
 * transient-error tolerance, and the progress reporting the UI relies on.
 */

import '../setup';
import { uploadTransactionsToMonarch } from '../../src/api/monarch';
import authService from '../../src/services/auth';

vi.mock('../../src/services/auth', () => {
  const mock = {
    checkMonarchAuth: vi.fn(),
    getMonarchCredentials: vi.fn(),
    setupMonarchTokenCapture: vi.fn(),
    clearMonarchCredentials: vi.fn(),
  };
  return { ...mock, default: mock };
});

vi.mock('../../src/core/state', () => ({
  setMonarchAuth: vi.fn(),
  getState: vi.fn(),
}));

vi.mock('../../src/core/utils', () => ({
  debugLog: vi.fn(),
}));

vi.mock('../../src/ui/components/accountSelectorWithCreate', () => ({
  showMonarchAccountSelectorWithCreate: vi.fn(),
}));

const CSV = 'Date,Merchant,Amount\n2026-10-01,Coffee,-4.50';

/** Status-check responses that are not a session object */
const NETWORK_ERROR = Symbol('network error');
const SERVER_ERROR = Symbol('HTTP 500');

describe('Monarch API - upload processing wait', () => {
  let delays;
  let statusChecks;

  /**
   * Answer the CSV upload, the parse mutation, and then each status check from
   * `statusResponses` in order (the last entry repeats once the list runs out).
   *
   * @param {Array<Object|symbol>} statusResponses - Session objects or error markers
   */
  function mockMonarch(statusResponses) {
    globalThis.GM_xmlhttpRequest = vi.fn((options) => {
      // The CSV upload sends FormData; every other call is GraphQL JSON.
      if (typeof options.data !== 'string') {
        options.onload({ status: 200, responseText: JSON.stringify({ session_key: 'session-1' }) });
        return;
      }

      const { operationName } = JSON.parse(options.data);
      if (operationName === 'Web_ParseUploadStatementSession') {
        options.onload({ status: 200, responseText: JSON.stringify({ data: {} }) });
        return;
      }

      const response = statusResponses[Math.min(statusChecks, statusResponses.length - 1)];
      statusChecks += 1;
      if (response === NETWORK_ERROR) {
        options.onerror(new Error('Network down'));
      } else if (response === SERVER_ERROR) {
        options.onload({ status: 500, responseText: 'Internal Server Error' });
      } else {
        options.onload({
          status: 200,
          responseText: JSON.stringify({ data: { uploadStatementSession: response } }),
        });
      }
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    delays = [];
    statusChecks = 0;
    globalThis.FormData = vi.fn().mockImplementation(function () {
      return { append: vi.fn() };
    });
    globalThis.Blob = vi.fn();
    authService.checkMonarchAuth.mockReturnValue({
      authenticated: true,
      credentials: { csrfToken: 'csrf-token', sessionExpiresAt: '2099-12-31T23:59:59Z' },
    });
    authService.getMonarchCredentials.mockReturnValue({ csrfToken: 'csrf-token', sessionExpiresAt: '2099-12-31T23:59:59Z' });
    // Run every wait immediately, but record how long the code asked to wait.
    vi.spyOn(global, 'setTimeout').mockImplementation((callback, ms) => {
      delays.push(ms);
      callback();
      return 1;
    });
  });

  afterEach(() => {
    global.setTimeout.mockRestore?.();
  });

  describe('progress reporting', () => {
    it('reports each still-processing check, then resolves when Monarch completes', async () => {
      mockMonarch([
        { status: 'started' },
        { status: 'pending' },
        { status: 'completed', uploadedStatement: { transactionCount: 3 } },
      ]);
      const onProcessingUpdate = vi.fn();

      await expect(uploadTransactionsToMonarch('monarch-1', CSV, { onProcessingUpdate })).resolves.toBe(true);

      expect(onProcessingUpdate.mock.calls.map(([update]) => [update.status, update.checks])).toEqual([
        ['started', 1],
        ['pending', 2],
      ]);
      expect(onProcessingUpdate.mock.calls[0][0].elapsedMs).toEqual(expect.any(Number));
    });

    it('does not report anything when the first check already shows completion', async () => {
      mockMonarch([{ status: 'completed', uploadedStatement: { transactionCount: 1 } }]);
      const onProcessingUpdate = vi.fn();

      await expect(uploadTransactionsToMonarch('monarch-1', CSV, { onProcessingUpdate })).resolves.toBe(true);

      expect(onProcessingUpdate).not.toHaveBeenCalled();
      expect(delays).toEqual([]);
    });

    it('still completes the upload when the progress callback throws', async () => {
      // A UI error must not turn an import Monarch is processing into a
      // reported failure: that is exactly what leads to duplicates.
      mockMonarch([{ status: 'started' }, { status: 'completed', uploadedStatement: { transactionCount: 1 } }]);
      const onProcessingUpdate = vi.fn(() => {
        throw new Error('progress dialog was closed');
      });

      await expect(uploadTransactionsToMonarch('monarch-1', CSV, { onProcessingUpdate })).resolves.toBe(true);
      expect(onProcessingUpdate).toHaveBeenCalledTimes(1);
    });

    it('works without a progress callback', async () => {
      mockMonarch([{ status: 'started' }, { status: 'completed', uploadedStatement: { transactionCount: 1 } }]);

      await expect(uploadTransactionsToMonarch('monarch-1', CSV)).resolves.toBe(true);
    });
  });

  describe('terminal statuses', () => {
    it.each(['failed', 'errored'])('fails immediately on "%s" without polling again', async (status) => {
      mockMonarch([{ status, errorMessage: 'Bad CSV' }]);

      await expect(uploadTransactionsToMonarch('monarch-1', CSV))
        .rejects.toThrow('Monarch transaction upload processing failed: Bad CSV');
      expect(statusChecks).toBe(1);
    });

    it('keeps waiting through a status it does not recognize', async () => {
      mockMonarch([
        { status: 'processing' },
        { status: 'completed', uploadedStatement: { transactionCount: 2 } },
      ]);
      const onProcessingUpdate = vi.fn();

      await expect(uploadTransactionsToMonarch('monarch-1', CSV, { onProcessingUpdate })).resolves.toBe(true);
      expect(onProcessingUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: 'processing', checks: 1 }));
    });
  });

  describe('wait budget', () => {
    it('polls every 2s for the first minute, then every 5s, for 10 minutes in total', async () => {
      mockMonarch([{ status: 'started' }]);

      await expect(uploadTransactionsToMonarch('monarch-1', CSV)).rejects.toThrow(/still processing the upload after 10 minutes/);

      expect(delays.slice(0, 29)).toEqual(Array(29).fill(2000));
      expect(new Set(delays.slice(29))).toEqual(new Set([5000]));
      const totalWait = delays.reduce((sum, ms) => sum + ms, 0);
      expect(totalWait).toBeGreaterThanOrEqual(10 * 60 * 1000);
      expect(totalWait).toBeLessThan(10 * 60 * 1000 + 5000);
      expect(statusChecks).toBe(delays.length + 1);
    });

    it('tells the user to check Monarch before syncing again when it gives up', async () => {
      mockMonarch([{ status: 'started' }]);

      await expect(uploadTransactionsToMonarch('monarch-1', CSV))
        .rejects.toThrow(/check the account in Monarch before syncing again, or these transactions may be uploaded twice/);
    });
  });

  describe('failed status checks', () => {
    it('retries through a few transient errors', async () => {
      mockMonarch([
        NETWORK_ERROR,
        SERVER_ERROR,
        { status: 'completed', uploadedStatement: { transactionCount: 1 } },
      ]);

      await expect(uploadTransactionsToMonarch('monarch-1', CSV)).resolves.toBe(true);
      expect(statusChecks).toBe(3);
    });

    it('gives up after 5 failed checks in a row and says the outcome is unconfirmed', async () => {
      mockMonarch([NETWORK_ERROR]);

      const error = await uploadTransactionsToMonarch('monarch-1', CSV).then(() => null, (e) => e);

      expect(error.message).toMatch(/^Could not confirm the upload with Monarch \(Network down\)\./);
      expect(error.message).toContain('check the account in Monarch before syncing again');
      expect(error.cause).toBeInstanceOf(Error);
      expect(statusChecks).toBe(5);
    });

    it('resets the error count after a successful check', async () => {
      mockMonarch([
        NETWORK_ERROR, NETWORK_ERROR, NETWORK_ERROR, NETWORK_ERROR,
        { status: 'started' },
        NETWORK_ERROR, NETWORK_ERROR, NETWORK_ERROR, NETWORK_ERROR,
        { status: 'completed', uploadedStatement: { transactionCount: 1 } },
      ]);

      await expect(uploadTransactionsToMonarch('monarch-1', CSV)).resolves.toBe(true);
      expect(statusChecks).toBe(10);
    });
  });
});
