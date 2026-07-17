import { describe, it, expect } from 'vitest';
import { BACKLOG_PICKS, BACKLOG_PRESETS, PICK_MOODS } from './presets';

describe('BACKLOG_PICKS — the unified source', () => {
  it('every pick declares at least one surface and has unique ids', () => {
    const ids = BACKLOG_PICKS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of BACKLOG_PICKS) {
      expect(p.surfaces.length).toBeGreaterThan(0);
      expect(p.icon).toBeTruthy();
    }
  });
});

describe('BACKLOG_PRESETS — backward-compatible view', () => {
  it('still yields exactly the six preset chips, in order', () => {
    expect(BACKLOG_PRESETS.map((p) => p.id)).toEqual([
      'date-night',
      'quick-play',
      'deep-dive',
      'hidden-gems',
      'play-again',
      'most-value-waiting',
    ]);
  });

  it('preserves each preset\'s filters exactly (regression pin)', () => {
    const dateNight = BACKLOG_PRESETS.find((p) => p.id === 'date-night')!;
    expect(dateNight.filters).toEqual({
      coop: true,
      maxHours: 10,
      playtimeStatus: 'backlog',
      strictFilters: true,
    });
    const mvw = BACKLOG_PRESETS.find((p) => p.id === 'most-value-waiting')!;
    expect(mvw.filters).toEqual({
      playtimeStatus: 'backlog',
      sortBy: 'valueWaiting',
      sortOrder: 'desc',
      minReview: 70,
      strictFilters: true,
    });
  });

  it('exposes only the legacy preset shape (no surfaces field leaks through)', () => {
    for (const p of BACKLOG_PRESETS) {
      expect(Object.keys(p).sort()).toEqual(['description', 'filters', 'icon', 'id', 'label']);
    }
  });
});

describe('PICK_MOODS — the merged mood view', () => {
  it('yields the six moods with Any first', () => {
    expect(PICK_MOODS.map((m) => m.id)).toEqual([
      'any',
      'chill',
      'relaxing',
      'short-sweet',
      'challenge',
      'epic',
    ]);
  });

  it('preserves each mood\'s filters + tag exclusions (regression pin)', () => {
    const chill = PICK_MOODS.find((m) => m.id === 'chill')!;
    expect(chill.filters).toEqual({ maxHours: 5 });
    expect(chill.excludeTags).toEqual(['Souls-like', 'Difficult']);

    const relaxing = PICK_MOODS.find((m) => m.id === 'relaxing')!;
    expect(relaxing.filters).toEqual({ maxHours: 20 });
    expect(relaxing.excludeTags).toEqual(['Souls-like', 'Difficult', 'Horror', 'Survival Horror']);

    const epic = PICK_MOODS.find((m) => m.id === 'epic')!;
    expect(epic.filters).toEqual({ minHours: 20, minReview: 80 });

    const any = PICK_MOODS.find((m) => m.id === 'any')!;
    expect(any.filters).toEqual({});
  });
});

describe('the two surfaces are disjoint over one catalog', () => {
  it('presets and moods together account for every pick', () => {
    expect(BACKLOG_PRESETS.length + PICK_MOODS.length).toBe(BACKLOG_PICKS.length);
  });
});
