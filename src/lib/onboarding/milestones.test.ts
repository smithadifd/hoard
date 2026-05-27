import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db/queries', () => ({
  getSetting: vi.fn(),
  setSetting: vi.fn(),
}));

const sendOperationalAlert = vi.fn();
vi.mock('@/lib/discord/client', () => ({
  getDiscordClient: () => ({ sendOperationalAlert }),
}));

import { fireMilestone, milestones, hasFiredMilestone } from './milestones';
import { getSetting, setSetting } from '@/lib/db/queries';

const mockGetSetting = vi.mocked(getSetting);
const mockSetSetting = vi.mocked(setSetting);

function memorySetting() {
  // Single-key store keyed by the milestones setting key. Reset per test via
  // beforeEach.
  let storedValue: string | null = null;
  mockGetSetting.mockImplementation(() => storedValue);
  mockSetSetting.mockImplementation((_key, value) => {
    storedValue = value;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  sendOperationalAlert.mockResolvedValue(true);
  memorySetting();
});

describe('fireMilestone', () => {
  it('fires once and persists the key', async () => {
    const fired = await fireMilestone('user-1', 'drain-complete', {
      title: 'Done',
      description: 'Everything finished.',
    });

    expect(fired).toBe(true);
    expect(sendOperationalAlert).toHaveBeenCalledTimes(1);
    expect(mockSetSetting).toHaveBeenCalledWith(
      'onboarding_milestones:user-1',
      JSON.stringify(['drain-complete']),
      'Onboarding milestones',
    );
  });

  it('refuses to fire the same milestone twice', async () => {
    await fireMilestone('user-1', 'drain-complete', { title: 'A', description: 'B' });
    const second = await fireMilestone('user-1', 'drain-complete', { title: 'A', description: 'B' });

    expect(second).toBe(false);
    expect(sendOperationalAlert).toHaveBeenCalledTimes(1);
  });

  it('allows different milestone keys to fire independently', async () => {
    await fireMilestone('user-1', 'drain-25', { title: '25', description: '' });
    await fireMilestone('user-1', 'drain-50', { title: '50', description: '' });
    await fireMilestone('user-1', 'drain-complete', { title: 'done', description: '' });

    expect(sendOperationalAlert).toHaveBeenCalledTimes(3);
  });

  it('still marks fired even when Discord rejects', async () => {
    sendOperationalAlert.mockRejectedValueOnce(new Error('webhook 500'));

    await fireMilestone('user-1', 'first-deal', { title: 'x', description: 'y' });

    // Second call must still no-op even though the first dispatch failed.
    const second = await fireMilestone('user-1', 'first-deal', { title: 'x', description: 'y' });
    expect(second).toBe(false);
  });

  it('hasFiredMilestone reflects persisted state', async () => {
    expect(hasFiredMilestone('user-1', 'first-10-rated')).toBe(false);
    await fireMilestone('user-1', 'first-10-rated', { title: 't', description: 'd' });
    expect(hasFiredMilestone('user-1', 'first-10-rated')).toBe(true);
  });

  it('falls back gracefully when the persisted value is not JSON', async () => {
    mockGetSetting.mockReturnValue('not-json');

    const fired = await fireMilestone('user-2', 'drain-complete', {
      title: 'x',
      description: 'y',
    });

    expect(fired).toBe(true);
    expect(sendOperationalAlert).toHaveBeenCalledTimes(1);
  });
});

describe('milestone helpers', () => {
  it('drainProgress fires a 25% embed for the 25 bucket', async () => {
    await milestones.drainProgress('user-1', 'full', 25);
    expect(sendOperationalAlert).toHaveBeenCalledWith(
      expect.objectContaining({ title: expect.stringContaining('25%') }),
    );
  });

  it('drainProgress 25 and 50 are independent keys', async () => {
    await milestones.drainProgress('user-1', 'full', 25);
    await milestones.drainProgress('user-1', 'full', 50);
    expect(sendOperationalAlert).toHaveBeenCalledTimes(2);
  });

  it('drainComplete fires once per user', async () => {
    await milestones.drainComplete('user-1', 'lite');
    await milestones.drainComplete('user-1', 'lite');
    expect(sendOperationalAlert).toHaveBeenCalledTimes(1);
  });

  it('firstTenRated includes the rated count in fields', async () => {
    await milestones.firstTenRated('user-1', 12);
    expect(sendOperationalAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        fields: [{ name: 'Rated so far', value: '12', inline: true }],
      }),
    );
  });

  it('firstDeal interpolates the game title into the description', async () => {
    await milestones.firstDeal('user-1', 'Portal 2');
    expect(sendOperationalAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        description: expect.stringContaining('Portal 2'),
      }),
    );
  });
});
