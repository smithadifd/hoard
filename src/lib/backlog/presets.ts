import type { GameFilters } from '@/types';

export interface BacklogPreset {
  id: string;
  label: string;
  description: string;
  icon: string; // lucide icon name
  filters: Partial<GameFilters>;
}

export const BACKLOG_PRESETS: BacklogPreset[] = [
  {
    id: 'date-night',
    label: 'Date Night',
    description: 'Co-op games under 10 hours',
    icon: 'heart',
    filters: {
      coop: true,
      maxHours: 10,
      playtimeStatus: 'unplayed',
    },
  },
  {
    id: 'quick-play',
    label: 'Quick Play',
    description: 'Short, well-reviewed games',
    icon: 'zap',
    filters: {
      maxHours: 5,
      minReview: 80,
      playtimeStatus: 'unplayed',
    },
  },
  {
    id: 'deep-dive',
    label: 'Deep Dive',
    description: 'Long, acclaimed adventures',
    icon: 'compass',
    filters: {
      minHours: 40,
      minReview: 80,
      playtimeStatus: 'unplayed',
    },
  },
  {
    id: 'hidden-gems',
    label: 'Hidden Gems',
    description: 'Unplayed games with great reviews',
    icon: 'gem',
    filters: {
      minReview: 85,
      playtimeStatus: 'unplayed',
    },
  },
];
