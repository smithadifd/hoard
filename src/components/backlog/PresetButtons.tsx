'use client';

import { Heart, Zap, Compass, Gem, RotateCcw } from 'lucide-react';
import { BACKLOG_PRESETS } from '@/lib/backlog/presets';
import type { GameFilters } from '@/types';

const ICON_MAP: Record<string, React.ReactNode> = {
  heart: <Heart className="h-4 w-4" />,
  zap: <Zap className="h-4 w-4" />,
  compass: <Compass className="h-4 w-4" />,
  gem: <Gem className="h-4 w-4" />,
  'rotate-ccw': <RotateCcw className="h-4 w-4" />,
};

interface PresetButtonsProps {
  currentFilters: GameFilters;
  onPresetSelect: (filters: GameFilters) => void;
  presetCounts?: Record<string, number>;
}

function isPresetActive(presetFilters: Partial<GameFilters>, current: GameFilters): boolean {
  for (const [key, value] of Object.entries(presetFilters)) {
    const k = key as keyof GameFilters;
    if (current[k] !== value) return false;
  }
  return true;
}

export function PresetButtons({ currentFilters, onPresetSelect, presetCounts }: PresetButtonsProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {BACKLOG_PRESETS.map((preset) => {
        const active = isPresetActive(preset.filters, currentFilters);
        const count = presetCounts?.[preset.id];
        const isEmpty = count === 0;
        return (
          <button
            key={preset.id}
            onClick={() => {
              if (active) {
                // Deactivate: reset to defaults
                onPresetSelect({ view: 'library', playtimeStatus: 'backlog', strictFilters: true });
              } else {
                onPresetSelect({ view: 'library', ...preset.filters });
              }
            }}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              active
                ? 'bg-primary text-primary-foreground'
                : isEmpty
                  ? 'bg-secondary/50 text-muted-foreground/50 cursor-default'
                  : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
            }`}
            title={preset.description}
          >
            {ICON_MAP[preset.icon]}
            {preset.label}
            {count !== undefined && (
              <span className={`text-xs px-1.5 rounded-full ${
                active
                  ? 'bg-white/20'
                  : isEmpty
                    ? 'bg-muted/50'
                    : 'bg-muted'
              }`}>
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
