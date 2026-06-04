import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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
  setSetting: vi.fn(),
  createSyncLog: vi.fn(),
  completeSyncLog: vi.fn(),
  getFirstUserId: vi.fn(),
}));

import { checkPriceAlerts, isNewAtl, alreadyNotifiedForSnapshot, shouldSendDigest, localDateKey } from './alerts';
import { getEffectiveConfig } from '../config';
import { getDiscordClient } from '../discord/client';
import {
  getActivePriceAlerts,
  updateAlertLastNotified,
  getAutoAlertCandidates,
  updateAutoAlertLastNotified,
  getSetting,
  setSetting,
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
const mockSetSetting = vi.mocked(setSetting);
const _mockUpdateAutoNotified = vi.mocked(updateAutoAlertLastNotified);

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
    prevHistoricalLowPrice: null as number | null,
    // Default to plenty of history so existing tests bypass the min-snapshot gate
    snapshotCount: 10,
    // Default null = "unknown snapshot age", which never suppresses the new-ATL bypass.
    latestSnapshotAt: null as string | null,
    ...overrides,
  };
}

function makeMockDiscord(overrides: Record<string, unknown> = {}) {
  return {
    sendPriceAlert: vi.fn().mockResolvedValue(true),
    sendAtlDigest: vi.fn().mockResolvedValue(true),
    ...overrides,
  } as unknown as ReturnType<typeof getDiscordClient>;
}

describe('isNewAtl', () => {
  it('returns false when no previous snapshot exists (null) — no baseline to compare', () => {
    expect(isNewAtl(null, 4.99)).toBe(false);
  });

  it('returns false when no previous snapshot exists (undefined) — no baseline to compare', () => {
    expect(isNewAtl(undefined, 4.99)).toBe(false);
  });

  it('returns true when current ATL is lower than previous', () => {
    expect(isNewAtl(9.99, 4.99)).toBe(true);
  });

  it('returns false when current ATL equals previous', () => {
    expect(isNewAtl(4.99, 4.99)).toBe(false);
  });

  it('returns false when current ATL is higher than previous', () => {
    expect(isNewAtl(4.99, 9.99)).toBe(false);
  });

  it('returns false when currentHistoricalLow is null', () => {
    expect(isNewAtl(4.99, null)).toBe(false);
  });
});

describe('alreadyNotifiedForSnapshot', () => {
  it('returns false when either timestamp is missing', () => {
    expect(alreadyNotifiedForSnapshot(null, '2026-05-30 00:00:04')).toBe(false);
    expect(alreadyNotifiedForSnapshot('2026-05-30T00:00:05.000Z', null)).toBe(false);
    expect(alreadyNotifiedForSnapshot(null, null)).toBe(false);
  });

  it('returns true when notified at/after the snapshot was recorded (already announced)', () => {
    // ISO 'Z' notification vs SQLite space-form snapshot, both UTC — the real prod shapes.
    expect(alreadyNotifiedForSnapshot('2026-05-30T00:00:05.000Z', '2026-05-30 00:00:04')).toBe(true);
    expect(alreadyNotifiedForSnapshot('2026-05-30 00:00:04', '2026-05-30 00:00:04')).toBe(true);
  });

  it('returns false when the snapshot is newer than the last notification (fresh ATL)', () => {
    expect(alreadyNotifiedForSnapshot('2026-05-29T12:00:00.000Z', '2026-05-30 00:00:04')).toBe(false);
  });

  it('treats the SQLite space-form timestamp as UTC, not local time', () => {
    // If the space form were parsed as local time, a +/- offset would flip the comparison.
    const a = alreadyNotifiedForSnapshot('2026-05-30T00:00:00.000Z', '2026-05-30 00:00:00');
    expect(a).toBe(true);
  });
});

