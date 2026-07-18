import { describe, it, expect, vi } from 'vitest';
import {
  chunk,
  runBulkConfirmBatches,
  BULK_CONFIRM_MAX_BATCH,
  type BulkConfirmApiEntry,
  type BulkConfirmBatchResult,
} from './bulkConfirmBatches';

describe('chunk', () => {
  it('splits into consecutive chunks of at most `size`', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('returns an empty array for empty input', () => {
    expect(chunk([], 200)).toEqual([]);
  });

  it('returns a single chunk when input fits', () => {
    expect(chunk([1, 2, 3], 200)).toEqual([[1, 2, 3]]);
  });

  it('throws for a size < 1 (would loop forever otherwise)', () => {
    expect(() => chunk([1], 0)).toThrow();
  });
});

describe('runBulkConfirmBatches', () => {
  it('sends a >200 backlog in multiple requests, each within the server cap, confirming all', async () => {
    const total = 450;
    const entries: BulkConfirmApiEntry[] = Array.from({ length: total }, (_, i) => ({ gameId: i + 1 }));

    const sentBatches: BulkConfirmApiEntry[][] = [];
    const send = vi.fn(async (batch: BulkConfirmApiEntry[]): Promise<BulkConfirmBatchResult> => {
      sentBatches.push(batch);
      // Simulate the server confirming every game in the batch.
      return { applied: batch.map((e) => e.gameId), skipped: [] };
    });

    const result = await runBulkConfirmBatches(entries, send);

    // Split into ceil(450/200) = 3 requests (200 + 200 + 50).
    expect(send).toHaveBeenCalledTimes(3);
    expect(sentBatches.map((b) => b.length)).toEqual([200, 200, 50]);
    // Every batch respects the server cap.
    for (const batch of sentBatches) {
      expect(batch.length).toBeLessThanOrEqual(BULK_CONFIRM_MAX_BATCH);
    }
    // All 450 games confirmed, none lost across the batch boundaries.
    expect(result.applied).toHaveLength(total);
    expect(new Set(result.applied)).toEqual(new Set(entries.map((e) => e.gameId)));
    expect(result.skipped).toEqual([]);
  });

  it('sends a <=200 backlog in a single request', async () => {
    const entries: BulkConfirmApiEntry[] = Array.from({ length: 200 }, (_, i) => ({ gameId: i + 1 }));
    const send = vi.fn(async (batch: BulkConfirmApiEntry[]): Promise<BulkConfirmBatchResult> => ({
      applied: batch.map((e) => e.gameId),
      skipped: [],
    }));

    await runBulkConfirmBatches(entries, send);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('aggregates applied and skipped across batches', async () => {
    const entries: BulkConfirmApiEntry[] = Array.from({ length: 300 }, (_, i) => ({ gameId: i + 1 }));
    const send = vi.fn(async (batch: BulkConfirmApiEntry[]): Promise<BulkConfirmBatchResult> => {
      // Odd gameIds "applied", even gameIds "skipped" — exercises aggregation of both.
      const applied = batch.filter((e) => e.gameId % 2 === 1).map((e) => e.gameId);
      const skipped = batch.filter((e) => e.gameId % 2 === 0).map((e) => e.gameId);
      return { applied, skipped };
    });

    const result = await runBulkConfirmBatches(entries, send);
    expect(send).toHaveBeenCalledTimes(2); // 200 + 100
    expect(result.applied).toHaveLength(150);
    expect(result.skipped).toHaveLength(150);
    expect(result.applied.every((id) => id % 2 === 1)).toBe(true);
    expect(result.skipped.every((id) => id % 2 === 0)).toBe(true);
  });

  it('propagates a batch failure so the caller can surface it', async () => {
    const entries: BulkConfirmApiEntry[] = Array.from({ length: 250 }, (_, i) => ({ gameId: i + 1 }));
    const send = vi.fn(async (): Promise<BulkConfirmBatchResult> => {
      throw new Error('network error');
    });
    await expect(runBulkConfirmBatches(entries, send)).rejects.toThrow('network error');
  });
});
