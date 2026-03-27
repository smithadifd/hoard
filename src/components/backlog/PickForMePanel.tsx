'use client';

import { useState, useCallback } from 'react';
import { Shuffle, Coffee, Swords, Crown } from 'lucide-react';
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

interface PickForMePanelProps {
  games: EnrichedGame[];
  onPick: (pick: EnrichedGame, candidates: EnrichedGame[]) => void;
}

export function PickForMePanel({ games, onPick }: PickForMePanelProps) {
  const [mood, setMood] = useState<string>('any');
  const [time, setTime] = useState<string>('any');
  const [coopSetting, setCoopSetting] = useState<string>('either');

  const handlePick = useCallback(() => {
    const selectedMood = MOODS.find((m) => m.id === mood) ?? MOODS[0];
    const timeOption = TIME_OPTIONS.find((t) => t.id === time);
    const coopOption = COOP_OPTIONS.find((c) => c.id === coopSetting);

    const candidates = filterByMood(games, selectedMood, timeOption?.value, coopOption?.value);
    if (candidates.length === 0) return;

    const pick = weightedPick(candidates);
    onPick(pick, candidates);
  }, [games, mood, time, coopSetting, onPick]);

  const selectedMood = MOODS.find((m) => m.id === mood) ?? MOODS[0];
  const timeOption = TIME_OPTIONS.find((t) => t.id === time);
  const coopOption = COOP_OPTIONS.find((c) => c.id === coopSetting);
  const candidateCount = filterByMood(games, selectedMood, timeOption?.value, coopOption?.value).length;

  return (
    <div className="rounded-xl bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium flex items-center gap-2">
          <Shuffle className="h-4 w-4" />
          Pick For Me
        </h3>
        <span className="text-xs text-muted-foreground">
          {candidateCount} game{candidateCount !== 1 ? 's' : ''} in pool
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
        disabled={candidateCount === 0}
        className="w-full px-4 py-2.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px]"
      >
        <Shuffle className="h-4 w-4" />
        {candidateCount === 0 ? 'No games match' : 'Pick a Game'}
      </button>
    </div>
  );
}
