'use client';

import { useState, useCallback, useRef } from 'react';
import { Shuffle, Coffee, Swords, Crown, Sparkles, TreePalm, Loader2 } from 'lucide-react';
import type { EnrichedGame, GameFilters } from '@/types';

interface PickMood {
  id: string;
  label: string;
  icon: React.ReactNode;
  filters: Partial<GameFilters>;
  excludeTags?: string[];
}

const MOODS: PickMood[] = [
  { id: 'any', label: 'Any', icon: <Shuffle className="h-3.5 w-3.5" />, filters: {} },
  {
    id: 'chill',
    label: 'Chill',
    icon: <Coffee className="h-3.5 w-3.5" />,
    filters: { maxHours: 5 },
    excludeTags: ['Souls-like', 'Difficult'],
  },
  {
    id: 'relaxing',
    label: 'Relaxing',
    icon: <TreePalm className="h-3.5 w-3.5" />,
    filters: { maxHours: 20 },
    excludeTags: ['Souls-like', 'Difficult', 'Horror', 'Survival Horror'],
  },
  {
    id: 'short-sweet',
    label: 'Short & Sweet',
    icon: <Sparkles className="h-3.5 w-3.5" />,
    filters: { maxHours: 2, minReview: 80 },
  },
  {
    id: 'challenge',
    label: 'Challenge',
    icon: <Swords className="h-3.5 w-3.5" />,
    filters: { minReview: 80 },
  },
  {
    id: 'epic',
    label: 'Epic',
    icon: <Crown className="h-3.5 w-3.5" />,
    filters: { minHours: 20, minReview: 80 },
  },
];

const TIME_OPTIONS = [
  { id: 'any', label: 'Any', value: undefined },
  { id: '2h', label: '< 2h', value: 2 },
  { id: '5h', label: '< 5h', value: 5 },
  { id: '10h', label: '< 10h', value: 10 },
];

const COOP_OPTIONS = [
  { id: 'either', label: 'Either', value: undefined },
  { id: 'solo', label: 'Solo', value: false },
  { id: 'coop', label: 'Co-op', value: true },
];

export function weightedPick(games: EnrichedGame[]): EnrichedGame {
  const weights = games.map((g) => {
    let w = 1;
    w *= g.personalInterest ?? 3; // Interest: 1-5x
    if (g.dealScore && g.dealScore >= 70) w *= 1.5; // Good deal bonus
    return w;
  });
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  let random = Math.random() * totalWeight;
  for (let i = 0; i < games.length; i++) {
    random -= weights[i];
    if (random <= 0) return games[i];
  }
  return games[games.length - 1];
}

function filterByMood(games: EnrichedGame[], mood: PickMood, timeMax?: number, coop?: boolean): EnrichedGame[] {
  let filtered = [...games];

  // Mood duration filters
  if (mood.filters.maxHours !== undefined) {
    filtered = filtered.filter((g) => g.hltbMain !== undefined && g.hltbMain <= mood.filters.maxHours!);
  }
  if (mood.filters.minHours !== undefined) {
    filtered = filtered.filter((g) => g.hltbMain !== undefined && g.hltbMain >= mood.filters.minHours!);
  }
  if (mood.filters.minReview !== undefined) {
    filtered = filtered.filter((g) => g.reviewScore !== undefined && g.reviewScore >= mood.filters.minReview!);
  }

  // Mood tag exclusions
  if (mood.excludeTags && mood.excludeTags.length > 0) {
    const excluded = new Set(mood.excludeTags.map((t) => t.toLowerCase()));
    filtered = filtered.filter(
      (g) => !g.tags.some((t) => excluded.has(t.toLowerCase()))
    );
  }

  // Time override (only applies if mood doesn't already set a stricter maxHours)
  if (timeMax !== undefined) {
    const moodMax = mood.filters.maxHours;
    const effectiveMax = moodMax !== undefined ? Math.min(moodMax, timeMax) : timeMax;
    filtered = filtered.filter((g) => g.hltbMain !== undefined && g.hltbMain <= effectiveMax);
  }

  // Co-op filter
  if (coop === true) {
    filtered = filtered.filter((g) => g.isCoop);
  } else if (coop === false) {
    filtered = filtered.filter((g) => !g.isCoop);
  }

  return filtered;
}

const PICK_PAGE_SIZE = 100;

