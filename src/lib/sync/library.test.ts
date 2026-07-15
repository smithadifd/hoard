import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock external dependencies before importing the module under test
vi.mock('../steam/client', () => ({
  getSteamClient: vi.fn(),
  getAndResetSteamApiCalls: vi.fn().mockReturnValue(0),
}));

vi.mock('../db/queries', () => ({
  upsertGameFromSteam: vi.fn(),
  upsertUserGame: vi.fn(),
  insertPlaytimeSnapshot: vi.fn(),
  createSyncLog: vi.fn(),
  completeSyncLog: vi.fn(),
  getFirstUserId: vi.fn(),
  getExistingGamesByAppIds: vi.fn(),
  getPreOwnershipState: vi.fn(),
  cascadePurchaseCleanup: vi.fn(),
  capturePricePaidSuggestions: vi.fn(),
  countOwnedGames: vi.fn(),
  getSetting: vi.fn(),
}));

vi.mock('../notifications/dispatch', () => ({
  emitNotification: vi.fn(),
}));

vi.mock('./net-new-prices', () => ({
  fetchNetNewPrices: vi.fn(),
}));

import { syncLibrary } from './library';
import { getSteamClient } from '../steam/client';
import {
  upsertGameFromSteam,
  upsertUserGame,
  insertPlaytimeSnapshot,
  createSyncLog,
  completeSyncLog,
  getFirstUserId,
  getExistingGamesByAppIds,
  getPreOwnershipState,
  cascadePurchaseCleanup,
  capturePricePaidSuggestions,
  countOwnedGames,
  getSetting,
} from '../db/queries';
import { emitNotification } from '../notifications/dispatch';
import { fetchNetNewPrices } from './net-new-prices';

const mockGetSteamClient = vi.mocked(getSteamClient);
const mockUpsertGame = vi.mocked(upsertGameFromSteam);
const mockUpsertUserGame = vi.mocked(upsertUserGame);
const mockInsertSnapshot = vi.mocked(insertPlaytimeSnapshot);
const mockCreateSyncLog = vi.mocked(createSyncLog);
const mockCompleteSyncLog = vi.mocked(completeSyncLog);
const mockGetFirstUserId = vi.mocked(getFirstUserId);
const mockGetExisting = vi.mocked(getExistingGamesByAppIds);
const mockGetPreOwnership = vi.mocked(getPreOwnershipState);
const mockCascadePurchase = vi.mocked(cascadePurchaseCleanup);
const mockCapture = vi.mocked(capturePricePaidSuggestions);
const mockCountOwned = vi.mocked(countOwnedGames);
const mockGetSetting = vi.mocked(getSetting);
const mockEmit = vi.mocked(emitNotification);
const mockFetchNetNew = vi.mocked(fetchNetNewPrices);

function makeSteamGame(appid: number, name: string, playtime = 0, recentPlaytime?: number, lastPlayed?: number) {
  return {
    appid,
    name,
    playtime_forever: playtime,
    playtime_2weeks: recentPlaytime,
    rtime_last_played: lastPlayed ?? 0,
    img_icon_url: '',
  };
}

