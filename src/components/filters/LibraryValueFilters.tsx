'use client';

import type { GameFilters as GameFiltersType } from '@/types';
import type { ValueReceivedTier } from '@/lib/scoring/valueReceived';

/** Value Received tiers, best → worst — labels match the dashboard donut legend. */
const TIER_OPTIONS: Array<{ value: ValueReceivedTier; label: string }> = [
  { value: 'exceeded', label: 'Value Exceeded' },
  { value: 'realized', label: 'Value Realized' },
  { value: 'approaching', label: 'Approaching' },
  { value: 'unrealized', label: 'Unrealized' },
];

const SELECT_CLASS =
  'w-full px-2 py-2.5 rounded-md bg-background border border-input text-sm';

interface LibraryValueFiltersProps {
  filters: GameFiltersType;
  onChange: (filters: GameFiltersType) => void;
}

/**
 * Owned-library value filters — the surface that lets the library lead with realized value.
 * All three controls select on what {@link calculateValueReceived} / getValueReceivedOverview
 * already compute (rating presence, tier, realized $/hr); none introduce new scoring.
 */
export function LibraryValueFilters({ filters, onChange }: LibraryValueFiltersProps) {
  // "Realized $/hr" is a sort, not a WHERE filter: asc = best ROI first, desc = worst.
  const roiValue =
    filters.sortBy === 'realizedDollarsPerHour'
      ? filters.sortOrder === 'asc'
        ? 'best'
        : 'worst'
      : '';

  const ratedValue = filters.rated === undefined ? '' : filters.rated ? 'rated' : 'unrated';

  return (
    <div className="rounded-xl bg-card p-3">
      <div className="flex items-center gap-2 mb-2.5">
        <span className="text-[10px] font-label font-semibold uppercase tracking-[0.15em] text-primary">
          Value Received
        </span>
        <span className="text-[11px] text-muted-foreground">Focus your library by what you got back</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {/* Rating presence */}
        <div className="space-y-1">
          <label htmlFor="filter-rated" className="text-xs font-medium text-muted-foreground">
            Rating
          </label>
          <select
            id="filter-rated"
            value={ratedValue}
            onChange={(e) =>
              onChange({
                ...filters,
                rated: e.target.value === '' ? undefined : e.target.value === 'rated',
              })
            }
            className={SELECT_CLASS}
          >
            <option value="">All games</option>
            <option value="rated">Rated only</option>
            <option value="unrated">Unrated only</option>
          </select>
        </div>

        {/* Value Received tier */}
        <div className="space-y-1">
          <label htmlFor="filter-value-tier" className="text-xs font-medium text-muted-foreground">
            Value tier
          </label>
          <select
            id="filter-value-tier"
            value={filters.valueReceivedTier ?? ''}
            onChange={(e) =>
              onChange({
                ...filters,
                valueReceivedTier: e.target.value
                  ? (e.target.value as ValueReceivedTier)
                  : undefined,
              })
            }
            className={SELECT_CLASS}
          >
            <option value="">All value</option>
            {TIER_OPTIONS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>

        {/* Realized $/hr — best/worst (a sort shortcut over the existing realized $/hr column) */}
        <div className="space-y-1">
          <label htmlFor="filter-realized-dph" className="text-xs font-medium text-muted-foreground">
            Realized $/hr
          </label>
          <select
            id="filter-realized-dph"
            value={roiValue}
            onChange={(e) => {
              const val = e.target.value;
              if (val === 'best') {
                onChange({ ...filters, sortBy: 'realizedDollarsPerHour', sortOrder: 'asc' });
              } else if (val === 'worst') {
                onChange({ ...filters, sortBy: 'realizedDollarsPerHour', sortOrder: 'desc' });
              } else {
                // Back to the page default: lead with overall Value Received.
                onChange({ ...filters, sortBy: 'valueReceived', sortOrder: 'desc' });
              }
            }}
            className={SELECT_CLASS}
          >
            <option value="">Default order</option>
            <option value="best">Best value first</option>
            <option value="worst">Worst value first</option>
          </select>
        </div>
      </div>
    </div>
  );
}
