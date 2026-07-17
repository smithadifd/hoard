import type { GameFilters } from '@/types';

/**
 * ONE source of truth for the backlog's curated picks (Queue S S9 step d).
 *
 * Historically these lived in two disjoint places: the six server-side
 * `BACKLOG_PRESETS` (the backlog page's filter chips) and a separate hard-coded
 * `MOODS` array inside PickForMePanel (the "Pick For Me" client surface). That
 * split meant two lists to keep in sync and two mental models. They're unified
 * here: `BACKLOG_PICKS` is the single catalog, and each pick declares which
 * `surfaces` it appears on. The old `BACKLOG_PRESETS` / new `PICK_MOODS` exports
 * are thin, behaviour-preserving views over it.
 */

export type BacklogSurface = 'preset' | 'mood';

export interface BacklogPick {
  id: string;
  label: string;
  description: string;
  /** lucide icon key (mapped to a component at each surface). */
  icon: string;
  /** Which surfaces this pick appears on. */
  surfaces: BacklogSurface[];
  filters: Partial<GameFilters>;
  /** Tag exclusions (used by the Pick-For-Me mood filter). */
  excludeTags?: string[];
}

export const BACKLOG_PICKS: BacklogPick[] = [
  // ---- Preset chips (server-side filter presets) ----
  {
    id: 'date-night',
    label: 'Date Night',
    description: 'Co-op games under 10 hours — perfect for playing together',
    icon: 'heart',
    surfaces: ['preset'],
    filters: {
      coop: true,
      maxHours: 10,
      playtimeStatus: 'backlog',
      strictFilters: true,
    },
  },
  {
    id: 'quick-play',
    label: 'Quick Play',
    description: 'Well-reviewed games you can finish in an evening',
    icon: 'zap',
    surfaces: ['preset'],
    filters: {
      maxHours: 5,
      minReview: 75,
      playtimeStatus: 'backlog',
      strictFilters: true,
    },
  },
  {
    id: 'deep-dive',
    label: 'Deep Dive',
    description: 'Epic adventures with 40+ hours of content',
    icon: 'compass',
    surfaces: ['preset'],
    filters: {
      minHours: 40,
      minReview: 75,
      playtimeStatus: 'backlog',
      strictFilters: true,
    },
  },
  {
    id: 'hidden-gems',
    label: 'Hidden Gems',
    description: 'Highly rated games with fewer reviews — overlooked treasures',
    icon: 'gem',
    surfaces: ['preset'],
    filters: {
      minReview: 85,
      maxReviewCount: 5000,
      playtimeStatus: 'backlog',
      strictFilters: true,
    },
  },
  {
    id: 'play-again',
    label: 'Play Again',
    description: 'Games you played a lot but haven\'t touched in a long time — worth revisiting',
    icon: 'rotate-ccw',
    surfaces: ['preset'],
    filters: {
      playtimeStatus: 'play-again',
      sortBy: 'lastPlayed',
      sortOrder: 'asc',
      strictFilters: true,
    },
  },
  {
    id: 'most-value-waiting',
    label: 'Most Value Waiting',
    description: 'Well-reviewed games with the most unplayed content — the biggest value sitting in your backlog',
    icon: 'hourglass',
    surfaces: ['preset'],
    filters: {
      playtimeStatus: 'backlog',
      sortBy: 'valueWaiting',
      sortOrder: 'desc',
      minReview: 70,
      strictFilters: true,
    },
  },

  // ---- Pick-For-Me moods (client-side mood filter over the fetched pool) ----
  {
    id: 'any',
    label: 'Any',
    description: 'Anything in your pool',
    icon: 'shuffle',
    surfaces: ['mood'],
    filters: {},
  },
  {
    id: 'chill',
    label: 'Chill',
    description: 'Short and low-stress',
    icon: 'coffee',
    surfaces: ['mood'],
    filters: { maxHours: 5 },
    excludeTags: ['Souls-like', 'Difficult'],
  },
  {
    id: 'relaxing',
    label: 'Relaxing',
    description: 'Calm, no horror or punishing difficulty',
    icon: 'tree-palm',
    surfaces: ['mood'],
    filters: { maxHours: 20 },
    excludeTags: ['Souls-like', 'Difficult', 'Horror', 'Survival Horror'],
  },
  {
    id: 'short-sweet',
    label: 'Short & Sweet',
    description: 'Under two hours and well reviewed',
    icon: 'sparkles',
    surfaces: ['mood'],
    filters: { maxHours: 2, minReview: 80 },
  },
  {
    id: 'challenge',
    label: 'Challenge',
    description: 'Highly rated — bring your A game',
    icon: 'swords',
    surfaces: ['mood'],
    filters: { minReview: 80 },
  },
  {
    id: 'epic',
    label: 'Epic',
    description: 'Long, acclaimed adventures',
    icon: 'crown',
    surfaces: ['mood'],
    filters: { minHours: 20, minReview: 80 },
  },
];

/** A backlog preset chip. Shape preserved for existing consumers. */
export interface BacklogPreset {
  id: string;
  label: string;
  description: string;
  icon: string; // lucide icon name
  filters: Partial<GameFilters>;
}

/** The six server-side preset chips — a view over BACKLOG_PICKS. */
export const BACKLOG_PRESETS: BacklogPreset[] = BACKLOG_PICKS.filter((p) =>
  p.surfaces.includes('preset'),
).map(({ id, label, description, icon, filters }) => ({ id, label, description, icon, filters }));

/** The Pick-For-Me moods — a view over BACKLOG_PICKS. */
export const PICK_MOODS: BacklogPick[] = BACKLOG_PICKS.filter((p) => p.surfaces.includes('mood'));