describe('shouldSendDigest', () => {
  const hour = 12; // the configured digest hour (server-local)

  it('sends on/after the digest hour with no prior send today', () => {
    expect(shouldSendDigest(12, '2026-06-03', hour, null)).toBe(true);
    expect(shouldSendDigest(20, '2026-06-03', hour, null)).toBe(true);
  });

  it('does not send before the digest hour', () => {
    expect(shouldSendDigest(0, '2026-06-03', hour, null)).toBe(false);
    expect(shouldSendDigest(11, '2026-06-03', hour, null)).toBe(false);
  });

  it('does not re-send when already sent for the same date', () => {
    expect(shouldSendDigest(14, '2026-06-03', hour, '2026-06-03')).toBe(false);
  });

  it('sends again on a new date even if yesterday was sent', () => {
    expect(shouldSendDigest(12, '2026-06-04', hour, '2026-06-03')).toBe(true);
  });
});

describe('localDateKey', () => {
  it('formats the server-local date as zero-padded YYYY-MM-DD', () => {
    // TZ is pinned to UTC in vitest.config, so these are stable.
    expect(localDateKey(new Date('2026-06-03T23:30:00Z'))).toBe('2026-06-03');
    expect(localDateKey(new Date('2026-01-09T00:00:00Z'))).toBe('2026-01-09');
  });
});

