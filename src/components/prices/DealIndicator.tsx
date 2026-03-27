/**
 * DealIndicator - Visual badge showing deal quality.
 *
 * Color-coded by rating:
 * - Excellent (teal): At/near ATL, great value
 * - Great (green): Good discount, solid value
 * - Good (yellow): Decent deal
 * - Okay (amber): Moderate deal
 * - Poor (red): Not a good time to buy
 */
interface DealIndicatorProps {
  rating: 'excellent' | 'great' | 'good' | 'okay' | 'poor';
  score?: number;
  compact?: boolean;
  lowConfidence?: boolean;
}

const ratingConfig = {
  excellent: { bg: 'bg-deal-great', label: 'Excellent Deal' },
  great: { bg: 'bg-deal-good', label: 'Great Deal' },
  good: { bg: 'bg-deal-okay', label: 'Good Deal' },
  okay: { bg: 'bg-orange-600', label: 'Okay Deal' },
  poor: { bg: 'bg-deal-poor/80', label: 'Poor Deal' },
};

export function DealIndicator({ rating, score, compact = false, lowConfidence = false }: DealIndicatorProps) {
  const config = ratingConfig[rating];
  const confidenceNote = lowConfidence ? ' — Limited data, score may be inaccurate' : '';

  if (compact) {
    return (
      <span
        className={`inline-block w-2.5 h-2.5 rounded-full ${config.bg}${lowConfidence ? ' border border-dashed border-white/40' : ''}`}
        title={`${config.label}${score !== undefined ? ` (${score})` : ''}${confidenceNote}`}
      />
    );
  }

  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-label font-bold text-white ${config.bg}${lowConfidence ? ' border border-dashed border-white/40' : ''}`}
      title={`${score !== undefined ? `Deal Score: ${score}/100 — based on price vs ATL, reviews, $/hr, and interest` : config.label}${confidenceNote}`}
    >
      <span>{config.label}</span>
    </span>
  );
}
