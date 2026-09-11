import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';

// Mock the per-game backfill worker and all DB helpers the orchestrator calls.
vi.mock('./prices-history', () => ({
  backfillPriceHistory: vi.fn(),
}));

vi.mock('../db/queries', () => ({
  createSyncLog: vi.fn(() => 1),
  completeSyncLog: vi.fn(),
  getGamesForPriceHistoryBackfill: vi.fn(),
  getPriceHistoryRetryCandidates: vi.fn(() => []),
  markPriceHistoryBackfilled: vi.fn(),
  incrementPriceHistoryMissCount: vi.fn(),
  PRICE_HISTORY_GIVE_UP_MISSES: 3,
}));

import { backfillPriceHistory } from './prices-history';
import {
  createSyncLog,
  completeSyncLog,
  getGamesForPriceHistoryBackfill,
  getPriceHistoryRetryCandidates,
  markPriceHistoryBackfilled,
  incrementPriceHistoryMissCount,
} from '../db/queries';
import { syncPriceHistoryBackfill, primePriceHistory } from './price-history-backfill';

const mockBackfill = vi.mocked(backfillPriceHistory);
const mockGetGames = vi.mocked(getGamesForPriceHistoryBackfill);
const mockGetRetry = vi.mocked(getPriceHistoryRetryCandidates);
const mockMarkBackfilled = vi.mocked(markPriceHistoryBackfilled);
const mockIncrementMiss = vi.mocked(incrementPriceHistoryMissCount);
const mockCompleteSyncLog = vi.mocked(completeSyncLog);
const mockCreateSyncLog = vi.mocked(createSyncLog);

function game(id: number) {
  return { id, title: `Game ${id}`, itadGameId: `itad-${id}` };
}

