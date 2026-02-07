'use client';

import { Heart, Zap, Compass, Gem } from 'lucide-react';
import { BACKLOG_PRESETS } from '@/lib/backlog/presets';
import type { GameFilters } from '@/types';

const ICON_MAP: Record<string, React.ReactNode> = {
  heart: <Heart className="h-4 w-4" />,
  zap: <Zap className="h-4 w-4" />,
  compass: <Compass className="h-4 w-4" />,
  gem: <Gem className="h-4 w-4" />,
};

interface PresetButtonsProps {
  currentFilters: GameFilters;
  onPresetSelect: (filters: GameFilters) => void;
}

function isPresetActive(presetFilters: Partial<GameFilters>, current: GameFilters): boolean {
  for (const [key, value] of Object.entries(presetFilters)) {
    const k = key as keyof GameFilters;
    if (current[k] !== value) return false;
  }
  return true;
}

export function PresetButtons({ currentFilters, onPresetSelect }: PresetButtonsProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {BACKLOG_PRESETS.map((preset) => {
        const active = isPresetActive(preset.filters, currentFilters);
        return (
          <button
            key={preset.id}
            onClick={() => {
              if (active) {
                // Deactivate: reset to defaults
                onPresetSelect({ view: 'library', playtimeStatus: 'unplayed' });
              } else {
                onPresetSelect({ view: 'library', ...preset.filters });
              }
            }}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              active
                ? 'bg-steam-blue text-white'
                : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
            }`}
            title={preset.description}
          >
            {ICON_MAP[preset.icon]}
            {preset.label}
          </button>
        );
      })}
    </div>
  );
}
