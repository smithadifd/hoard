import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config', () => ({
  getEffectiveConfig: vi.fn(),
}));

vi.mock('../discord/client', () => ({
  getDiscordClient: vi.fn(),
}));

vi.mock('../db/queries', () => ({
  getActivePriceAlerts: vi.fn(),
  updateAlertLastNotified: vi.fn(),
  getAutoAlertCandidates: vi.fn(),
  updateAutoAlertLastNotified: vi.fn(),
  getSetting: vi.fn(),
  createSyncLog: vi.fn(),
  completeSyncLog: vi.fn(),
  getFirstUserId: vi.fn(),
}));

import { checkPriceAlerts } from './alerts';
import { getEffectiveConfig } from '../config';
import { getDiscordClient } from '../discord/client';
import {
  getActivePriceAlerts,
  updateAlertLastNotified,
  getAutoAlertCandidates,
  updateAutoAlertLastNotified,
  getSetting,
  createSyncLog,
  completeSyncLog,
  getFirstUserId,
} from '../db/queries';

const mockGetConfig = vi.mocked(getEffectiveConfig);
const mockGetDiscordClient = vi.mocked(getDiscordClient);
const mockGetAlerts = vi.mocked(getActivePriceAlerts);
const mockUpdateNotified = vi.mocked(updateAlertLastNotified);
const mockCreateSyncLog = vi.mocked(createSyncLog);
const mockCompleteSyncLog = vi.mocked(completeSyncLog);
const mockGetFirstUserId = vi.mocked(getFirstUserId);
const mockGetAutoAlertCandidates = vi.mocked(getAutoAlertCandidates);
const mockGetSetting = vi.mocked(getSetting);

function makeAlert(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    title: 'Test Game',
    steamAppId: 440,
    headerImageUrl: 'https://cdn.steam/440/header.jpg',
    currentPrice: 9.99,
    regularPrice: 19.99,
    historicalLowPrice: 4.99,
    discountPercent: 50,
    store: 'Steam',
    storeUrl: 'https://store.steam/app/440',
    reviewDescription: 'Very Positive',
    hltbMain: 10,
    targetPrice: 10.00,
    notifyOnThreshold: true,
    notifyOnAllTimeLow: true,
    isHistoricalLow: false,
    lastNotifiedAt: null as string | null,
    ...overrides,
  };
}

function makeMockDiscord(overrides: Record<string, unknown> = {}) {
  return {
    sendPriceAlert: vi.fn().mockResolvedValue(true),
    ...overrides,
  } as unknown as ReturnType<typeof getDiscordClient>;
}

