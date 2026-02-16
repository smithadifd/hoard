import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../hltb/client', () => ({
  getHLTBClient: vi.fn(),
}));

vi.mock('../db/queries', () => ({
  getGamesForHltbSync: vi.fn(),
  updateGameHltbData: vi.fn(),
  createSyncLog: vi.fn(),
  completeSyncLog: vi.fn(),
}));

import { syncHltb } from './hltb';
import { getHLTBClient } from '../hltb/client';
import {
  getGamesForHltbSync,
  updateGameHltbData,
  createSyncLog,
  completeSyncLog,
} from '../db/queries';

const mockGetHLTBClient = vi.mocked(getHLTBClient);
const mockGetGames = vi.mocked(getGamesForHltbSync);
const mockUpdateHltb = vi.mocked(updateGameHltbData);
const mockCreateSyncLog = vi.mocked(createSyncLog);
const mockCompleteSyncLog = vi.mocked(completeSyncLog);

function makeGame(id: number, title: string) {
  return { id, title, steamAppId: id * 100 };
}

function makeHltbResult(id: string, similarity: number, main = 10, extra = 15, completionist = 25) {
  return {
    id,
    name: 'Some Game',
    similarity,
    gameplayMain: main,
    gameplayMainExtra: extra,
    gameplayCompletionist: completionist,
  };
}

function makeMockHLTBClient(overrides: Record<string, unknown> = {}) {
  return {
    search: vi.fn().mockResolvedValue(null),
    ...overrides,
  } as unknown as ReturnType<typeof getHLTBClient>;
}

