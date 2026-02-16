import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock external dependencies before importing the module under test
vi.mock('../steam/client', () => ({
  getSteamClient: vi.fn(),
}));

vi.mock('../db/queries', () => ({
  upsertGameFromSteam: vi.fn(),
  upsertUserGame: vi.fn(),
  createSyncLog: vi.fn(),
  completeSyncLog: vi.fn(),
  getFirstUserId: vi.fn(),
}));

import { syncLibrary } from './library';
import { getSteamClient } from '../steam/client';
import {
  upsertGameFromSteam,
  upsertUserGame,
  createSyncLog,
  completeSyncLog,
  getFirstUserId,
} from '../db/queries';

const mockGetSteamClient = vi.mocked(getSteamClient);
const mockUpsertGame = vi.mocked(upsertGameFromSteam);
const mockUpsertUserGame = vi.mocked(upsertUserGame);
const mockCreateSyncLog = vi.mocked(createSyncLog);
const mockCompleteSyncLog = vi.mocked(completeSyncLog);
const mockGetFirstUserId = vi.mocked(getFirstUserId);

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
    expect(mockCompleteSyncLog).toHaveBeenCalledWith(42, 'success', 2, undefined, 2, 0);
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
    expect(mockCompleteSyncLog).toHaveBeenCalledWith(42, 'success', 1, undefined, 3, 0);
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
    expect(mockCompleteSyncLog).toHaveBeenCalledWith(42, 'error', 0, 'API key is invalid');
  });

  it('handles non-Error exceptions in catch block', async () => {
    mockGetSteamClient.mockReturnValue({
      getOwnedGames: vi.fn().mockRejectedValue('string error'),
    } as ReturnType<typeof getSteamClient>);

    await expect(syncLibrary()).rejects.toBe('string error');
    expect(mockCompleteSyncLog).toHaveBeenCalledWith(42, 'error', 0, 'Unknown error');
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
});
