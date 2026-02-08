/**
 * DealIndicator - Visual badge showing deal quality.
 *
 * Color-coded by rating:
 * - Excellent (green): At/near ATL, great value
 * - Great (lime): Good discount, solid value
 * - Good (yellow): Decent deal
 * - Okay (orange): Moderate deal
 * - Poor (red): Not a good time to buy
 */
interface DealIndicatorProps {
  rating: 'excellent' | 'great' | 'good' | 'okay' | 'poor';
  score?: number;
  compact?: boolean;
}

const ratingConfig = {
  excellent: { bg: 'bg-deal-great', label: 'Excellent Deal' },
  great: { bg: 'bg-deal-good', label: 'Great Deal' },
  good: { bg: 'bg-yellow-600', label: 'Good Deal' },
  okay: { bg: 'bg-orange-600', label: 'Okay Deal' },
  poor: { bg: 'bg-deal-poor', label: 'Poor Deal' },
};

export function DealIndicator({ rating, score, compact = false }: DealIndicatorProps) {
  const config = ratingConfig[rating];

  if (compact) {
    return (
      <span
        className={`inline-block w-2.5 h-2.5 rounded-full ${config.bg}`}
        title={`${config.label}${score !== undefined ? ` (${score})` : ''}`}
      />
    );
  }

  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-bold text-white ${config.bg}`}
      title={score !== undefined ? `Deal Score: ${score}/100 — based on price vs ATL, reviews, $/hr, and interest` : config.label}
    >
      <span>{config.label}</span>
    </span>
  );
}
