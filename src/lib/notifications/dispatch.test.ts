import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DEFAULT_PREFERENCES, type NotificationPreferences } from './preferences';

vi.mock('@/lib/db/queries', () => ({
  getNotificationPreferences: vi.fn(),
  getFirstUserId: vi.fn(),
}));

vi.mock('./create', () => ({
  createNotification: vi.fn(),
}));

import { emitNotification } from './dispatch';
import { getNotificationPreferences, getFirstUserId } from '@/lib/db/queries';
import { createNotification } from './create';

const mockGetPrefs = vi.mocked(getNotificationPreferences);
const mockGetFirstUserId = vi.mocked(getFirstUserId);
const mockCreate = vi.mocked(createNotification);

/** Fresh deep clone of defaults, so per-test mutations never leak. */
function prefs(): NotificationPreferences {
  return structuredClone(DEFAULT_PREFERENCES);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetPrefs.mockReturnValue(prefs());
  mockGetFirstUserId.mockReturnValue('user-1');
  mockCreate.mockReturnValue(1);
});

describe('emitNotification — channel routing', () => {
  it('routes to both channels when both are enabled', async () => {
    const discord = vi.fn().mockResolvedValue(true);
    const result = await emitNotification({
      category: 'deal-individual',
      userId: 'u1',
      inApp: { title: 'Deal' },
      discord,
    });
    expect(mockCreate).toHaveBeenCalledExactlyOnceWith('u1', 'deal-alert', { title: 'Deal' });
    expect(discord).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ inAppDelivered: true, discordDelivered: true });
  });

  it('skips Discord when the category has discord routing off (in-app still fires)', async () => {
    const p = prefs();
    p.categories['deal-individual'].discord = false;
    mockGetPrefs.mockReturnValue(p);
    const discord = vi.fn().mockResolvedValue(true);

    const result = await emitNotification({
      category: 'deal-individual',
      userId: 'u1',
      inApp: { title: 'Deal' },
      discord,
    });
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(discord).not.toHaveBeenCalled();
    expect(result).toEqual({ inAppDelivered: true, discordDelivered: false });
  });

  it('skips in-app when the category has inApp routing off (Discord still fires)', async () => {
    const p = prefs();
    p.categories['deal-individual'].inApp = false;
    mockGetPrefs.mockReturnValue(p);
    const discord = vi.fn().mockResolvedValue(true);

    const result = await emitNotification({
      category: 'deal-individual',
      userId: 'u1',
      inApp: { title: 'Deal' },
      discord,
    });
    expect(mockCreate).not.toHaveBeenCalled();
    expect(discord).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ inAppDelivered: false, discordDelivered: true });
  });

  it('maps each category to its in-app type', async () => {
    const discord = vi.fn().mockResolvedValue(true);
    await emitNotification({ category: 'deal-digest', userId: 'u1', inApp: { title: 'd' }, discord });
    await emitNotification({ category: 'release', userId: 'u1', inApp: { title: 'r' }, discord });
    await emitNotification({ category: 'system', userId: 'u1', inApp: { title: 's' }, discord });
    expect(mockCreate).toHaveBeenNthCalledWith(1, 'u1', 'deal-alert', { title: 'd' });
    expect(mockCreate).toHaveBeenNthCalledWith(2, 'u1', 'release', { title: 'r' });
    expect(mockCreate).toHaveBeenNthCalledWith(3, 'u1', 'system', { title: 's' });
  });
});

describe('emitNotification — failure isolation', () => {
  it('isolates a Discord failure from the in-app write and never throws', async () => {
    const discord = vi.fn().mockRejectedValue(new Error('webhook down'));
    const result = await emitNotification({
      category: 'deal-individual',
      userId: 'u1',
      inApp: { title: 'Deal' },
      discord,
    });
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ inAppDelivered: true, discordDelivered: false });
  });

  it('reports inAppDelivered false when createNotification returns null', async () => {
    mockCreate.mockReturnValue(null);
    const discord = vi.fn().mockResolvedValue(true);
    const result = await emitNotification({
      category: 'deal-individual',
      userId: 'u1',
      inApp: { title: 'x' },
      discord,
    });
    expect(result.inAppDelivered).toBe(false);
    expect(result.discordDelivered).toBe(true);
  });

  it('falls back to defaults (and still notifies) when preferences fail to load', async () => {
    mockGetPrefs.mockImplementation(() => {
      throw new Error('db down');
    });
    const discord = vi.fn().mockResolvedValue(true);
    const result = await emitNotification({
      category: 'deal-individual',
      userId: 'u1',
      inApp: { title: 'x' },
      discord,
    });
    expect(result).toEqual({ inAppDelivered: true, discordDelivered: true });
  });
});

