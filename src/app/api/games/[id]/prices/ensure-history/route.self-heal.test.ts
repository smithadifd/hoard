import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { createTestDb, seedGame, seedUserGame, seedPriceSnapshot } from '@/lib/db/test-helpers';
import type { TestDb } from '@/lib/db/test-helpers';
import type { ITADHistoryEntry } from '@/lib/itad/types';

// Vertical regression for the self-heal: the real route, the real query module and
// the real per-game backfill over an in-memory SQLite (getDb swapped as the query
// tests do), with only the provider (ITAD client), config and auth mocked — the
// same boundaries prices-history.test.ts and route.test.ts already mock.
let testDb: TestDb;

vi.mock('@/lib/db/index', async () => {
  const actualSchema = await vi.importActual('@/lib/db/schema');
  return { getDb: () => testDb, schema: actualSchema };
});

vi.mock('@/lib/auth-helpers', () => ({
  requireUserIdFromRequest: vi.fn().mockResolvedValue('test-user-id'),
}));

vi.mock('@/lib/config', () => ({
  getEffectiveConfig: vi.fn(() => ({ itadApiKey: 'test-key' })),
}));

const mockGetPriceHistory = vi.fn();
vi.mock('@/lib/itad/client', () => ({
  getITADClient: vi.fn(() => ({ getPriceHistory: mockGetPriceHistory, lookupBySteamAppId: vi.fn() })),
  getAndResetItadApiCalls: vi.fn(() => 1),
}));

import { POST } from './route';

// Repro case from the ticket: "The Darkside Detective: A Fumble in the Dark" —
// Steam app 795420, released Apr 15, 2021; Hoard's snapshots for it began 2026-02-06
// and the game had been stamped "backfilled" on 2026-06-01 (a give-up or an empty pull).
const REPRO = {
  steamAppId: 795420,
  title: 'The Darkside Detective: A Fumble in the Dark',
  releaseDate: 'Apr 15, 2021',
  launchDay: '2021-04-15',
  earliestSnapshot: '2026-02-06',
  stampedAt: new Date('2026-06-01T05:00:00Z'),
  now: new Date('2026-09-11T12:00:00Z'),
};

function event(timestamp: string, price: number, regular: number, cut: number): ITADHistoryEntry {
  return {
    timestamp,
    shop: { id: 61, name: 'Steam' },
    deal: {
      price: { amount: price, amountInt: Math.round(price * 100), currency: 'USD' },
      regular: { amount: regular, amountInt: Math.round(regular * 100), currency: 'USD' },
      cut,
    },
  };
}

// What the provider holds for the game: sales back to its launch day.
const PROVIDER_HISTORY: ITADHistoryEntry[] = [
  event('2021-04-15T17:00:00Z', 12.99, 12.99, 0),
  event('2021-11-24T18:00:00Z', 8.44, 12.99, 35),
  event('2023-06-29T17:00:00Z', 3.89, 12.99, 70),
  event('2025-12-18T18:00:00Z', 4.54, 12.99, 65),
];

function seedRepro(overrides: { earliestSnapshot?: string; stampedAt?: Date | null } = {}) {
  const gameId = seedGame(testDb, {
    steamAppId: REPRO.steamAppId,
    title: REPRO.title,
    releaseDate: REPRO.releaseDate,
    isReleased: true,
    itadGameId: 'itad-darkside-2',
    priceHistoryBackfilledAt: overrides.stampedAt === undefined ? REPRO.stampedAt : overrides.stampedAt,
    priceHistoryMissCount: 0,
  });
  seedUserGame(testDb, gameId, { isWishlisted: true });
  seedPriceSnapshot(testDb, gameId, { store: 'Steam', snapshotDate: overrides.earliestSnapshot ?? REPRO.earliestSnapshot, priceCurrent: 12.99 });
  seedPriceSnapshot(testDb, gameId, { store: 'Steam', snapshotDate: '2026-09-10', priceCurrent: 3.99 });
  return gameId;
}

function earliestSnapshotDate(gameId: number): string | null {
  const row = testDb.get<{ earliest: string | null }>(
    sql`SELECT MIN(snapshot_date) as earliest FROM price_snapshots WHERE game_id = ${gameId}`,
  );
  return row?.earliest ?? null;
}

function stampOf(gameId: number): number | null {
  const row = testDb.get<{ stamp: number | null }>(
    sql`SELECT price_history_backfilled_at as stamp FROM games WHERE id = ${gameId}`,
  );
  return row?.stamp ?? null;
}

function post(gameId: number) {
  return POST(
    new Request(`http://localhost/api/games/${gameId}/prices/ensure-history`, { method: 'POST' }),
    { params: Promise.resolve({ id: String(gameId) }) },
  );
}

describe('ensure-history self-heal reaches launch without the manual button (S3)', () => {
  beforeEach(() => {
    testDb = createTestDb();
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(REPRO.now);
    mockGetPriceHistory.mockResolvedValue(PROVIDER_HISTORY);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('the repro game, stamped on 2026-06-01 with history from 2026-02-06, gets history back to its 2021-04-15 launch on page open', async () => {
    const gameId = seedRepro();
    expect(earliestSnapshotDate(gameId)).toBe(REPRO.earliestSnapshot);

    const res = await post(gameId);
    const body = await res.json();

    expect(body.data.status).toBe('backfilled');
    // Asked the provider for everything at or before launch (its since must not trail the launch day).
    const since: Date = mockGetPriceHistory.mock.calls[0][1].since;
    expect(since.toISOString().slice(0, 10) <= REPRO.launchDay).toBe(true);
    // The observable the ticket asks for: history now reaches the launch day.
    expect(earliestSnapshotDate(gameId)).toBe(REPRO.launchDay);
    // Stamp refreshed to now, so the next open is a no-op until the cooldown lapses.
    expect(stampOf(gameId)).toBe(REPRO.now.getTime());
  });

  it('once history reaches launch, a further open is a no-op with no provider call', async () => {
    const gameId = seedRepro({ earliestSnapshot: REPRO.launchDay });
    const res = await post(gameId);
    const body = await res.json();
    expect(body.data.status).toBe('already-backfilled');
    expect(mockGetPriceHistory).not.toHaveBeenCalled();
  });

  it('a stamped-but-short game inside the 30-day cooldown is not retried yet', async () => {
    const gameId = seedRepro({ stampedAt: new Date('2026-09-01T05:00:00Z') });
    const res = await post(gameId);
    const body = await res.json();
    expect(body.data.status).toBe('cooling-down');
    expect(mockGetPriceHistory).not.toHaveBeenCalled();
    expect(earliestSnapshotDate(gameId)).toBe(REPRO.earliestSnapshot);
  });
});