describe('checkPriceAlerts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateSyncLog.mockReturnValue(42);
    mockGetFirstUserId.mockReturnValue('user-1');
    mockGetConfig.mockReturnValue({
      alertThrottleHours: 24,
    } as ReturnType<typeof getEffectiveConfig>);
    mockGetAlerts.mockReturnValue([]);
    mockGetAutoAlertCandidates.mockReturnValue([]);
    mockGetSetting.mockReturnValue(null);
  });

  it('returns early with zero stats when no active alerts exist', async () => {
    mockGetAlerts.mockReturnValue([]);

    const result = await checkPriceAlerts();

    expect(result.stats).toEqual({ attempted: 0, succeeded: 0, failed: 0, skipped: 0 });
    expect(mockCompleteSyncLog).toHaveBeenCalledWith(42, 'success', 0, undefined, 0, 0);
  });

  it('sends notification when price is at or below target', async () => {
    const alert = makeAlert({ currentPrice: 9.99, targetPrice: 10.00 });
    mockGetAlerts.mockReturnValue([alert]);
    const mockDiscord = makeMockDiscord();
    mockGetDiscordClient.mockReturnValue(mockDiscord);

    const result = await checkPriceAlerts();

    expect(mockDiscord.sendPriceAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Test Game',
        currentPrice: 9.99,
        regularPrice: 19.99,
      })
    );
    expect(mockUpdateNotified).toHaveBeenCalledWith(1);
    expect(result.stats.succeeded).toBe(1);
  });

  it('sends notification for free games (price = 0)', async () => {
    const alert = makeAlert({
      currentPrice: 0,
      notifyOnThreshold: false,
      notifyOnAllTimeLow: false,
    });
    mockGetAlerts.mockReturnValue([alert]);
    const mockDiscord = makeMockDiscord();
    mockGetDiscordClient.mockReturnValue(mockDiscord);

    const result = await checkPriceAlerts();

    expect(mockDiscord.sendPriceAlert).toHaveBeenCalled();
    expect(result.stats.succeeded).toBe(1);
  });

  it('sends notification when price is at all-time low', async () => {
    const alert = makeAlert({
      currentPrice: 15.00,
      targetPrice: 5.00,
      notifyOnThreshold: false,
      notifyOnAllTimeLow: true,
      isHistoricalLow: true,
    });
    mockGetAlerts.mockReturnValue([alert]);
    const mockDiscord = makeMockDiscord();
    mockGetDiscordClient.mockReturnValue(mockDiscord);

    const result = await checkPriceAlerts();

    expect(mockDiscord.sendPriceAlert).toHaveBeenCalled();
    expect(result.stats.succeeded).toBe(1);
  });

  it('does not notify when price is above target and not at ATL', async () => {
    const alert = makeAlert({
      currentPrice: 15.00,
      targetPrice: 10.00,
      isHistoricalLow: false,
    });
    mockGetAlerts.mockReturnValue([alert]);
    const mockDiscord = makeMockDiscord();
    mockGetDiscordClient.mockReturnValue(mockDiscord);

    const result = await checkPriceAlerts();

    expect(mockDiscord.sendPriceAlert).not.toHaveBeenCalled();
    expect(result.stats.succeeded).toBe(0);
  });

  it('throttles notifications within the configured period', async () => {
    const recentlyNotified = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(); // 1h ago
    const alert = makeAlert({
      currentPrice: 5.00,
      targetPrice: 10.00,
      lastNotifiedAt: recentlyNotified,
    });
    mockGetAlerts.mockReturnValue([alert]);
    mockGetConfig.mockReturnValue({
      alertThrottleHours: 24,
    } as ReturnType<typeof getEffectiveConfig>);
    const mockDiscord = makeMockDiscord();
    mockGetDiscordClient.mockReturnValue(mockDiscord);

    const result = await checkPriceAlerts();

    expect(mockDiscord.sendPriceAlert).not.toHaveBeenCalled();
    expect(result.stats.skipped).toBe(1);
  });

  it('allows notification when throttle period has expired', async () => {
    const oldNotification = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(); // 48h ago
    const alert = makeAlert({
      currentPrice: 5.00,
      targetPrice: 10.00,
      lastNotifiedAt: oldNotification,
    });
    mockGetAlerts.mockReturnValue([alert]);
    const mockDiscord = makeMockDiscord();
    mockGetDiscordClient.mockReturnValue(mockDiscord);

    const result = await checkPriceAlerts();

    expect(mockDiscord.sendPriceAlert).toHaveBeenCalled();
    expect(result.stats.succeeded).toBe(1);
  });

  it('does not update lastNotified when Discord send fails', async () => {
    const alert = makeAlert({ currentPrice: 5.00, targetPrice: 10.00 });
    mockGetAlerts.mockReturnValue([alert]);
    const mockDiscord = makeMockDiscord({
      sendPriceAlert: vi.fn().mockResolvedValue(false),
    });
    mockGetDiscordClient.mockReturnValue(mockDiscord);

    const result = await checkPriceAlerts();

    expect(mockUpdateNotified).not.toHaveBeenCalled();
    expect(result.stats.succeeded).toBe(0);
  });

  it('computes $/hr when hltbMain is available', async () => {
    const alert = makeAlert({
      currentPrice: 10.00,
      targetPrice: 15.00,
      hltbMain: 5,
    });
    mockGetAlerts.mockReturnValue([alert]);
    const mockDiscord = makeMockDiscord();
    mockGetDiscordClient.mockReturnValue(mockDiscord);

    await checkPriceAlerts();

    expect(mockDiscord.sendPriceAlert).toHaveBeenCalledWith(
      expect.objectContaining({ dollarsPerHour: 2 })
    );
  });

  it('omits $/hr when hltbMain is null', async () => {
    const alert = makeAlert({
      currentPrice: 10.00,
      targetPrice: 15.00,
      hltbMain: null,
    });
    mockGetAlerts.mockReturnValue([alert]);
    const mockDiscord = makeMockDiscord();
    mockGetDiscordClient.mockReturnValue(mockDiscord);

    await checkPriceAlerts();

    expect(mockDiscord.sendPriceAlert).toHaveBeenCalledWith(
      expect.objectContaining({ dollarsPerHour: undefined })
    );
  });

  it('omits $/hr when hltbMain is 0', async () => {
    const alert = makeAlert({
      currentPrice: 10.00,
      targetPrice: 15.00,
      hltbMain: 0,
    });
    mockGetAlerts.mockReturnValue([alert]);
    const mockDiscord = makeMockDiscord();
    mockGetDiscordClient.mockReturnValue(mockDiscord);

    await checkPriceAlerts();

    expect(mockDiscord.sendPriceAlert).toHaveBeenCalledWith(
      expect.objectContaining({ dollarsPerHour: undefined })
    );
  });

  it('processes multiple alerts independently', async () => {
    const alerts = [
      makeAlert({ id: 1, title: 'Game A', currentPrice: 5.00, targetPrice: 10.00 }),
      makeAlert({ id: 2, title: 'Game B', currentPrice: 30.00, targetPrice: 10.00, isHistoricalLow: false }),
      makeAlert({ id: 3, title: 'Game C', currentPrice: 0, notifyOnThreshold: false, notifyOnAllTimeLow: false }),
    ];
    mockGetAlerts.mockReturnValue(alerts);
    const mockDiscord = makeMockDiscord();
    mockGetDiscordClient.mockReturnValue(mockDiscord);

    const result = await checkPriceAlerts();

    // Game A (below target) and Game C (free) should notify; Game B should not
    expect(mockDiscord.sendPriceAlert).toHaveBeenCalledTimes(2);
    expect(result.stats.succeeded).toBe(2);
    expect(result.stats.attempted).toBe(3);
  });

  it('uses provided userId instead of getFirstUserId', async () => {
    mockGetAlerts.mockReturnValue([]);

    await checkPriceAlerts(undefined, 'custom-user');

    expect(mockGetAlerts).toHaveBeenCalledWith('custom-user');
    expect(mockGetFirstUserId).not.toHaveBeenCalled();
  });

  it('calls onProgress during processing', async () => {
    const alerts = [
      makeAlert({ id: 1, currentPrice: 5.00, targetPrice: 10.00 }),
      makeAlert({ id: 2, currentPrice: 5.00, targetPrice: 10.00 }),
    ];
    mockGetAlerts.mockReturnValue(alerts);
    const mockDiscord = makeMockDiscord();
    mockGetDiscordClient.mockReturnValue(mockDiscord);

    const onProgress = vi.fn();
    await checkPriceAlerts(onProgress);

    expect(onProgress).toHaveBeenCalledWith(0, 2);
  });

  it('uses Steam store URL as fallback when storeUrl is null', async () => {
    const alert = makeAlert({
      currentPrice: 5.00,
      targetPrice: 10.00,
      storeUrl: null,
      steamAppId: 440,
    });
    mockGetAlerts.mockReturnValue([alert]);
    const mockDiscord = makeMockDiscord();
    mockGetDiscordClient.mockReturnValue(mockDiscord);

    await checkPriceAlerts();

    expect(mockDiscord.sendPriceAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        storeUrl: 'https://store.steampowered.com/app/440',
      })
    );
  });

  it('propagates errors and logs sync failure', async () => {
    mockGetAlerts.mockImplementation(() => { throw new Error('DB read failed'); });

    await expect(checkPriceAlerts()).rejects.toThrow('DB read failed');
    expect(mockCompleteSyncLog).toHaveBeenCalledWith(42, 'error', 0, 'DB read failed');
  });

  it('does not notify when notifyOnThreshold is false and price is below target', async () => {
    const alert = makeAlert({
      currentPrice: 5.00,
      targetPrice: 10.00,
      notifyOnThreshold: false,
      notifyOnAllTimeLow: false,
      isHistoricalLow: false,
    });
    mockGetAlerts.mockReturnValue([alert]);
    const mockDiscord = makeMockDiscord();
    mockGetDiscordClient.mockReturnValue(mockDiscord);

    const result = await checkPriceAlerts();

    expect(mockDiscord.sendPriceAlert).not.toHaveBeenCalled();
    expect(result.stats.succeeded).toBe(0);
  });
});
