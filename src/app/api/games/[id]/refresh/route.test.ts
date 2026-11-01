import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb, seedGame, seedUserGame } from '@/lib/db/test-helpers';
import type { TestDb } from '@/lib/db/test-helpers';
import * as schema from '@/lib/db/schema';

// The real routes and query module over an in-memory SQLite, with only the
// providers (Steam, HLTB) and auth mocked.
let testDb: TestDb;

vi.mock('@/lib/db/index', async () => {
  const actualSchema = await vi.importActual('@/lib/db/schema');
  return { getDb: () => testDb, schema: actualSchema };
});

vi.mock('@/lib/auth-helpers', () => ({
  requireUserIdFromRequest: vi.fn().mockResolvedValue('test-user-id'),
}));

const steam = {
  getAppDetails: vi.fn(),
  getReviewSummary: vi.fn(),
  getReviewPlaytimes: vi.fn(),
};
vi.mock('@/lib/steam/client', () => ({
  getSteamClient: vi.fn(() => steam),
}));

const hltbSearch = vi.fn();
vi.mock('@/lib/hltb/client', () => ({
  getHLTBClient: vi.fn(() => ({ search: hltbSearch })),
}));

import { POST as refresh } from './route';
import { POST as playtimeFetch } from '../steam-playtime-fetch/route';

const NOW = new Date('2026-11-01T12:00:00Z');
// 40 reviewers with 5h each: a usable sample with a 5h median.
const PLAYTIMES = Array.from({ length: 40 }, () => 300);

function call(handler: typeof refresh, gameId: number, path: string) {
  return handler(
    new Request(`http://localhost/api/games/${gameId}/${path}`, { method: 'POST' }),
    { params: Promise.resolve({ id: String(gameId) }) },
  );
}

function readGame(gameId: number) {
  return testDb.select().from(schema.games).where(eq(schema.games.id, gameId)).get()!;
}

// Car Park Capital as it stood on prod on 2026-11-01.
function seedCarPark() {
  const id = seedGame(testDb, {
    steamAppId: 3031880,
    title: 'Car Park Capital',
    releaseDate: 'Oct 9, 2026',
    isReleased: true,
    reviewScore: 0,
    reviewCount: 0,
    steamPlaytimeMissCount: 3,
  });
  testDb.update(schema.games)
    .set({ steamPlaytimeUpdatedAt: '2026-07-04T02:31:03.229Z', hltbMissCount: 6, hltbLastUpdated: '2026-10-30T00:00:00.000Z' })
    .where(eq(schema.games.id, id))
    .run();
  seedUserGame(testDb, id, { isWishlisted: true });
  return id;
}

