import type { UpNextBucket } from '@/lib/backlog/upNext';

export interface UpNextItem {
  gameId: number;
  title: string;
  bucket: UpNextBucket;
  reason: string;
  score: number;
}

/** Badge background, keyed by bucket — mirrors the DealIndicator/ValueReceivedIndicator
 *  convention (categorical enum -> solid color chip, white text, `/N` for a muted variant). */
export const UP_NEXT_BUCKET_BG: Record<UpNextBucket, string> = {
  continue: 'bg-deal-great',
  'finish-soon': 'bg-deal-good',
  'start-fresh': 'bg-primary',
  drop: 'bg-deal-poor/80',
};

export const UP_NEXT_BUCKET_LABEL: Record<UpNextBucket, string> = {
  continue: 'Continue',
  'finish-soon': 'Finish Soon',
  'start-fresh': 'Start Fresh',
  drop: 'Drop',
};

/**
 * Narrow + validate the `/api/backlog/recommendations` GET response shape
 * (`{ data: { queue: UpNextItem[] } }`, the `ApiResponse<T>` convention) so a
 * malformed or unexpected payload surfaces as an error rather than a silent
 * empty render. Exported for direct unit testing without mounting the DOM.
 */
export function parseUpNextQueueResponse(body: unknown): UpNextItem[] {
  const data = (body as { data?: unknown } | null | undefined)?.data;
  const queue = (data as { queue?: unknown } | null | undefined)?.queue;
  if (!Array.isArray(queue)) {
    throw new Error('Malformed Up Next response');
  }
  return queue as UpNextItem[];
}

/**
 * Fetch + parse the queue from the shipped route. Exported (module-level, not
 * a closure inside the component) so tests can stub `global.fetch` and
 * exercise the success/empty/error paths directly.
 */
export async function fetchUpNextQueue(): Promise<UpNextItem[]> {
  const res = await fetch('/api/backlog/recommendations');
  if (!res.ok) {
    throw new Error(`Up Next request failed (${res.status})`);
  }
  const body = await res.json();
  return parseUpNextQueueResponse(body);
}

// ---------------------------------------------------------------------------
// Implicit-feedback signals — POST to the SAME shipped route's existing actions
// so backlog-v2's learning ranker gets feedback from this UI. Best-effort and
// fire-and-forget: a failed signal never surfaces to the user, blocks
// navigation, or perturbs the GET/display path. No `dismissed` — this panel has
// no dismiss affordance.
// ---------------------------------------------------------------------------

/** `shown` payload — matches the route's zod schema: items min 1 / max 20, each
 *  { gameId, bucket, reason, score? }. */
export interface ShownSignal {
  action: 'shown';
  items: { gameId: number; bucket: UpNextBucket; reason: string; score: number }[];
}

/** `accepted` payload — identified by gameId (the route updates the open `shown`
 *  event for that game). */
export interface AcceptedSignal {
  action: 'accepted';
  gameId: number;
}

export type RecommendationSignal = ShownSignal | AcceptedSignal;

export function buildShownSignal(items: UpNextItem[]): ShownSignal {
  return {
    action: 'shown',
    items: items.map((it) => ({
      gameId: it.gameId,
      bucket: it.bucket,
      reason: it.reason,
      score: it.score,
    })),
  };
}

export function buildAcceptedSignal(gameId: number): AcceptedSignal {
  return { action: 'accepted', gameId };
}

/**
 * Fire a single implicit-feedback signal. NEVER throws: a non-ok response or a
 * network failure is swallowed (logged only), so callers can treat it as pure
 * fire-and-forget and the display path is guaranteed unaffected.
 */
export async function postRecommendationSignal(body: RecommendationSignal): Promise<void> {
  try {
    await fetch('/api/backlog/recommendations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      // Let the `accepted` POST outlive the click-through navigation.
      keepalive: true,
    });
  } catch {
    // Best-effort — swallow. Implicit feedback must never break the panel.
  }
}

/** Stable identity for a surfaced queue — the set of game ids. Re-firing `shown`
 *  is keyed off this so a re-render or StrictMode double-invoke can't double-count. */
export function shownSignalKey(items: UpNextItem[]): string {
  return items.map((it) => it.gameId).join(',');
}

/**
 * Emit the `shown` signal at most once per distinct surfaced queue. `firedRef`
 * is set to the queue key SYNCHRONOUSLY before the await, so two near-concurrent
 * calls (React StrictMode's double effect invoke) collapse to a single POST.
 * Never throws. Returns true iff it actually fired this call.
 */
export async function emitShownOnce(
  items: UpNextItem[],
  firedRef: { current: string | null },
  post: (body: RecommendationSignal) => Promise<void> = postRecommendationSignal,
): Promise<boolean> {
  if (items.length === 0) return false;
  const key = shownSignalKey(items);
  if (firedRef.current === key) return false;
  firedRef.current = key; // set before await → guards concurrent double-invoke
  try {
    await post(buildShownSignal(items));
  } catch {
    // swallow — best effort; a failed attempt still counts as fired (no retry spam)
  }
  return true;
}