describe('emitNotification — recipient resolution', () => {
  it('uses the explicit userId without resolving the first user', async () => {
    const discord = vi.fn().mockResolvedValue(true);
    await emitNotification({ category: 'deal-individual', userId: 'explicit', inApp: { title: 'x' }, discord });
    expect(mockGetFirstUserId).not.toHaveBeenCalled();
    expect(mockCreate).toHaveBeenCalledWith('explicit', 'deal-alert', { title: 'x' });
  });

  it('falls back to the first user when no userId is given', async () => {
    const discord = vi.fn().mockResolvedValue(true);
    await emitNotification({ category: 'system', inApp: { title: 'Backup failed' }, discord });
    expect(mockGetFirstUserId).toHaveBeenCalled();
    expect(mockCreate).toHaveBeenCalledWith('user-1', 'system', { title: 'Backup failed' });
  });

  it('skips in-app gracefully when there is no user yet (pre-setup)', async () => {
    mockGetFirstUserId.mockImplementation(() => {
      throw new Error('No users found');
    });
    const discord = vi.fn().mockResolvedValue(true);
    const result = await emitNotification({ category: 'system', inApp: { title: 'x' }, discord });
    expect(mockCreate).not.toHaveBeenCalled();
    expect(result.inAppDelivered).toBe(false);
    expect(result.discordDelivered).toBe(true);
  });
});

describe('emitNotification — Discord-only events', () => {
  it('does not create an in-app row when the inApp payload is omitted', async () => {
    const discord = vi.fn().mockResolvedValue(true);
    const result = await emitNotification({ category: 'milestone', discord });
    expect(mockCreate).not.toHaveBeenCalled();
    expect(discord).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ inAppDelivered: false, discordDelivered: true });
  });
});

describe('emitNotification — quiet hours', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function withQuietWindow(): NotificationPreferences {
    const p = prefs();
    p.quietHours = { enabled: true, start: 22, end: 8 };
    return p;
  }

  it('suppresses Discord for deal categories inside the window; in-app still records', async () => {
    vi.setSystemTime(new Date(2026, 0, 1, 23, 0, 0)); // 23:00 local — inside 22→8
    mockGetPrefs.mockReturnValue(withQuietWindow());
    const discord = vi.fn().mockResolvedValue(true);

    const result = await emitNotification({
      category: 'deal-individual',
      userId: 'u1',
      inApp: { title: 'x' },
      discord,
    });
    expect(discord).not.toHaveBeenCalled();
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ inAppDelivered: true, discordDelivered: false });
  });

  it('does NOT suppress non-deal categories during quiet hours', async () => {
    vi.setSystemTime(new Date(2026, 0, 1, 23, 0, 0));
    mockGetPrefs.mockReturnValue(withQuietWindow());
    const discord = vi.fn().mockResolvedValue(true);

    const result = await emitNotification({ category: 'system', inApp: { title: 'x' }, discord });
    expect(discord).toHaveBeenCalledTimes(1);
    expect(result.discordDelivered).toBe(true);
  });

  it('does not suppress deal categories outside the window', async () => {
    vi.setSystemTime(new Date(2026, 0, 1, 12, 0, 0)); // noon — outside 22→8
    mockGetPrefs.mockReturnValue(withQuietWindow());
    const discord = vi.fn().mockResolvedValue(true);

    await emitNotification({ category: 'deal-digest', userId: 'u1', inApp: { title: 'x' }, discord });
    expect(discord).toHaveBeenCalledTimes(1);
  });
});