beforeEach(() => {
  testDb = createTestDb();
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  steam.getAppDetails.mockResolvedValue({
    short_description: 'Build a parking empire.',
    developers: ['Dev'],
    publishers: ['Pub'],
    categories: [{ id: 2, description: 'Single-player' }],
    genres: [{ id: '28', description: 'Simulation' }],
    // A manual refresh must not write these; the release and EA jobs own them.
    release_date: { coming_soon: false, date: 'Oct 9, 2026' },
  });
  steam.getReviewSummary.mockResolvedValue({ total_positive: 1244, total_reviews: 1282, review_score_desc: 'Overwhelmingly Positive' });
  steam.getReviewPlaytimes.mockResolvedValue(PLAYTIMES);
  hltbSearch.mockResolvedValue({ id: '555', similarity: 0.9, gameplayMain: 8, gameplayMainExtra: 12, gameplayCompletionist: 20 });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('POST /api/games/:id/refresh', () => {
  it('pulls reviews, playtime and HLTB past every give-up cap', async () => {
    const id = seedCarPark();

    const res = await call(refresh, id, 'refresh');
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toEqual({ reviews: 'updated', playtime: 'updated', hltb: 'matched' });
    const after = readGame(id);
    expect(after.reviewCount).toBe(1282);
    expect(after.reviewScore).toBe(97);
    expect(after.steamPlaytimeMedian).toBe(5);
    expect(after.steamPlaytimeMissCount).toBe(0);
    expect(after.hltbMain).toBe(8);
  });

  it('leaves hand-entered HLTB alone', async () => {
    const id = seedCarPark();
    testDb.update(schema.games).set({ hltbManual: true, hltbMain: 3 }).where(eq(schema.games.id, id)).run();

    const body = await (await call(refresh, id, 'refresh')).json();

    expect(body.data.hltb).toBe('manual');
    expect(hltbSearch).not.toHaveBeenCalled();
    expect(readGame(id).hltbMain).toBe(3);
  });

  it('does not write the release or Early Access flags', async () => {
    const id = seedGame(testDb, { steamAppId: 1, title: 'Launch day', isReleased: false, isEarlyAccess: true });

    await call(refresh, id, 'refresh');

    expect(readGame(id).isReleased).toBe(false);
    expect(readGame(id).isEarlyAccess).toBe(true);
  });

  it('reports each source separately when one fails', async () => {
    const id = seedCarPark();
    steam.getReviewPlaytimes.mockRejectedValue(new Error('rate limited'));
    hltbSearch.mockResolvedValue(null);

    const body = await (await call(refresh, id, 'refresh')).json();

    expect(body.data).toEqual({ reviews: 'updated', playtime: 'error', hltb: 'no_match' });
  });

  it('reports a failed playtime request as an error without counting a miss', async () => {
    const id = seedCarPark();
    steam.getReviewPlaytimes.mockResolvedValue(null);

    const body = await (await call(refresh, id, 'refresh')).json();

    expect(body.data.playtime).toBe('error');
    expect(readGame(id).steamPlaytimeMissCount).toBe(3);
  });

  it('does not stamp review freshness when the review summary fails', async () => {
    const id = seedCarPark();
    steam.getReviewSummary.mockResolvedValue(null);

    const body = await (await call(refresh, id, 'refresh')).json();

    expect(body.data.reviews).toBe('unavailable');
    expect(readGame(id).reviewLastUpdated).toBeNull();
    // The store details that did come back are still saved.
    expect(readGame(id).developer).toBe('Dev');
    expect(readGame(id).description).toBe('Build a parking empire.');
  });

  it('refuses a second refresh of the same game while one is running', async () => {
    const id = seedCarPark();
    let release!: (v: unknown) => void;
    steam.getAppDetails.mockReturnValueOnce(new Promise((r) => { release = r; }));

    const first = call(refresh, id, 'refresh');
    await vi.waitFor(() => expect(steam.getAppDetails).toHaveBeenCalledTimes(1));
    const second = await call(refresh, id, 'refresh');
    expect(second.status).toBe(409);

    release(null);
    expect((await first).status).toBe(200);
    expect((await call(refresh, id, 'refresh')).status).toBe(200);
  });

  it('returns 404 for an unknown game', async () => {
    const res = await call(refresh, 999, 'refresh');
    expect(res.status).toBe(404);
  });
});

describe('POST /api/games/:id/steam-playtime-fetch', () => {
  it('samples a game that gave up before launch, on page open', async () => {
    const id = seedCarPark();

    const body = await (await call(playtimeFetch, id, 'steam-playtime-fetch')).json();

    expect(body.data).toEqual({ steamPlaytimeMedian: 5, steamPlaytimeSampleSize: 40, refreshed: true });
    expect(steam.getReviewPlaytimes).toHaveBeenCalledWith(3031880);
  });

  it('returns the stored median without a Steam call when not due', async () => {
    const id = seedGame(testDb, {
      steamAppId: 1, title: 'Fresh', releaseDate: 'Oct 9, 2026', isReleased: true,
      steamPlaytimeMedian: 4, steamPlaytimeSampleSize: 30,
    });
    testDb.update(schema.games).set({ steamPlaytimeUpdatedAt: '2026-10-30T00:00:00.000Z' }).where(eq(schema.games.id, id)).run();

    const body = await (await call(playtimeFetch, id, 'steam-playtime-fetch')).json();

    expect(body.data).toEqual({ steamPlaytimeMedian: 4, steamPlaytimeSampleSize: 30, refreshed: false });
    expect(steam.getReviewPlaytimes).not.toHaveBeenCalled();
  });

  it("re-samples a young game's week-old median on page open", async () => {
    const id = seedGame(testDb, {
      steamAppId: 1, title: 'Young', releaseDate: 'Oct 9, 2026', isReleased: true,
      steamPlaytimeMedian: 2, steamPlaytimeSampleSize: 25,
    });
    testDb.update(schema.games).set({ steamPlaytimeUpdatedAt: '2026-10-20T00:00:00.000Z' }).where(eq(schema.games.id, id)).run();

    const body = await (await call(playtimeFetch, id, 'steam-playtime-fetch')).json();

    expect(body.data).toEqual({ steamPlaytimeMedian: 5, steamPlaytimeSampleSize: 40, refreshed: true });
    expect(readGame(id).steamPlaytimeMedian).toBe(5);
  });

  it('never samples an unreleased game', async () => {
    const id = seedGame(testDb, { steamAppId: 1, title: 'Soon', releaseDate: 'Dec 14, 2026', isReleased: false });

    const body = await (await call(playtimeFetch, id, 'steam-playtime-fetch')).json();

    expect(body.data.refreshed).toBe(false);
    expect(steam.getReviewPlaytimes).not.toHaveBeenCalled();
    expect(readGame(id).steamPlaytimeMissCount).toBe(0);
  });

  it('keeps the stored median when a re-sample comes back too small', async () => {
    const id = seedGame(testDb, {
      steamAppId: 1, title: 'Young', releaseDate: 'Oct 9, 2026', isReleased: true,
      steamPlaytimeMedian: 4, steamPlaytimeSampleSize: 30,
    });
    testDb.update(schema.games).set({ steamPlaytimeUpdatedAt: '2026-10-20T00:00:00.000Z' }).where(eq(schema.games.id, id)).run();
    steam.getReviewPlaytimes.mockResolvedValue([60, 60]);

    const body = await (await call(playtimeFetch, id, 'steam-playtime-fetch')).json();

    expect(body.data).toEqual({ steamPlaytimeMedian: 4, steamPlaytimeSampleSize: 30, refreshed: false });
    expect(readGame(id).steamPlaytimeMedian).toBe(4);
  });
});
