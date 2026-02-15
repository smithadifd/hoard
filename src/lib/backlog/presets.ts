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
    description: 'Co-op games under 10 hours — perfect for playing together',
    icon: 'heart',
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
    filters: {
      minReview: 85,
      maxReviewCount: 5000,
      playtimeStatus: 'backlog',
      strictFilters: true,
    },
  },
];
