/**
 * Tests for the shared marker tag queue.
 *
 * Every post-upload pass finds its work by reading a marker tag, so the two
 * behaviours proven here — tolerating tag propagation delay, and scanning far
 * enough forward — protect all of them at once.
 */

import { jest } from '@jest/globals';
import {
  resolveMarkerTag,
  fetchMarkerQueue,
  MARKER_TAG_LOOKUP_ATTEMPTS,
  MARKER_TAG_LOOKUP_DELAY_MS,
} from '../../../src/services/common/markerTagQueue';
import monarchApi from '../../../src/api/monarch';

jest.mock('../../../src/core/utils', () => ({
  debugLog: jest.fn(),
  formatDate: jest.fn((date) => {
    const d = date instanceof Date ? date : new Date(date);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }),
}));

jest.mock('../../../src/api/monarch', () => ({
  __esModule: true,
  default: {
    getTagByName: jest.fn(),
    getTransactionsList: jest.fn(),
  },
}));

describe('markerTagQueue', () => {
  /** Records sleep durations without actually waiting */
  let sleepCalls;
  let sleep;

  beforeEach(() => {
    jest.clearAllMocks();
    sleepCalls = [];
    sleep = jest.fn((ms) => {
      sleepCalls.push(ms);
      return Promise.resolve();
    });
  });

  describe('resolveMarkerTag', () => {
    test('returns the tag when it resolves on the first attempt', async () => {
      monarchApi.getTagByName.mockResolvedValue({ id: 'tag-1', name: 'Pending' });

      const tag = await resolveMarkerTag('Pending', sleep);

      expect(tag).toEqual({ id: 'tag-1', name: 'Pending' });
      expect(monarchApi.getTagByName).toHaveBeenCalledTimes(1);
      // No delay when there is nothing to wait for
      expect(sleep).not.toHaveBeenCalled();
    });

    test('retries while the tag may still be propagating', async () => {
      // The first sync after an import races Monarch's tag list, so a miss is
      // not necessarily a real absence.
      monarchApi.getTagByName
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'tag-1', name: 'Pending' });

      const tag = await resolveMarkerTag('Pending', sleep);

      expect(tag).toEqual({ id: 'tag-1', name: 'Pending' });
      expect(monarchApi.getTagByName).toHaveBeenCalledTimes(2);
    });

    test('waits between attempts', async () => {
      monarchApi.getTagByName
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'tag-1', name: 'Pending' });

      await resolveMarkerTag('Pending', sleep);

      expect(sleepCalls).toEqual([MARKER_TAG_LOOKUP_DELAY_MS]);
    });

    test('gives up after the bounded number of attempts', async () => {
      monarchApi.getTagByName.mockResolvedValue(null);

      const tag = await resolveMarkerTag('Pending', sleep);

      expect(tag).toBeNull();
      expect(monarchApi.getTagByName).toHaveBeenCalledTimes(MARKER_TAG_LOOKUP_ATTEMPTS);
      // No pointless sleep after the final attempt
      expect(sleep).toHaveBeenCalledTimes(MARKER_TAG_LOOKUP_ATTEMPTS - 1);
    });

    test('looks up the tag name it was given', async () => {
      monarchApi.getTagByName.mockResolvedValue({ id: 'tag-9', name: 'pendingOwnerUpdate' });

      await resolveMarkerTag('pendingOwnerUpdate', sleep);

      expect(monarchApi.getTagByName).toHaveBeenCalledWith('pendingOwnerUpdate');
    });
  });

  describe('fetchMarkerQueue', () => {
    test('returns the rows carrying the marker tag', async () => {
      monarchApi.getTagByName.mockResolvedValue({ id: 'tag-1', name: 'Pending' });
      monarchApi.getTransactionsList.mockResolvedValue({
        results: [{ id: 'tx-1' }, { id: 'tx-2' }],
      });

      const queue = await fetchMarkerQueue({
        monarchAccountId: 'acct-1', tagName: 'Pending', lookbackDays: 90, sleep,
      });

      expect(queue.markerTag).toEqual({ id: 'tag-1', name: 'Pending' });
      expect(queue.rows).toHaveLength(2);
    });

    test('filters by account and tag', async () => {
      monarchApi.getTagByName.mockResolvedValue({ id: 'tag-1', name: 'Pending' });
      monarchApi.getTransactionsList.mockResolvedValue({ results: [] });

      await fetchMarkerQueue({
        monarchAccountId: 'acct-1', tagName: 'Pending', lookbackDays: 90, sleep,
      });

      expect(monarchApi.getTransactionsList).toHaveBeenCalledWith(expect.objectContaining({
        accountIds: ['acct-1'],
        tags: ['tag-1'],
      }));
    });

    test('scans back by the requested lookback window', async () => {
      monarchApi.getTagByName.mockResolvedValue({ id: 'tag-1', name: 'Pending' });
      monarchApi.getTransactionsList.mockResolvedValue({ results: [] });

      await fetchMarkerQueue({
        monarchAccountId: 'acct-1', tagName: 'Pending', lookbackDays: 30, sleep,
      });

      const { startDate } = monarchApi.getTransactionsList.mock.calls[0][0];

      // Compared on the local calendar date, matching the mocked formatDate
      const expected = new Date();
      expected.setDate(expected.getDate() - 30);
      const expectedStr = `${expected.getFullYear()}-`
        + `${String(expected.getMonth() + 1).padStart(2, '0')}-`
        + `${String(expected.getDate()).padStart(2, '0')}`;

      expect(startDate).toBe(expectedStr);
    });

    test('scans a year ahead so user-edited future dates are not orphaned', async () => {
      // A row dated in the future would otherwise keep its marker tag forever.
      monarchApi.getTagByName.mockResolvedValue({ id: 'tag-1', name: 'Pending' });
      monarchApi.getTransactionsList.mockResolvedValue({ results: [] });

      await fetchMarkerQueue({
        monarchAccountId: 'acct-1', tagName: 'Pending', lookbackDays: 90, sleep,
      });

      const { endDate } = monarchApi.getTransactionsList.mock.calls[0][0];
      expect(Number(endDate.slice(0, 4))).toBe(new Date().getFullYear() + 1);
    });

    test('returns an empty queue when the tag does not exist', async () => {
      monarchApi.getTagByName.mockResolvedValue(null);

      const queue = await fetchMarkerQueue({
        monarchAccountId: 'acct-1', tagName: 'Pending', lookbackDays: 90, sleep,
      });

      expect(queue.markerTag).toBeNull();
      expect(queue.rows).toEqual([]);
      // Nothing to query without a tag id
      expect(monarchApi.getTransactionsList).not.toHaveBeenCalled();
    });

    test('returns an empty row list when nothing carries the marker', async () => {
      monarchApi.getTagByName.mockResolvedValue({ id: 'tag-1', name: 'Pending' });
      monarchApi.getTransactionsList.mockResolvedValue({ results: [] });

      const queue = await fetchMarkerQueue({
        monarchAccountId: 'acct-1', tagName: 'Pending', lookbackDays: 90, sleep,
      });

      expect(queue.markerTag).not.toBeNull();
      expect(queue.rows).toEqual([]);
    });

    test('tolerates a response with no results field', async () => {
      monarchApi.getTagByName.mockResolvedValue({ id: 'tag-1', name: 'Pending' });
      monarchApi.getTransactionsList.mockResolvedValue({});

      const queue = await fetchMarkerQueue({
        monarchAccountId: 'acct-1', tagName: 'Pending', lookbackDays: 90, sleep,
      });

      expect(queue.rows).toEqual([]);
    });

    test('propagates a transaction query failure to the caller', async () => {
      // Each pass wraps its own call and decides how to report; the queue itself
      // does not silently swallow errors.
      monarchApi.getTagByName.mockResolvedValue({ id: 'tag-1', name: 'Pending' });
      monarchApi.getTransactionsList.mockRejectedValue(new Error('boom'));

      await expect(fetchMarkerQueue({
        monarchAccountId: 'acct-1', tagName: 'Pending', lookbackDays: 90, sleep,
      })).rejects.toThrow('boom');
    });
  });
});