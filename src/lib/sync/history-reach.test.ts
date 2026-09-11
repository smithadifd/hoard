import { describe, it, expect } from 'vitest';
import {
  assessHistoryReach,
  isHistoryShort,
  selfHealDisposition,
  LAUNCH_REACH_TOLERANCE_DAYS,
  BACKFILL_RETRY_COOLDOWN_DAYS,
} from './history-reach';

// Repro case from the ticket: "The Darkside Detective: A Fumble in the Dark" —
// Steam release Apr 15, 2021 (app 795420); Hoard's history for it began early 2026.
// 2021-04-15 → 2026-02-06 is 1758 days, derived by hand (5y = 1826d incl. the 2024
// leap day, minus the 68 days from Feb 6 to Apr 15), not by the code under test.
const REPRO_RELEASE = 'Apr 15, 2021';
const REPRO_EARLIEST_SNAPSHOT = '2026-02-06';
const REPRO_LAUNCH_DAY = '2021-04-15';
const REPRO_SHORTFALL_DAYS = 1758;

describe('assessHistoryReach (S1)', () => {
  it('flags the repro game as short: history starting 2026-02-06 for an Apr 15, 2021 launch', () => {
    const reach = assessHistoryReach({
      releaseDate: REPRO_RELEASE,
      earliestSnapshotDate: REPRO_EARLIEST_SNAPSHOT,
    });
    expect(reach.status).toBe('short');
    expect(reach.shortfallDays).toBe(REPRO_SHORTFALL_DAYS);
    expect(reach.launchDay).toBe(REPRO_LAUNCH_DAY);
    expect(reach.earliestSnapshotDate).toBe(REPRO_EARLIEST_SNAPSHOT);
    expect(isHistoryShort(reach)).toBe(true);
  });

  it('reaches launch when the earliest snapshot is on the launch day', () => {
    const reach = assessHistoryReach({
      releaseDate: REPRO_RELEASE,
      earliestSnapshotDate: REPRO_LAUNCH_DAY,
    });
    expect(reach.status).toBe('reaches-launch');
    expect(reach.shortfallDays).toBe(0);
    expect(isHistoryShort(reach)).toBe(false);
  });

  it('tolerates a provider lag of up to LAUNCH_REACH_TOLERANCE_DAYS after launch', () => {
    // 2021-04-15 + 90 days = 2021-07-14 (15 Apr→30 Apr = 15, May 31, Jun 30, +14 Jul).
    expect(LAUNCH_REACH_TOLERANCE_DAYS).toBe(90);
    expect(
      assessHistoryReach({ releaseDate: REPRO_RELEASE, earliestSnapshotDate: '2021-07-14' }).status
    ).toBe('reaches-launch');
    expect(
      assessHistoryReach({ releaseDate: REPRO_RELEASE, earliestSnapshotDate: '2021-07-15' }).status
    ).toBe('short');
  });

  it('reaches launch when snapshots predate launch (pre-order pricing)', () => {
    const reach = assessHistoryReach({ releaseDate: REPRO_RELEASE, earliestSnapshotDate: '2021-03-01' });
    expect(reach.status).toBe('reaches-launch');
    expect(reach.shortfallDays).toBe(0);
  });

  it('cannot judge an unknown launch — never short, never a retry trigger', () => {
    for (const releaseDate of [null, undefined, '', 'Coming Soon', 'To be announced']) {
      const reach = assessHistoryReach({ releaseDate, earliestSnapshotDate: REPRO_EARLIEST_SNAPSHOT });
      expect(reach.status).toBe('unknown-launch');
      expect(reach.shortfallDays).toBeNull();
      expect(isHistoryShort(reach)).toBe(false);
    }
  });

  it('treats a game with no snapshots at all as short (nothing reaches launch)', () => {
    const reach = assessHistoryReach({ releaseDate: REPRO_RELEASE, earliestSnapshotDate: null });
    expect(reach.status).toBe('no-history');
    expect(isHistoryShort(reach)).toBe(true);
  });

  it('floors the launch at the provider epoch: a 2005 game whose history starts 2012-03-01 reaches launch', () => {
    // ITAD has no data before 2012-01-01; 2012-03-01 is 60 days after the epoch, inside tolerance.
    const reach = assessHistoryReach({ releaseDate: 'Oct 3, 2005', earliestSnapshotDate: '2012-03-01' });
    expect(reach.status).toBe('reaches-launch');
    expect(reach.launchDay).toBe('2012-01-01');
  });

  it('handles month- and year-precision Steam release strings', () => {
    // "March 2021" parses to 2021-03-01; a 2026 start is still years short.
    expect(assessHistoryReach({ releaseDate: 'March 2021', earliestSnapshotDate: REPRO_EARLIEST_SNAPSHOT }).status).toBe('short');
    expect(assessHistoryReach({ releaseDate: '2021', earliestSnapshotDate: '2021-02-01' }).status).toBe('reaches-launch');
  });
});