describe('checkPriceAlerts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Fake only Date so the once-daily digest gate is deterministic. Default to a
    // morning time (>= atlDigestHour, server-local) with no prior send today, so digests are
    // allowed; tests that exercise the gate override the system time. setTimeout etc.
    // stay real, so emitNotification's async path is unaffected.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-06-03T12:00:00Z'));
    mockCreateSyncLog.mockReturnValue(42);
    mockGetFirstUserId.mockReturnValue('user-1');
    mockGetConfig.mockReturnValue({
      alertThrottleHours: 24,
      atlDigestHour: 12,
    } as ReturnType<typeof getEffectiveConfig>);
    mockGetAlerts.mockReturnValue([]);
    mockGetAutoAlertCandidates.mockReturnValue([]);
    mockGetSetting.mockReturnValue(null);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns early with zero stats when no active alerts exist', async () => {
    mockGetAlerts.mockReturnValue([]);

    const result = await checkPriceAlerts();

    expect(result.stats).toEqual({ attempted: 0, succeeded: 0, failed: 0, skipped: 0 });
    expect(mockCompleteSyncLog).toHaveBeenCalledWith(42, 'success', 0, undefined, 0, 0);
  });

  it('sends individual notification when price is at or below target', async () => {
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

  it('sends individual notification for free games (price = 0)', async () => {
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
    expect(mockDiscord.sendAtlDigest).not.toHaveBeenCalled();
    expect(result.stats.succeeded).toBe(1);
  });

  it('sends individual notification for genuinely new ATL', async () => {
    const alert = makeAlert({
      currentPrice: 3.99,
      targetPrice: null,
      notifyOnThreshold: false,
      notifyOnAllTimeLow: true,
      isHistoricalLow: true,
      historicalLowPrice: 3.99,
      prevHistoricalLowPrice: 4.99, // Was 4.99, now 3.99 = new ATL
    });
    mockGetAlerts.mockReturnValue([alert]);
    const mockDiscord = makeMockDiscord();
    mockGetDiscordClient.mockReturnValue(mockDiscord);

    const result = await checkPriceAlerts();

    expect(mockDiscord.sendPriceAlert).toHaveBeenCalled();
    expect(mockDiscord.sendAtlDigest).not.toHaveBeenCalled();
    expect(result.stats.succeeded).toBe(1);
  });

  it('sends digest for still-at-ATL (same historicalLowPrice as previous)', async () => {
    const alert = makeAlert({
      currentPrice: 4.99,
      targetPrice: null,
      notifyOnThreshold: false,
      notifyOnAllTimeLow: true,
      isHistoricalLow: true,
      historicalLowPrice: 4.99,
      prevHistoricalLowPrice: 4.99, // Same as before = still at ATL
    });
    mockGetAlerts.mockReturnValue([alert]);
    const mockDiscord = makeMockDiscord();
    mockGetDiscordClient.mockReturnValue(mockDiscord);

    const result = await checkPriceAlerts();

    expect(mockDiscord.sendPriceAlert).not.toHaveBeenCalled();
    expect(mockDiscord.sendAtlDigest).toHaveBeenCalledWith([
      expect.objectContaining({ title: 'Test Game', currentPrice: 4.99 }),
    ]);
    expect(mockUpdateNotified).toHaveBeenCalledWith(1);
    expect(result.stats.succeeded).toBe(1);
  });

  it('sends digest (not individual) for first-ever ATL once history threshold is met', async () => {
    // No prior historical low recorded, but we have enough snapshots to trust the ATL flag.
    // isNewAtl returns false (no baseline), so this becomes a still-at-ATL digest entry.
    const alert = makeAlert({
      currentPrice: 4.99,
      targetPrice: null,
      notifyOnThreshold: false,
      notifyOnAllTimeLow: true,
      isHistoricalLow: true,
      historicalLowPrice: 4.99,
      prevHistoricalLowPrice: null,
      snapshotCount: 10,
    });
    mockGetAlerts.mockReturnValue([alert]);
    const mockDiscord = makeMockDiscord();
    mockGetDiscordClient.mockReturnValue(mockDiscord);

    const result = await checkPriceAlerts();

    expect(mockDiscord.sendPriceAlert).not.toHaveBeenCalled();
    expect(mockDiscord.sendAtlDigest).toHaveBeenCalledWith([
      expect.objectContaining({ title: 'Test Game' }),
    ]);
    expect(result.stats.succeeded).toBe(1);
  });

  it('skips still-at-ATL when discount is 0% (regular price never dropped)', async () => {
    // ITAD reports historical low equal to regular price — game has never been on sale.
    // Should not appear in the digest; this is not a deal.
    const alert = makeAlert({
      currentPrice: 19.99,
      regularPrice: 19.99,
      discountPercent: 0,
      targetPrice: null,
      notifyOnThreshold: false,
      notifyOnAllTimeLow: true,
      isHistoricalLow: true,
      historicalLowPrice: 19.99,
      prevHistoricalLowPrice: 19.99,
      snapshotCount: 10,
    });
    mockGetAlerts.mockReturnValue([alert]);
    const mockDiscord = makeMockDiscord();
    mockGetDiscordClient.mockReturnValue(mockDiscord);

    const result = await checkPriceAlerts();

    expect(mockDiscord.sendPriceAlert).not.toHaveBeenCalled();
    expect(mockDiscord.sendAtlDigest).not.toHaveBeenCalled();
    expect(mockUpdateNotified).not.toHaveBeenCalled();
    expect(result.stats.succeeded).toBe(0);
  });

  it('does not fire ATL alert (individual or digest) when snapshotCount < minSnapshots', async () => {
    // Brand-new wishlist add: first snapshot, equals ITAD historical low.
    // Should be fully skipped.
    const alert = makeAlert({
      currentPrice: 4.99,
      targetPrice: null,
      notifyOnThreshold: false,
      notifyOnAllTimeLow: true,
      isHistoricalLow: true,
      historicalLowPrice: 4.99,
      prevHistoricalLowPrice: null,
      snapshotCount: 1,
    });
    mockGetAlerts.mockReturnValue([alert]);
    mockGetSetting.mockReturnValue('3');
    const mockDiscord = makeMockDiscord();
    mockGetDiscordClient.mockReturnValue(mockDiscord);

    const result = await checkPriceAlerts();

    expect(mockDiscord.sendPriceAlert).not.toHaveBeenCalled();
    expect(mockDiscord.sendAtlDigest).not.toHaveBeenCalled();
    expect(result.stats.succeeded).toBe(0);
  });

  it('still fires threshold alert even when snapshotCount is below ATL threshold', async () => {
    // Even with thin history, an explicit user threshold trigger is honored.
    const alert = makeAlert({
      currentPrice: 4.99,
      targetPrice: 5.00,
      notifyOnThreshold: true,
      notifyOnAllTimeLow: true,
      isHistoricalLow: true,
      historicalLowPrice: 4.99,
      prevHistoricalLowPrice: null,
      snapshotCount: 1,
    });
    mockGetAlerts.mockReturnValue([alert]);
    mockGetSetting.mockReturnValue('3');
    const mockDiscord = makeMockDiscord();
    mockGetDiscordClient.mockReturnValue(mockDiscord);

    const result = await checkPriceAlerts();

    expect(mockDiscord.sendPriceAlert).toHaveBeenCalled();
    expect(result.stats.succeeded).toBe(1);
  });

  it('skips auto-alert candidate entirely when snapshotCount < minSnapshots', async () => {
    mockGetAutoAlertCandidates.mockReturnValue([
      {
        gameId: 99,
        title: 'New Wishlist Game',
        headerImageUrl: null,
        steamAppId: 999,
        reviewDescription: 'Very Positive',
        hltbMain: 10,
        currentPrice: 4.99,
        regularPrice: 9.99,
        discountPercent: 50,
        historicalLowPrice: 4.99,
        dealScore: 80,
        store: 'Steam',
        storeUrl: 'https://store.steam/app/999',
        lastAutoAlertAt: null,
        prevHistoricalLowPrice: null,
        snapshotCount: 1,
      },
    ]);
    mockGetSetting.mockImplementation((key) =>
      key === 'min_snapshots_for_atl_alert' ? '3' : null,
    );
    const mockDiscord = makeMockDiscord();
    mockGetDiscordClient.mockReturnValue(mockDiscord);

    const result = await checkPriceAlerts();

    expect(mockDiscord.sendPriceAlert).not.toHaveBeenCalled();
    expect(mockDiscord.sendAtlDigest).not.toHaveBeenCalled();
    expect(result.stats.succeeded).toBe(0);
  });

  it('sends individual for threshold even if also still-at-ATL', async () => {
    const alert = makeAlert({
      currentPrice: 4.99,
      targetPrice: 5.00,
      notifyOnThreshold: true,
      notifyOnAllTimeLow: true,
      isHistoricalLow: true,
      historicalLowPrice: 4.99,
      prevHistoricalLowPrice: 4.99, // Would be digest if only ATL
    });
    mockGetAlerts.mockReturnValue([alert]);
    const mockDiscord = makeMockDiscord();
    mockGetDiscordClient.mockReturnValue(mockDiscord);

    const result = await checkPriceAlerts();

    // Threshold takes priority — individual alert
    expect(mockDiscord.sendPriceAlert).toHaveBeenCalled();
    expect(mockDiscord.sendAtlDigest).not.toHaveBeenCalled();
    expect(result.stats.succeeded).toBe(1);
  });

  it('does not send digest when no still-at-ATL games', async () => {
    const alert = makeAlert({ currentPrice: 9.99, targetPrice: 10.00 });
    mockGetAlerts.mockReturnValue([alert]);
    const mockDiscord = makeMockDiscord();
    mockGetDiscordClient.mockReturnValue(mockDiscord);

    await checkPriceAlerts();

    expect(mockDiscord.sendAtlDigest).not.toHaveBeenCalled();
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
      atlDigestHour: 12,
    } as ReturnType<typeof getEffectiveConfig>);
    const mockDiscord = makeMockDiscord();
    mockGetDiscordClient.mockReturnValue(mockDiscord);

    const result = await checkPriceAlerts();

    expect(mockDiscord.sendPriceAlert).not.toHaveBeenCalled();
    expect(result.stats.skipped).toBe(1);
  });

  it('lets a genuine new ATL break through the throttle (Atomfall regression)', async () => {
    // Repro: digest entry on day N consumed the 24h throttle. On day N+1 a
    // genuine new ATL landed inside the throttle window and was silenced.
    // After the fix, isNew ATLs bypass the throttle entirely.
    const recent = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString(); // 12h ago
    const alert = makeAlert({
      currentPrice: 21.49,
      targetPrice: null,
      notifyOnThreshold: false,
      notifyOnAllTimeLow: true,
      isHistoricalLow: true,
      historicalLowPrice: 21.49,
      prevHistoricalLowPrice: 22.49, // Real drop = new ATL
      lastNotifiedAt: recent,
    });
    mockGetAlerts.mockReturnValue([alert]);
    const mockDiscord = makeMockDiscord();
    mockGetDiscordClient.mockReturnValue(mockDiscord);

    const result = await checkPriceAlerts();

    expect(mockDiscord.sendPriceAlert).toHaveBeenCalledWith(
      expect.objectContaining({ currentPrice: 21.49 })
    );
    expect(mockDiscord.sendAtlDigest).not.toHaveBeenCalled();
    expect(result.stats.succeeded).toBe(1);
  });

  it('does not re-fire a new ATL on a second same-day run (Story of Seasons regression)', async () => {
    // Repro: cron runs every 12h (00:00 + 12:00 UTC) but snapshots dedup to one row
    // per day. A genuine new ATL fires on the 00:00 run and stamps lastNotifiedAt.
    // The 12:00 run sees the *same* (unadvanced) snapshot, so isNewAtl still reads the
    // previous-day baseline and the new-ATL throttle bypass re-fired the identical alert.
    // Fix: the bypass only applies once per snapshot — if we already notified at/after
    // the latest snapshot was recorded, it no longer re-fires as an individual alert.
    // (On this morning digest run the game still correctly joins the once-daily digest,
    // since it's genuinely still at its ATL — just without a duplicate 🏆 ping.)
    const snapshotAt = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString(); // recorded 12h ago
    const notifiedAt = new Date(Date.now() - 12 * 60 * 60 * 1000 + 1000).toISOString(); // fired 1s later
    const alert = makeAlert({
      currentPrice: 33.45,
      targetPrice: 30, // above current, so threshold never triggers
      notifyOnThreshold: true,
      notifyOnAllTimeLow: true,
      isHistoricalLow: true,
      historicalLowPrice: 33.45,
      prevHistoricalLowPrice: 33.49, // previous-day baseline, looks like a "new" ATL
      lastNotifiedAt: notifiedAt,
      latestSnapshotAt: snapshotAt,
    });
    mockGetAlerts.mockReturnValue([alert]);
    const mockDiscord = makeMockDiscord();
    mockGetDiscordClient.mockReturnValue(mockDiscord);

    const result = await checkPriceAlerts();

    // The key regression: no duplicate individual 🏆 alert on the second same-day run.
    expect(mockDiscord.sendPriceAlert).not.toHaveBeenCalled();
    // It does belong in the morning still-at-ATL digest, though.
    expect(mockDiscord.sendAtlDigest).toHaveBeenCalledWith([
      expect.objectContaining({ title: 'Test Game', currentPrice: 33.45 }),
    ]);
    expect(result.stats.succeeded).toBe(1);
  });

  it('still fires a genuine new ATL recorded after the last notification', async () => {
    // Complement to the regression above: when the latest snapshot was recorded *after*
    // the last notification (a real new low landed this run), the bypass must still fire
    // even inside the 24h throttle window — this is the Atomfall day-N+1 case.
    const notifiedAt = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString(); // 12h ago
    const snapshotAt = new Date(Date.now() - 60 * 1000).toISOString(); // recorded 1 min ago
    const alert = makeAlert({
      currentPrice: 19.99,
      targetPrice: null,
      notifyOnThreshold: false,
      notifyOnAllTimeLow: true,
      isHistoricalLow: true,
      historicalLowPrice: 19.99,
      prevHistoricalLowPrice: 22.49, // real drop = new ATL
      lastNotifiedAt: notifiedAt,
      latestSnapshotAt: snapshotAt,
    });
    mockGetAlerts.mockReturnValue([alert]);
    const mockDiscord = makeMockDiscord();
    mockGetDiscordClient.mockReturnValue(mockDiscord);

    const result = await checkPriceAlerts();

    expect(mockDiscord.sendPriceAlert).toHaveBeenCalledWith(
      expect.objectContaining({ currentPrice: 19.99 })
    );
    expect(result.stats.succeeded).toBe(1);
  });

  it('includes a still-at-ATL game in the daily digest even when recently notified', async () => {
    // The digest is a once-daily reminder gated by the digest window, not the 24h
    // throttle. A game notified an hour ago must still appear in today's complete list
    // (otherwise the list would be missing games that are genuinely still at ATL).
    const recent = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString();
    const alert = makeAlert({
      currentPrice: 4.99,
      targetPrice: null,
      notifyOnThreshold: false,
      notifyOnAllTimeLow: true,
      isHistoricalLow: true,
      historicalLowPrice: 4.99,
      prevHistoricalLowPrice: 4.99,
      lastNotifiedAt: recent,
    });
    mockGetAlerts.mockReturnValue([alert]);
    const mockDiscord = makeMockDiscord();
    mockGetDiscordClient.mockReturnValue(mockDiscord);

    const result = await checkPriceAlerts();

    expect(mockDiscord.sendAtlDigest).toHaveBeenCalledWith([
      expect.objectContaining({ title: 'Test Game', currentPrice: 4.99 }),
    ]);
    expect(result.stats.succeeded).toBe(1);
  });

  it('skips the digest on a run before the daily digest hour (new-ATL alerts still fire)', async () => {
    // Evening run (00:00 UTC = 8 PM ET): hour < atlDigestHour, so no still-at-ATL
    // digest. A genuine new ATL on the same run must still ping immediately.
    vi.setSystemTime(new Date('2026-06-03T00:00:00Z'));
    const stillAtl = makeAlert({
      id: 1,
      title: 'Still ATL',
      currentPrice: 4.99,
      targetPrice: null,
      notifyOnThreshold: false,
      notifyOnAllTimeLow: true,
      isHistoricalLow: true,
      historicalLowPrice: 4.99,
      prevHistoricalLowPrice: 4.99,
    });
    const newAtl = makeAlert({
      id: 2,
      title: 'New ATL',
      currentPrice: 3.99,
      targetPrice: null,
      notifyOnThreshold: false,
      notifyOnAllTimeLow: true,
      isHistoricalLow: true,
      historicalLowPrice: 3.99,
      prevHistoricalLowPrice: 4.99,
    });
    mockGetAlerts.mockReturnValue([stillAtl, newAtl]);
    const mockDiscord = makeMockDiscord();
    mockGetDiscordClient.mockReturnValue(mockDiscord);

    const result = await checkPriceAlerts();

    expect(mockDiscord.sendAtlDigest).not.toHaveBeenCalled();
    expect(mockDiscord.sendPriceAlert).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'New ATL' }),
    );
    expect(result.stats.succeeded).toBe(1);
  });

  it('does not re-send the digest when it already sent earlier today', async () => {
    // Off-cycle run later the same UTC day: the date dedup blocks a second digest.
    mockGetSetting.mockImplementation((key) =>
      key === 'last_atl_digest_date' ? '2026-06-03' : null,
    );
    const alert = makeAlert({
      currentPrice: 4.99,
      targetPrice: null,
      notifyOnThreshold: false,
      notifyOnAllTimeLow: true,
      isHistoricalLow: true,
      historicalLowPrice: 4.99,
      prevHistoricalLowPrice: 4.99,
    });
    mockGetAlerts.mockReturnValue([alert]);
    const mockDiscord = makeMockDiscord();
    mockGetDiscordClient.mockReturnValue(mockDiscord);

    const result = await checkPriceAlerts();

    expect(mockDiscord.sendAtlDigest).not.toHaveBeenCalled();
    expect(result.stats.succeeded).toBe(0);
  });

  it('records the digest date after a successful send', async () => {
    const alert = makeAlert({
      currentPrice: 4.99,
      targetPrice: null,
      notifyOnThreshold: false,
      notifyOnAllTimeLow: true,
      isHistoricalLow: true,
      historicalLowPrice: 4.99,
      prevHistoricalLowPrice: 4.99,
    });
    mockGetAlerts.mockReturnValue([alert]);
    const mockDiscord = makeMockDiscord();
    mockGetDiscordClient.mockReturnValue(mockDiscord);

    await checkPriceAlerts();

    expect(mockSetSetting).toHaveBeenCalledWith(
      'last_atl_digest_date',
      '2026-06-03',
      expect.any(String),
    );
  });

  it('auto-alert: new ATL fires individually, still-at-ATL goes to the daily digest', async () => {
    mockGetAutoAlertCandidates.mockReturnValue([
      {
        gameId: 100,
        title: 'Atomfall',
        headerImageUrl: null,
        steamAppId: 100,
        reviewDescription: 'Very Positive',
        hltbMain: 10,
        currentPrice: 21.49,
        regularPrice: 49.99,
        discountPercent: 57,
        historicalLowPrice: 21.49,
        dealScore: 67,
        store: 'Fanatical',
        storeUrl: 'https://fanatical.com/atomfall',
        // Digest from yesterday burned the throttle, but this run is a real new ATL.
        lastAutoAlertAt: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString(),
        prevHistoricalLowPrice: 22.49,
        snapshotCount: 200,
      },
      {
        gameId: 101,
        title: 'Steady Sale',
        headerImageUrl: null,
        steamAppId: 101,
        reviewDescription: 'Very Positive',
        hltbMain: 10,
        currentPrice: 4.99,
        regularPrice: 9.99,
        discountPercent: 50,
        historicalLowPrice: 4.99,
        dealScore: 80,
        store: 'Steam',
        storeUrl: 'https://store.steampowered.com/app/101',
        lastAutoAlertAt: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString(),
        prevHistoricalLowPrice: 4.99, // Same as before — still at ATL
        snapshotCount: 200,
      },
    ]);
    const mockDiscord = makeMockDiscord();
    mockGetDiscordClient.mockReturnValue(mockDiscord);

    const result = await checkPriceAlerts();

    // Atomfall (new ATL) fires individually; Steady Sale (still ATL) joins the daily digest
    // regardless of its recent notification — the daily gate, not the 24h throttle, governs it.
    expect(mockDiscord.sendPriceAlert).toHaveBeenCalledTimes(1);
    expect(mockDiscord.sendPriceAlert).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Atomfall', currentPrice: 21.49 })
    );
    expect(mockDiscord.sendAtlDigest).toHaveBeenCalledWith([
      expect.objectContaining({ title: 'Steady Sale', currentPrice: 4.99 }),
    ]);
    expect(result.stats.succeeded).toBe(2);
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

  it('does not update lastNotified when digest send fails', async () => {
    const alert = makeAlert({
      currentPrice: 4.99,
      targetPrice: null,
      notifyOnThreshold: false,
      notifyOnAllTimeLow: true,
      isHistoricalLow: true,
      historicalLowPrice: 4.99,
      prevHistoricalLowPrice: 4.99,
    });
    mockGetAlerts.mockReturnValue([alert]);
    const mockDiscord = makeMockDiscord({
      sendAtlDigest: vi.fn().mockResolvedValue(false),
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

  it('processes multiple alerts: individual + digest + skip', async () => {
    const alerts = [
      makeAlert({ id: 1, title: 'Game A', currentPrice: 5.00, targetPrice: 10.00 }),
      makeAlert({ id: 2, title: 'Game B', currentPrice: 30.00, targetPrice: 10.00, isHistoricalLow: false }),
      makeAlert({ id: 3, title: 'Game C', currentPrice: 0, notifyOnThreshold: false, notifyOnAllTimeLow: false }),
    ];
    mockGetAlerts.mockReturnValue(alerts);
    const mockDiscord = makeMockDiscord();
    mockGetDiscordClient.mockReturnValue(mockDiscord);

    const result = await checkPriceAlerts();

    // Game A (below target) and Game C (free) should notify individually; Game B should not
    expect(mockDiscord.sendPriceAlert).toHaveBeenCalledTimes(2);
    expect(result.stats.succeeded).toBe(2);
  });

  it('mixes individual and digest alerts correctly', async () => {
    const alerts = [
      // New ATL = individual
      makeAlert({ id: 1, title: 'New ATL Game', currentPrice: 3.99, targetPrice: null, notifyOnThreshold: false, notifyOnAllTimeLow: true, isHistoricalLow: true, historicalLowPrice: 3.99, prevHistoricalLowPrice: 4.99 }),
      // Still at ATL = digest
      makeAlert({ id: 2, title: 'Still ATL Game', currentPrice: 4.99, targetPrice: null, notifyOnThreshold: false, notifyOnAllTimeLow: true, isHistoricalLow: true, historicalLowPrice: 4.99, prevHistoricalLowPrice: 4.99 }),
    ];
    mockGetAlerts.mockReturnValue(alerts);
    const mockDiscord = makeMockDiscord();
    mockGetDiscordClient.mockReturnValue(mockDiscord);

    const result = await checkPriceAlerts();

    expect(mockDiscord.sendPriceAlert).toHaveBeenCalledTimes(1);
    expect(mockDiscord.sendPriceAlert).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'New ATL Game' })
    );
    expect(mockDiscord.sendAtlDigest).toHaveBeenCalledWith([
      expect.objectContaining({ title: 'Still ATL Game' }),
    ]);
    expect(result.stats.succeeded).toBe(2);
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