describe('price-history-backfill orchestrator', () => {
  beforeAll(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-11T05:00:00Z'));
    mockCreateSyncLog.mockReturnValue(1);
    mockBackfill.mockResolvedValue({ inserted: 3 } as never);
    mockGetRetry.mockReturnValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('single-batch (nightly) mode processes one batch and exits', async () => {
    // First call yields a batch; a second call would yield more, but nightly
    // mode must break after the first batch regardless.
    mockGetGames.mockReturnValueOnce([game(1), game(2)]).mockReturnValue([game(3)]);

    const promise = syncPriceHistoryBackfill();
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(mockGetGames).toHaveBeenCalledTimes(1);
    expect(mockBackfill).toHaveBeenCalledTimes(2);
    expect(mockMarkBackfilled).toHaveBeenCalledTimes(2);
    expect(result.stats).toMatchObject({ attempted: 2, succeeded: 2, failed: 0 });
    expect(mockCompleteSyncLog).toHaveBeenCalledWith(1, 'success', 2, undefined, 2, 0);
  });

  it('drain mode loops until no eligible games remain', async () => {
    mockGetGames
      .mockReturnValueOnce([game(1), game(2)])
      .mockReturnValueOnce([game(3)])
      .mockReturnValue([]);

    const promise = primePriceHistory();
    await vi.runAllTimersAsync();
    const result = await promise;

    // 2 batches with games + 1 empty batch that ends the loop
    expect(mockGetGames).toHaveBeenCalledTimes(3);
    expect(mockBackfill).toHaveBeenCalledTimes(3);
    expect(result.stats).toMatchObject({ attempted: 3, succeeded: 3 });
  });

  it('a failing game increments the miss count and the batch continues', async () => {
    mockGetGames.mockReturnValueOnce([game(1), game(2)]).mockReturnValue([]);
    mockBackfill
      .mockRejectedValueOnce(new Error('ITAD 500'))
      .mockResolvedValueOnce({ inserted: 5 } as never);

    const promise = syncPriceHistoryBackfill();
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(mockIncrementMiss).toHaveBeenCalledTimes(1);
    expect(mockIncrementMiss).toHaveBeenCalledWith(1);
    // the failure did not stop the loop — the second game still succeeded
    expect(mockMarkBackfilled).toHaveBeenCalledTimes(1);
    expect(mockMarkBackfilled).toHaveBeenCalledWith(2);
    expect(result.stats).toMatchObject({ attempted: 2, succeeded: 1, failed: 1 });
  });

  it('an aborted signal stops mid-batch and still completes the sync_log as success', async () => {
    const controller = new AbortController();
    mockGetGames.mockReturnValueOnce([game(1), game(2), game(3)]).mockReturnValue([]);
    // Abort right after the first game is processed.
    mockBackfill.mockImplementation(async () => {
      controller.abort();
      return { inserted: 1 } as never;
    });

    const promise = syncPriceHistoryBackfill(undefined, controller.signal);
    await vi.runAllTimersAsync();
    const result = await promise;

    // Only the first game ran; the loop bailed before the second.
    expect(mockBackfill).toHaveBeenCalledTimes(1);
    expect(result.stats.attempted).toBe(1);
    expect(mockCompleteSyncLog).toHaveBeenCalledWith(1, 'success', 1, undefined, 1, 0);
  });

  it('skips a concurrent invocation via the isRunning guard', async () => {
    mockGetGames.mockReturnValueOnce([game(1), game(2)]).mockReturnValue([]);

    // Start the first run but do not await it — it parks on the inter-request delay.
    const first = primePriceHistory();
    // A second invocation while the first is mid-flight must short-circuit.
    const second = await primePriceHistory();

    expect(second.message).toBe('Another backfill is already running');
    expect(second.stats).toMatchObject({ attempted: 0, succeeded: 0 });

    // Let the first run finish so isRunning resets for later tests.
    await vi.runAllTimersAsync();
    await first;

    // Both invocations created a sync_log, but only the first did any work:
    // the second short-circuited, so no extra games were backfilled.
    expect(mockCreateSyncLog).toHaveBeenCalledTimes(2);
    expect(mockBackfill).toHaveBeenCalledTimes(2);
  });

  it('reports nothing-to-do when the first batch is empty', async () => {
    mockGetGames.mockReturnValue([]);

    const promise = syncPriceHistoryBackfill();
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(mockBackfill).not.toHaveBeenCalled();
    expect(result.stats.attempted).toBe(0);
    expect(result.message).toBe('All eligible games already backfilled');
  });

  // Reach-aware retry pool (S5). Repro case from the ticket: "The Darkside Detective:
  // A Fumble in the Dark", released Apr 15, 2021, Hoard history from 2026-02-06,
  // stamped "backfilled" on 2026-06-01. Now is 2026-09-11 (set in beforeEach).
  describe('stamped-but-short retry pool', () => {
    const repro = {
      id: 7,
      title: 'The Darkside Detective: A Fumble in the Dark',
      itadGameId: 'itad-darkside-2',
      releaseDate: 'Apr 15, 2021',
      earliestSnapshotDate: '2026-02-06',
      priceHistoryBackfilledAt: new Date('2026-06-01T05:00:00Z'),
      priceHistoryMissCount: 0,
    };

    it('re-backfills the repro game from the provider epoch once the never-backfilled batch has room', async () => {
      mockGetGames.mockReturnValue([]);
      mockGetRetry.mockReturnValue([repro]);

      const promise = syncPriceHistoryBackfill();
      await vi.runAllTimersAsync();
      const result = await promise;

      // Asked for stamps older than the 30-day cooldown: 2026-09-11 minus 30 days = 2026-08-12.
      const cutoff: Date = mockGetRetry.mock.calls[0][0];
      expect(cutoff.toISOString().slice(0, 10)).toBe('2026-08-12');
      expect(mockBackfill).toHaveBeenCalledTimes(1);
      const [gameId, opts] = mockBackfill.mock.calls[0];
      expect(gameId).toBe(7);
      // since must not trail the launch day (2021-04-15).
      expect(opts!.since!.toISOString().slice(0, 10) <= '2021-04-15').toBe(true);
      expect(mockMarkBackfilled).toHaveBeenCalledWith(7);
      expect(result.stats).toMatchObject({ attempted: 1, succeeded: 1, failed: 0 });
    });

    it('leaves a stamped game alone when its history already reaches launch', async () => {
      mockGetGames.mockReturnValue([]);
      mockGetRetry.mockReturnValue([{ ...repro, earliestSnapshotDate: '2021-04-15' }]);

      const promise = syncPriceHistoryBackfill();
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(mockBackfill).not.toHaveBeenCalled();
      expect(mockMarkBackfilled).not.toHaveBeenCalled();
      expect(result.stats.attempted).toBe(0);
    });

    it('never-backfilled games go first; the retry pool only fills the remaining slots', async () => {
      mockGetGames.mockReturnValueOnce([game(1)]).mockReturnValue([]);
      mockGetRetry.mockReturnValue([repro]);

      const promise = syncPriceHistoryBackfill();
      await vi.runAllTimersAsync();
      await promise;

      expect(mockBackfill.mock.calls.map((c) => c[0])).toEqual([1, 7]);
    });
  });
});
