/**
 * Canada Life — transaction deduplication stability across the 2026 API migration
 *
 * When Canada Life moved the member portal off the Vlocity Insurance package
 * onto their own `Mclaw*` Apex controllers, the `Activities[]` row shape stayed
 * byte-for-byte identical. That is what makes this migration safe: every
 * already-uploaded transaction ID in `uploadedTransactions` remains valid.
 *
 * If a future change renames or reshapes those fields, these tests fail — which
 * is the point. A changed hash would re-upload every historical transaction and
 * orphan every `cl-tx:{hash}` marker written into Monarch notes for pending
 * reconciliation.
 */

import {
  generateActivityHash,
  processCanadaLifeActivity,
} from '../../../src/services/canadalife/transactions';
import { loadAccountActivityReport } from '../../../src/api/canadalife';

import stateManager from '../../../src/core/state';
import { installCanadaLifeTestGlobals } from './harness';
import {
  DPSP_AGREEMENT_ID,
  buildActivities,
  buildActivityReportResponse,
  mockFetchResponse,
  wrapAuraSuccess,
} from './fixtures';

jest.mock('../../../src/core/state', () => {
  const { buildStateMock: build } = jest.requireActual('./harness');
  return build();
});
jest.mock('../../../src/core/utils', () => {
  const { buildUtilsMock: build } = jest.requireActual('./harness');
  return build();
});
jest.mock('../../../src/ui/toast', () => {
  const { buildToastMock: build } = jest.requireActual('./harness');
  return build();
});

installCanadaLifeTestGlobals();

const mockAccount = {
  agreementId: DPSP_AGREEMENT_ID,
  EnglishShortName: 'DPSP',
  LongNameEnglish: 'DEFERRED PROFIT SHARING PLAN',
};

/** Wrap activities in the retired Vlocity envelope */
function buildLegacyReportResponse(activities) {
  return wrapAuraSuccess({
    IPResult: {
      Summary: {
        Total: { Value: 154421.97 },
        Details: [{ Description: 'Value of this plan on August 21, 2026', Value: 153387.73 }],
      },
      Activities: activities,
    },
  }, '184;a');
}

describe('Canada Life dedup - hash stability across API versions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    stateManager.getState.mockReturnValue({
      auth: { canadalife: { token: 'valid-aura-token' } },
    });
  });

  test('activity rows from the new API produce the same hashes as the legacy API', async () => {
    const activities = buildActivities();

    global.fetch.mockResolvedValueOnce(mockFetchResponse(buildActivityReportResponse({ activities })));
    const current = await loadAccountActivityReport(mockAccount, '2026-08-21', '2026-09-08');

    global.fetch.mockResolvedValueOnce(mockFetchResponse(buildLegacyReportResponse(activities)));
    const legacy = await loadAccountActivityReport(mockAccount, '2026-08-21', '2026-09-08');

    const currentHashes = await Promise.all(current.activities.map(generateActivityHash));
    const legacyHashes = await Promise.all(legacy.activities.map(generateActivityHash));

    expect(currentHashes).toEqual(legacyHashes);
  });

  // Pinning the literal hashes catches any change to the hash input fields or
  // their formatting, which would silently invalidate stored dedup IDs.
  test('the captured activities hash to their known values', async () => {
    const hashes = await Promise.all(buildActivities().map(generateActivityHash));

    expect(hashes[0]).toBe('cl-tx:0c1bd4643bd33974');
    expect(hashes[1]).toBe('cl-tx:d0c26487742125a7');
  });

  test('hashes carry the cl-tx: prefix required by note-based reconciliation', async () => {
    const hashes = await Promise.all(buildActivities().map(generateActivityHash));

    hashes.forEach((hash) => {
      expect(hash).toMatch(/^cl-tx:[0-9a-f]{16}$/);
    });
  });

  test('distinct activities hash differently', async () => {
    const [first, second] = await Promise.all(buildActivities().map(generateActivityHash));

    expect(first).not.toBe(second);
  });

  test('hashing is deterministic across calls', async () => {
    const [activity] = buildActivities();

    const first = await generateActivityHash(activity);
    const second = await generateActivityHash({ ...activity });

    expect(first).toBe(second);
  });

  test.each([
    ['Date', { Date: '2026-08-29T00:00:00' }],
    ['Activity', { Activity: 'New contribution (reversed)' }],
    ['Amount', { Amount: 200.0 }],
    ['InvestmentVehicleAndAccountLongName', { InvestmentVehicleAndAccountLongName: 'Other Fund-Member' }],
    ['Units', { Units: 0.9 }],
  ])('a change to %s changes the hash', async (_field, override) => {
    const [activity] = buildActivities();

    const original = await generateActivityHash(activity);
    const modified = await generateActivityHash({ ...activity, ...override });

    expect(modified).not.toBe(original);
  });
});

describe('Canada Life dedup - end-to-end transaction processing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    stateManager.getState.mockReturnValue({
      auth: { canadalife: { token: 'valid-aura-token' } },
    });
  });

  test('activities from the new API process into complete transactions', async () => {
    global.fetch.mockResolvedValueOnce(mockFetchResponse(buildActivityReportResponse()));

    const { activities } = await loadAccountActivityReport(mockAccount, '2026-08-21', '2026-09-08');
    const transaction = await processCanadaLifeActivity(activities[0], 'DPSP');

    expect(transaction).toMatchObject({
      id: 'cl-tx:0c1bd4643bd33974',
      date: '2026-08-28',
      merchant: 'International Equity Index (TDAM)',
      originalMerchant: 'International Equity Index (TDAM)-Employer',
      amount: 193.92,
      category: 'Buy',
      account: 'DPSP',
      isPending: false,
    });
  });

  test('previously uploaded IDs still match activities fetched from the new API', async () => {
    // Simulate `uploadedTransactions` written before the API migration
    const storedIds = new Set(await Promise.all(buildActivities().map(generateActivityHash)));

    global.fetch.mockResolvedValueOnce(mockFetchResponse(buildActivityReportResponse()));
    const { activities } = await loadAccountActivityReport(mockAccount, '2026-08-21', '2026-09-08');

    const freshIds = await Promise.all(activities.map(generateActivityHash));

    // Every fetched activity is recognised as already uploaded — no re-upload
    freshIds.forEach((id) => {
      expect(storedIds.has(id)).toBe(true);
    });
  });
});