describe('selfHealDisposition (S2)', () => {
  const now = new Date('2026-09-11T12:00:00Z');
  const GIVE_UP = 3; // PRICE_HISTORY_GIVE_UP_MISSES, passed by the callers
  const short = assessHistoryReach({ releaseDate: REPRO_RELEASE, earliestSnapshotDate: REPRO_EARLIEST_SNAPSHOT });
  const reaching = assessHistoryReach({ releaseDate: REPRO_RELEASE, earliestSnapshotDate: REPRO_LAUNCH_DAY });

  it('is due for a never-backfilled game under the give-up threshold, gave-up at it', () => {
    expect(selfHealDisposition({ priceHistoryBackfilledAt: null, priceHistoryMissCount: 0, reach: short }, now, GIVE_UP)).toBe('due');
    expect(selfHealDisposition({ priceHistoryBackfilledAt: null, priceHistoryMissCount: 2, reach: reaching }, now, GIVE_UP)).toBe('due');
    expect(selfHealDisposition({ priceHistoryBackfilledAt: null, priceHistoryMissCount: 3, reach: short }, now, GIVE_UP)).toBe('gave-up');
  });

  it('is due for a stamped-but-short game once the stamp is older than the cooldown (the repro state)', () => {
    expect(BACKFILL_RETRY_COOLDOWN_DAYS).toBe(30);
    // Stamped 2026-06-01, now 2026-09-11: 102 days old — past the 30-day cooldown.
    const state = { priceHistoryBackfilledAt: new Date('2026-06-01T05:00:00Z'), priceHistoryMissCount: 0, reach: short };
    expect(selfHealDisposition(state, now, GIVE_UP)).toBe('due');
    // A give-up stamp (3 misses) also expires — transient failures must not be permanent.
    expect(selfHealDisposition({ ...state, priceHistoryMissCount: 3 }, now, GIVE_UP)).toBe('due');
  });

  it('cools down a stamped-but-short game whose stamp is younger than the cooldown', () => {
    // Stamped 2026-09-01, now 2026-09-11: 10 days old.
    const stamp = new Date('2026-09-01T05:00:00Z');
    expect(selfHealDisposition({ priceHistoryBackfilledAt: stamp, priceHistoryMissCount: 0, reach: short }, now, GIVE_UP)).toBe('cooling-down');
    expect(selfHealDisposition({ priceHistoryBackfilledAt: stamp, priceHistoryMissCount: 3, reach: short }, now, GIVE_UP)).toBe('gave-up');
  });

  it('never re-runs a stamped game whose history already reaches launch, however old the stamp', () => {
    const state = { priceHistoryBackfilledAt: new Date('2026-06-01T05:00:00Z'), priceHistoryMissCount: 0, reach: reaching };
    expect(selfHealDisposition(state, now, GIVE_UP)).toBe('already-backfilled');
  });

  it('never re-runs a stamped game whose launch is unknown', () => {
    const unknown = assessHistoryReach({ releaseDate: 'Coming Soon', earliestSnapshotDate: REPRO_EARLIEST_SNAPSHOT });
    const state = { priceHistoryBackfilledAt: new Date('2026-06-01T05:00:00Z'), priceHistoryMissCount: 0, reach: unknown };
    expect(selfHealDisposition(state, now, GIVE_UP)).toBe('already-backfilled');
  });
});