function buildFetchUrl(baseFilters: GameFilters, page: number): string {
  const params = new URLSearchParams();
  params.set('pageSize', String(PICK_PAGE_SIZE));
  params.set('page', String(page));
  if (baseFilters.view) params.set('view', baseFilters.view);
  if (baseFilters.search) params.set('search', baseFilters.search);
  if (baseFilters.sortBy) params.set('sortBy', baseFilters.sortBy);
  if (baseFilters.sortOrder) params.set('sortOrder', baseFilters.sortOrder);
  if (baseFilters.playtimeStatus) params.set('playtimeStatus', baseFilters.playtimeStatus);
  if (baseFilters.maxHours !== undefined) params.set('maxHours', String(baseFilters.maxHours));
  if (baseFilters.minHours !== undefined) params.set('minHours', String(baseFilters.minHours));
  if (baseFilters.coop !== undefined) params.set('coop', String(baseFilters.coop));
  if (baseFilters.onSale !== undefined) params.set('onSale', String(baseFilters.onSale));
  if (baseFilters.maxPrice !== undefined) params.set('maxPrice', String(baseFilters.maxPrice));
  if (baseFilters.minReview !== undefined) params.set('minReview', String(baseFilters.minReview));
  if (baseFilters.maxReviewCount !== undefined) params.set('maxReviewCount', String(baseFilters.maxReviewCount));
  if (baseFilters.minInterest !== undefined) params.set('minInterest', String(baseFilters.minInterest));
  if (baseFilters.strictFilters !== undefined) params.set('strictFilters', String(baseFilters.strictFilters));
  if (baseFilters.genres?.length) params.set('genres', baseFilters.genres.join(','));
  if (baseFilters.excludeTags?.length) params.set('excludeTags', baseFilters.excludeTags.join(','));
  return `/api/games?${params.toString()}`;
}

async function fetchAllGames(baseFilters: GameFilters): Promise<EnrichedGame[]> {
  const allGames: EnrichedGame[] = [];
  let page = 1;
  let total = Infinity;
  while (allGames.length < total) {
    const res = await fetch(buildFetchUrl(baseFilters, page));
    if (!res.ok) break;
    const json = await res.json();
    total = json.meta?.total ?? 0;
    const batch = json.data as EnrichedGame[];
    allGames.push(...batch);
    if (batch.length < PICK_PAGE_SIZE) break;
    page++;
  }
  return allGames;
}

interface PickForMePanelProps {
  baseFilters: GameFilters;
  totalCount: number;
  onPick: (pick: EnrichedGame, candidates: EnrichedGame[]) => void;
}

export function PickForMePanel({ baseFilters, totalCount, onPick }: PickForMePanelProps) {
  const [mood, setMood] = useState<string>('any');
  const [time, setTime] = useState<string>('any');
  const [coopSetting, setCoopSetting] = useState<string>('either');
  const [isFetching, setIsFetching] = useState(false);
  const isFetchingRef = useRef(false);

  const handlePick = useCallback(async () => {
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;
    setIsFetching(true);
    try {
      const allGames = await fetchAllGames(baseFilters);
      if (allGames.length === 0) return;

      const selectedMood = MOODS.find((m) => m.id === mood) ?? MOODS[0];
      const timeOption = TIME_OPTIONS.find((t) => t.id === time);
      const coopOption = COOP_OPTIONS.find((c) => c.id === coopSetting);

      const candidates = filterByMood(allGames, selectedMood, timeOption?.value, coopOption?.value);
      if (candidates.length === 0) return;

      const pick = weightedPick(candidates);
      onPick(pick, candidates);
    } finally {
      setIsFetching(false);
      isFetchingRef.current = false;
    }
  }, [baseFilters, mood, time, coopSetting, onPick]);

  return (
    <div className="rounded-xl bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium flex items-center gap-2">
          <Shuffle className="h-4 w-4" />
          Pick For Me
        </h3>
        <span className="text-xs text-muted-foreground">
          {totalCount} game{totalCount !== 1 ? 's' : ''} in pool
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {/* Mood */}
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Mood</label>
          <div className="flex flex-wrap gap-1">
            {MOODS.map((m) => (
              <button
                key={m.id}
                onClick={() => setMood(m.id)}
                className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors ${
                  mood === m.id
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
                }`}
              >
                {m.icon}
                {m.label}
              </button>
            ))}
          </div>
        </div>

        {/* Time */}
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Time</label>
          <div className="flex flex-wrap gap-1">
            {TIME_OPTIONS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTime(t.id)}
                className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                  time === t.id
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Co-op */}
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Co-op</label>
          <div className="flex flex-wrap gap-1">
            {COOP_OPTIONS.map((c) => (
              <button
                key={c.id}
                onClick={() => setCoopSetting(c.id)}
                className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                  coopSetting === c.id
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <button
        onClick={handlePick}
        disabled={totalCount === 0 || isFetching}
        className="w-full px-4 py-2.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px]"
      >
        {isFetching ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Finding a game...
          </>
        ) : (
          <>
            <Shuffle className="h-4 w-4" />
            {totalCount === 0 ? 'No games match' : 'Pick a Game'}
          </>
        )}
      </button>
    </div>
  );
}