describe('syncHltb', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockCreateSyncLog.mockReturnValue(42);
    mockGetGames.mockReturnValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns early with message when no games need HLTB data', async () => {
    mockGetGames.mockReturnValue([]);

    const result = await syncHltb();

    expect(result.stats).toEqual({ attempted: 0, succeeded: 0, failed: 0, skipped: 0 });
    expect(result.message).toContain('All games already have HLTB data');
    expect(mockCompleteSyncLog).toHaveBeenCalledWith(42, 'success', 0, undefined, 0, 0);
  });

  it('updates game data when HLTB match has high similarity', async () => {
    const games = [makeGame(1, 'Portal 2')];
    mockGetGames.mockReturnValue(games);

    const mockClient = makeMockHLTBClient({
      search: vi.fn().mockResolvedValue(makeHltbResult('12345', 0.9, 8, 12, 20)),
    });
    mockGetHLTBClient.mockReturnValue(mockClient);

    const promise = syncHltb();
    await vi.advanceTimersByTimeAsync(2000);
    const result = await promise;

    expect(mockUpdateHltb).toHaveBeenCalledWith(1, {
      hltbId: 12345,
      hltbMain: 8,
      hltbMainExtra: 12,
      hltbCompletionist: 20,
    });
    expect(result.stats.succeeded).toBe(1);
    expect(result.stats.attempted).toBe(1);
  });

  it('marks game as checked (empty data) when similarity is below threshold', async () => {
    const games = [makeGame(1, 'Obscure Game')];
    mockGetGames.mockReturnValue(games);

    const mockClient = makeMockHLTBClient({
      search: vi.fn().mockResolvedValue(makeHltbResult('99', 0.3)),
    });
    mockGetHLTBClient.mockReturnValue(mockClient);

    const promise = syncHltb();
    await vi.advanceTimersByTimeAsync(2000);
    const result = await promise;

    expect(mockUpdateHltb).toHaveBeenCalledWith(1, {});
    expect(result.stats.skipped).toBe(1);
    expect(result.stats.succeeded).toBe(0);
  });

  it('marks game as checked when search returns null', async () => {
    const games = [makeGame(1, 'Unknown Game')];
    mockGetGames.mockReturnValue(games);

    const mockClient = makeMockHLTBClient({
      search: vi.fn().mockResolvedValue(null),
    });
    mockGetHLTBClient.mockReturnValue(mockClient);

    const promise = syncHltb();
    await vi.advanceTimersByTimeAsync(2000);
    const result = await promise;

    expect(mockUpdateHltb).toHaveBeenCalledWith(1, {});
    expect(result.stats.skipped).toBe(1);
  });

  it('counts per-game errors as failed, not crashed', async () => {
    const games = [makeGame(1, 'Erroring Game'), makeGame(2, 'Good Game')];
    mockGetGames.mockReturnValue(games);

    const mockClient = makeMockHLTBClient({
      search: vi.fn()
        .mockRejectedValueOnce(new Error('HLTB timeout'))
        .mockResolvedValueOnce(makeHltbResult('456', 0.8)),
    });
    mockGetHLTBClient.mockReturnValue(mockClient);

    const promise = syncHltb();
    await vi.advanceTimersByTimeAsync(5000);
    const result = await promise;

    expect(result.stats.failed).toBe(1);
    expect(result.stats.succeeded).toBe(1);
    expect(result.stats.attempted).toBe(2);
    expect(mockCompleteSyncLog).toHaveBeenCalledWith(42, 'success', 1, undefined, 2, 1);
  });

  it('limits batch to 100 games', async () => {
    const manyGames = Array.from({ length: 150 }, (_, i) => makeGame(i + 1, `Game ${i + 1}`));
    mockGetGames.mockReturnValue(manyGames);

    const searchFn = vi.fn().mockResolvedValue(null);
    mockGetHLTBClient.mockReturnValue(makeMockHLTBClient({ search: searchFn }));

    const promise = syncHltb();
    // Advance enough time for 100 games (100 * 1s rate limit + buffer)
    await vi.advanceTimersByTimeAsync(110_000);
    await promise;

    expect(searchFn).toHaveBeenCalledTimes(100);
  });

  it('stops when AbortSignal is triggered', async () => {
    const controller = new AbortController();
    const games = [makeGame(1, 'Game A'), makeGame(2, 'Game B'), makeGame(3, 'Game C')];
    mockGetGames.mockReturnValue(games);

    const searchFn = vi.fn().mockImplementation(async () => {
      controller.abort();
      return makeHltbResult('1', 0.9);
    });
    mockGetHLTBClient.mockReturnValue(makeMockHLTBClient({ search: searchFn }));

    const promise = syncHltb(undefined, controller.signal);
    await vi.advanceTimersByTimeAsync(5000);
    const result = await promise;

    // Should process first game then stop
    expect(result.stats.attempted).toBe(1);
    expect(result.stats.succeeded).toBe(1);
  });

  it('calls onProgress for each game with correct status', async () => {
    const games = [makeGame(1, 'Matched Game'), makeGame(2, 'Skipped Game')];
    mockGetGames.mockReturnValue(games);

    const mockClient = makeMockHLTBClient({
      search: vi.fn()
        .mockResolvedValueOnce(makeHltbResult('1', 0.9))
        .mockResolvedValueOnce(makeHltbResult('2', 0.2)),
    });
    mockGetHLTBClient.mockReturnValue(mockClient);

    const onProgress = vi.fn();
    const promise = syncHltb(onProgress);
    await vi.advanceTimersByTimeAsync(5000);
    await promise;

    // Each game gets 2 onProgress calls: one "processing" and one result status
    expect(onProgress).toHaveBeenCalledWith(0, 2, { gameName: 'Matched Game', status: 'processing' });
    expect(onProgress).toHaveBeenCalledWith(1, 2, { gameName: 'Matched Game', status: 'matched' });
    expect(onProgress).toHaveBeenCalledWith(1, 2, { gameName: 'Skipped Game', status: 'processing' });
    expect(onProgress).toHaveBeenCalledWith(2, 2, { gameName: 'Skipped Game', status: 'skipped' });
  });

  it('omits undefined hltbMain when gameplayMain is 0', async () => {
    const games = [makeGame(1, 'Multiplayer Only')];
    mockGetGames.mockReturnValue(games);

    mockGetHLTBClient.mockReturnValue(makeMockHLTBClient({
      search: vi.fn().mockResolvedValue(makeHltbResult('1', 0.9, 0, 0, 0)),
    }));

    const promise = syncHltb();
    await vi.advanceTimersByTimeAsync(2000);
    await promise;

    expect(mockUpdateHltb).toHaveBeenCalledWith(1, {
      hltbId: 1,
      hltbMain: undefined,
      hltbMainExtra: undefined,
      hltbCompletionist: undefined,
    });
  });

  it('propagates fatal errors and logs sync failure', async () => {
    mockGetGames.mockImplementation(() => { throw new Error('DB connection failed'); });

    await expect(syncHltb()).rejects.toThrow('DB connection failed');
    expect(mockCompleteSyncLog).toHaveBeenCalledWith(42, 'error', 0, 'DB connection failed');
  });
});