describe('syncLibrary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateSyncLog.mockReturnValue(42);
    mockGetFirstUserId.mockReturnValue('user-1');
    mockUpsertGame.mockReturnValue(1);
    mockGetExisting.mockReturnValue(new Map());
    mockGetPreOwnership.mockReturnValue([]);
    mockCapture.mockReturnValue([]);
    // Default: library already has owned games (past the initial import), so the
    // net-new price-fetch lane is eligible. Tests that assert first-import behavior
    // override this to 0.
    mockCountOwned.mockReturnValue(5);
    mockFetchNetNew.mockResolvedValue({ snapshotted: 0 });
    mockGetSetting.mockReturnValue(null); // null → suggestions enabled (!== 'false')
    mockEmit.mockResolvedValue({ inAppDelivered: false, discordDelivered: false });
  });

  it('syncs all games from Steam into the database', async () => {
    const games = [
      makeSteamGame(440, 'Team Fortress 2', 1000),
      makeSteamGame(570, 'Dota 2', 500),
    ];

    mockGetSteamClient.mockReturnValue({
      getOwnedGames: vi.fn().mockResolvedValue({ game_count: 2, games }),
    } as ReturnType<typeof getSteamClient>);
    mockUpsertGame.mockReturnValueOnce(10).mockReturnValueOnce(20);

    const result = await syncLibrary();

    expect(mockCreateSyncLog).toHaveBeenCalledWith('steam_library');
    expect(mockUpsertGame).toHaveBeenCalledTimes(2);
    expect(mockUpsertGame).toHaveBeenCalledWith(
      expect.objectContaining({ steamAppId: 440, title: 'Team Fortress 2' })
    );
    expect(mockUpsertUserGame).toHaveBeenCalledTimes(2);
    expect(mockUpsertUserGame).toHaveBeenCalledWith(
      10,
      expect.objectContaining({ isOwned: true, playtimeMinutes: 1000 }),
      'user-1'
    );
    expect(mockCompleteSyncLog).toHaveBeenCalledWith(42, 'success', 2, undefined, 2, 0, 0);
    expect(result.stats).toEqual({ attempted: 2, succeeded: 2, failed: 0, skipped: 0 });
    expect(result.syncLogId).toBe(42);
  });

  it('uses provided userId instead of getFirstUserId', async () => {
    mockGetSteamClient.mockReturnValue({
      getOwnedGames: vi.fn().mockResolvedValue({
        game_count: 1,
        games: [makeSteamGame(440, 'TF2', 100)],
      }),
    } as ReturnType<typeof getSteamClient>);

    await syncLibrary(undefined, undefined, 'custom-user');

    expect(mockUpsertUserGame).toHaveBeenCalledWith(1, expect.anything(), 'custom-user');
    expect(mockGetFirstUserId).not.toHaveBeenCalled();
  });

  it('calls onProgress for each game processed', async () => {
    const games = [
      makeSteamGame(1, 'Game A'),
      makeSteamGame(2, 'Game B'),
      makeSteamGame(3, 'Game C'),
    ];
    mockGetSteamClient.mockReturnValue({
      getOwnedGames: vi.fn().mockResolvedValue({ game_count: 3, games }),
    } as ReturnType<typeof getSteamClient>);

    const onProgress = vi.fn();
    await syncLibrary(onProgress);

    expect(onProgress).toHaveBeenCalledTimes(3);
    expect(onProgress).toHaveBeenCalledWith(1, 3, { gameName: 'Game A' });
    expect(onProgress).toHaveBeenCalledWith(2, 3, { gameName: 'Game B' });
    expect(onProgress).toHaveBeenCalledWith(3, 3, { gameName: 'Game C' });
  });

  it('stops early when AbortSignal is triggered', async () => {
    const controller = new AbortController();
    const games = [
      makeSteamGame(1, 'Game A'),
      makeSteamGame(2, 'Game B'),
      makeSteamGame(3, 'Game C'),
    ];
    mockGetSteamClient.mockReturnValue({
      getOwnedGames: vi.fn().mockResolvedValue({ game_count: 3, games }),
    } as ReturnType<typeof getSteamClient>);

    // Abort after the first game is processed
    mockUpsertGame.mockImplementation(() => {
      controller.abort();
      return 1;
    });

    const result = await syncLibrary(undefined, controller.signal);

    // Should only process the first game (abort checked at top of loop iteration 2)
    expect(result.stats.succeeded).toBe(1);
    expect(mockCompleteSyncLog).toHaveBeenCalledWith(42, 'success', 1, undefined, 3, 0, 0);
  });

  it('records lastPlayed when rtime_last_played > 0', async () => {
    const games = [makeSteamGame(440, 'TF2', 100, 10, 1700000000)];
    mockGetSteamClient.mockReturnValue({
      getOwnedGames: vi.fn().mockResolvedValue({ game_count: 1, games }),
    } as ReturnType<typeof getSteamClient>);

    await syncLibrary();

    expect(mockUpsertUserGame).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        lastPlayed: new Date(1700000000 * 1000).toISOString(),
      }),
      'user-1'
    );
  });

  it('sets lastPlayed to undefined when rtime_last_played is 0', async () => {
    const games = [makeSteamGame(440, 'TF2', 100, 10, 0)];
    mockGetSteamClient.mockReturnValue({
      getOwnedGames: vi.fn().mockResolvedValue({ game_count: 1, games }),
    } as ReturnType<typeof getSteamClient>);

    await syncLibrary();

    expect(mockUpsertUserGame).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ lastPlayed: undefined }),
      'user-1'
    );
  });

  it('propagates Steam API errors and logs sync failure', async () => {
    mockGetSteamClient.mockReturnValue({
      getOwnedGames: vi.fn().mockRejectedValue(new Error('API key is invalid')),
    } as ReturnType<typeof getSteamClient>);

    await expect(syncLibrary()).rejects.toThrow('API key is invalid');
    expect(mockCompleteSyncLog).toHaveBeenCalledWith(42, 'error', 0, 'API key is invalid', undefined, undefined, 0);
  });

  it('handles non-Error exceptions in catch block', async () => {
    mockGetSteamClient.mockReturnValue({
      getOwnedGames: vi.fn().mockRejectedValue('string error'),
    } as ReturnType<typeof getSteamClient>);

    await expect(syncLibrary()).rejects.toBe('string error');
    expect(mockCompleteSyncLog).toHaveBeenCalledWith(42, 'error', 0, 'Unknown error', undefined, undefined, 0);
  });

  it('cascades alerts + wishlist cleanup when a wishlisted game appears in the library', async () => {
    const games = [
      makeSteamGame(440, 'TF2', 100), // newly purchased: was wishlisted, now owned
      makeSteamGame(570, 'Dota 2', 50), // already owned previously
    ];
    mockGetSteamClient.mockReturnValue({
      getOwnedGames: vi.fn().mockResolvedValue({ game_count: 2, games }),
    } as ReturnType<typeof getSteamClient>);
    mockUpsertGame.mockReturnValueOnce(10).mockReturnValueOnce(20);
    mockGetExisting.mockReturnValue(new Map([
      [440, { id: 10, title: 'TF2' }],
      [570, { id: 20, title: 'Dota 2' }],
    ]));
    mockGetPreOwnership.mockReturnValue([
      { gameId: 10, wasOwned: false, wasWishlisted: true },
      { gameId: 20, wasOwned: true, wasWishlisted: false },
    ]);

    await syncLibrary();

    expect(mockCascadePurchase).toHaveBeenCalledTimes(1);
    expect(mockCascadePurchase).toHaveBeenCalledWith([10], 'user-1');
  });

  it('does not cascade when no wishlist→owned transitions occur', async () => {
    const games = [makeSteamGame(570, 'Dota 2', 50)];
    mockGetSteamClient.mockReturnValue({
      getOwnedGames: vi.fn().mockResolvedValue({ game_count: 1, games }),
    } as ReturnType<typeof getSteamClient>);
    mockUpsertGame.mockReturnValue(20);
    mockGetExisting.mockReturnValue(new Map([[570, { id: 20, title: 'Dota 2' }]]));
    mockGetPreOwnership.mockReturnValue([
      { gameId: 20, wasOwned: true, wasWishlisted: false },
    ]);

    await syncLibrary();

    expect(mockCascadePurchase).not.toHaveBeenCalled();
  });

  it('collapses N price-paid captures from one sync into a single digest notification', async () => {
    const games = [makeSteamGame(440, 'TF2', 100), makeSteamGame(570, 'Dota 2', 50)];
    mockGetSteamClient.mockReturnValue({
      getOwnedGames: vi.fn().mockResolvedValue({ game_count: 2, games }),
    } as ReturnType<typeof getSteamClient>);
    mockUpsertGame.mockReturnValueOnce(10).mockReturnValueOnce(20);
    mockGetExisting.mockReturnValue(new Map([
      [440, { id: 10, title: 'TF2' }],
      [570, { id: 20, title: 'Dota 2' }],
    ]));
    mockGetPreOwnership.mockReturnValue([
      { gameId: 10, wasOwned: false, wasWishlisted: true },
      { gameId: 20, wasOwned: false, wasWishlisted: true },
    ]);
    mockCapture.mockReturnValue([
      { gameId: 10, title: 'TF2', suggested: 4.99, asOf: '2026-06-01' },
      { gameId: 20, title: 'Dota 2', suggested: 9.99, asOf: '2026-06-02' },
    ]);

    await syncLibrary();

    // One fan-out for the whole batch — not one per game.
    expect(mockEmit).toHaveBeenCalledTimes(1);
    const event = mockEmit.mock.calls[0][0];
    expect(event.category).toBe('price-paid-suggestion');
    expect(event.inApp?.title).toContain('2 games');
    expect(event.inApp?.metadata).toMatchObject({ count: 2 });
    expect((event.inApp?.metadata as { games: unknown[] }).games).toHaveLength(2);
  });

  it('renders a single price-paid capture naturally (not "1 game")', async () => {
    const games = [makeSteamGame(440, 'TF2', 100)];
    mockGetSteamClient.mockReturnValue({
      getOwnedGames: vi.fn().mockResolvedValue({ game_count: 1, games }),
    } as ReturnType<typeof getSteamClient>);
    mockUpsertGame.mockReturnValue(10);
    mockGetExisting.mockReturnValue(new Map([[440, { id: 10, title: 'TF2' }]]));
    mockGetPreOwnership.mockReturnValue([
      { gameId: 10, wasOwned: false, wasWishlisted: true },
    ]);
    mockCapture.mockReturnValue([
      { gameId: 10, title: 'TF2', suggested: 4.99, asOf: '2026-06-01' },
    ]);

    await syncLibrary();

    expect(mockEmit).toHaveBeenCalledTimes(1);
    const event = mockEmit.mock.calls[0][0];
    expect(event.inApp?.title).toBe('Confirm what you paid for TF2');
    expect(event.inApp?.title).not.toContain('1 game');
    expect(event.inApp?.link).toBe('/games/10');
  });

  it('does not notify when no price-paid suggestions are captured', async () => {
    const games = [makeSteamGame(570, 'Dota 2', 50)];
    mockGetSteamClient.mockReturnValue({
      getOwnedGames: vi.fn().mockResolvedValue({ game_count: 1, games }),
    } as ReturnType<typeof getSteamClient>);
    mockUpsertGame.mockReturnValue(20);
    mockGetExisting.mockReturnValue(new Map([[570, { id: 20, title: 'Dota 2' }]]));
    mockGetPreOwnership.mockReturnValue([
      { gameId: 20, wasOwned: false, wasWishlisted: true },
    ]);
    mockCapture.mockReturnValue([]);

    await syncLibrary();

    expect(mockEmit).not.toHaveBeenCalled();
  });

  it('fetches ITAD prices for a net-new owned add that was never wishlisted, then captures a suggestion', async () => {
    // A brand-new game (not in `existing`, no prior row) added straight as owned.
    const games = [makeSteamGame(999, 'New Purchase', 120)];
    mockGetSteamClient.mockReturnValue({
      getOwnedGames: vi.fn().mockResolvedValue({ game_count: 1, games }),
    } as ReturnType<typeof getSteamClient>);
    mockUpsertGame.mockReturnValue(77);
    mockGetExisting.mockReturnValue(new Map()); // never seen before
    mockGetPreOwnership.mockReturnValue([]); // no prior row
    mockFetchNetNew.mockResolvedValue({ snapshotted: 1 });
    mockCapture.mockReturnValue([
      { gameId: 77, title: 'New Purchase', suggested: 19.99, asOf: '2026-07-01' },
    ]);

    await syncLibrary();

    // Net-new lane fetched a price for the new owned add...
    expect(mockFetchNetNew).toHaveBeenCalledWith([77]);
    // ...then captured a suggestion off the fresh snapshot...
    expect(mockCapture).toHaveBeenCalledWith([77], 'user-1');
    // ...and surfaced the nudge.
    expect(mockEmit).toHaveBeenCalledTimes(1);
    expect(mockEmit.mock.calls[0][0].inApp?.title).toBe('Confirm what you paid for New Purchase');
  });

  it('does NOT fetch net-new prices on the first library import (no prior owned games)', async () => {
    mockCountOwned.mockReturnValue(0); // initial import — drain owns this
    const games = [makeSteamGame(999, 'New Purchase', 120)];
    mockGetSteamClient.mockReturnValue({
      getOwnedGames: vi.fn().mockResolvedValue({ game_count: 1, games }),
    } as ReturnType<typeof getSteamClient>);
    mockUpsertGame.mockReturnValue(77);
    mockGetExisting.mockReturnValue(new Map());
    mockGetPreOwnership.mockReturnValue([]);

    await syncLibrary();

    expect(mockFetchNetNew).not.toHaveBeenCalled();
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it('does NOT run the net-new lane for a game that was previously wishlisted', async () => {
    // Wishlisted-then-owned goes through the existing purchase lane, not net-new.
    const games = [makeSteamGame(440, 'TF2', 100)];
    mockGetSteamClient.mockReturnValue({
      getOwnedGames: vi.fn().mockResolvedValue({ game_count: 1, games }),
    } as ReturnType<typeof getSteamClient>);
    mockUpsertGame.mockReturnValue(10);
    mockGetExisting.mockReturnValue(new Map([[440, { id: 10, title: 'TF2' }]]));
    mockGetPreOwnership.mockReturnValue([
      { gameId: 10, wasOwned: false, wasWishlisted: true },
    ]);

    await syncLibrary();

    expect(mockFetchNetNew).not.toHaveBeenCalled();
  });

  it('skips the net-new capture when the ITAD fetch yields no snapshot (honest boundary)', async () => {
    const games = [makeSteamGame(999, 'Obscure Game', 30)];
    mockGetSteamClient.mockReturnValue({
      getOwnedGames: vi.fn().mockResolvedValue({ game_count: 1, games }),
    } as ReturnType<typeof getSteamClient>);
    mockUpsertGame.mockReturnValue(88);
    mockGetExisting.mockReturnValue(new Map());
    mockGetPreOwnership.mockReturnValue([]);
    mockFetchNetNew.mockResolvedValue({ snapshotted: 0 }); // no price found

    await syncLibrary();

    expect(mockFetchNetNew).toHaveBeenCalledWith([88]);
    // No snapshot → no capture → no nudge (never fabricate a number).
    expect(mockCapture).not.toHaveBeenCalled();
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it('does not run the net-new lane when suggestions are disabled', async () => {
    mockGetSetting.mockReturnValue('false'); // master opt-out
    const games = [makeSteamGame(999, 'New Purchase', 120)];
    mockGetSteamClient.mockReturnValue({
      getOwnedGames: vi.fn().mockResolvedValue({ game_count: 1, games }),
    } as ReturnType<typeof getSteamClient>);
    mockUpsertGame.mockReturnValue(77);
    mockGetExisting.mockReturnValue(new Map());
    mockGetPreOwnership.mockReturnValue([]);

    await syncLibrary();

    expect(mockFetchNetNew).not.toHaveBeenCalled();
  });

  it('sets playtimeRecentMinutes to 0 when playtime_2weeks is undefined', async () => {
    const games = [makeSteamGame(440, 'TF2', 100, undefined)];
    mockGetSteamClient.mockReturnValue({
      getOwnedGames: vi.fn().mockResolvedValue({ game_count: 1, games }),
    } as ReturnType<typeof getSteamClient>);

    await syncLibrary();

    expect(mockUpsertUserGame).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ playtimeRecentMinutes: 0 }),
      'user-1'
    );
  });

  describe('playtime snapshots (time-series preservation)', () => {
    function twoOwnedGames() {
      const games = [
        makeSteamGame(440, 'TF2', 100, 10, 1700000000),
        makeSteamGame(570, 'Dota 2', 200, 0, 0),
      ];
      mockGetSteamClient.mockReturnValue({
        getOwnedGames: vi.fn().mockResolvedValue({ game_count: 2, games }),
      } as ReturnType<typeof getSteamClient>);
      mockUpsertGame.mockReturnValueOnce(10).mockReturnValueOnce(20);
      mockGetExisting.mockReturnValue(new Map([
        [440, { id: 10, title: 'TF2' }],
        [570, { id: 20, title: 'Dota 2' }],
      ]));
      mockGetPreOwnership.mockReturnValue([
        { gameId: 10, wasOwned: true, wasWishlisted: false },
        { gameId: 20, wasOwned: true, wasWishlisted: false },
      ]);
    }

    it('writes one snapshot per game with the incoming Steam totals', async () => {
      twoOwnedGames();

      await syncLibrary();

      expect(mockInsertSnapshot).toHaveBeenCalledTimes(2);
      expect(mockInsertSnapshot).toHaveBeenNthCalledWith(1, {
        gameId: 10,
        userId: 'user-1',
        playtimeMinutes: 100,
        recentMinutes: 10,
        lastPlayed: new Date(1700000000 * 1000).toISOString(),
      });
      expect(mockInsertSnapshot).toHaveBeenNthCalledWith(2, {
        gameId: 20,
        userId: 'user-1',
        playtimeMinutes: 200,
        recentMinutes: 0,
        lastPlayed: undefined, // never played → no lastPlayed
      });
    });

    it('snapshots BEFORE overwriting user_games for every game (history preserved)', async () => {
      twoOwnedGames();

      await syncLibrary();

      const snapshotOrder = mockInsertSnapshot.mock.invocationCallOrder;
      const overwriteOrder = mockUpsertUserGame.mock.invocationCallOrder;
      expect(snapshotOrder).toHaveLength(2);
      expect(overwriteOrder).toHaveLength(2);

      // Per game, the snapshot is captured before the upsert that overwrites it —
      // this is what stops the sync from destroying the prior total.
      expect(snapshotOrder[0]).toBeLessThan(overwriteOrder[0]);
      expect(snapshotOrder[1]).toBeLessThan(overwriteOrder[1]);

      // And the snapshot records exactly the total the upsert then writes.
      expect(mockInsertSnapshot.mock.calls[0][0].playtimeMinutes).toBe(
        mockUpsertUserGame.mock.calls[0][1].playtimeMinutes,
      );
    });
  });
});
