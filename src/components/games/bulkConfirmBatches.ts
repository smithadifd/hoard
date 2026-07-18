/**
 * Client-side batching for the price-paid bulk-confirm backlog.
 *
 * The server route caps a single request at `BULK_CONFIRM_MAX_BATCH` entries
 * (see `bulkConfirmPricePaidSchema` in src/lib/validations.ts). Accept-All /
 * Accept-Selected can name the entire backlog, which may exceed that cap — so
 * the client splits the request into sequential batches of at most that many
 * entries and aggregates the per-batch results, rather than sending one
 * oversized request the server would reject wholesale (leaving nothing
 * confirmed). Kept as a pure module (no React/DOM) so the batching + aggregation
 * is unit-testable in the repo's node-env test setup.
 */

/** Must not exceed the server-side `.max()` on bulkConfirmPricePaidSchema.entries. */
export const BULK_CONFIRM_MAX_BATCH = 200;

export interface BulkConfirmApiEntry {
  gameId: number;
  value?: number;
}

export interface BulkConfirmBatchResult {
  applied: number[];
  skipped: number[];
}

/** Split `arr` into consecutive chunks of at most `size` (size >= 1). */
export function chunk<T>(arr: T[], size: number): T[][] {
  if (size < 1) throw new Error('chunk size must be >= 1');
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

/**
 * Send `entries` to `send` in sequential batches of at most `BULK_CONFIRM_MAX_BATCH`,
 * aggregating applied/skipped across every batch. `send` performs one request and
 * is injected so this orchestration can be tested without a real fetch/DOM. If a
 * batch's `send` rejects, the error propagates (the caller surfaces it); batches
 * already sent have their DB writes committed server-side, and re-running is a
 * safe no-op thanks to the server's idempotent pending re-check.
 */
export async function runBulkConfirmBatches(
  entries: BulkConfirmApiEntry[],
  send: (batch: BulkConfirmApiEntry[]) => Promise<BulkConfirmBatchResult>,
): Promise<BulkConfirmBatchResult> {
  const applied: number[] = [];
  const skipped: number[] = [];
  for (const batch of chunk(entries, BULK_CONFIRM_MAX_BATCH)) {
    const res = await send(batch);
    applied.push(...res.applied);
    skipped.push(...res.skipped);
  }
  return { applied, skipped };
}
