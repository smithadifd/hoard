import type { ValueReceivedTier, ValueReceivedLens } from '@/lib/scoring/valueReceived';
import { valueReceivedTierLabel } from '@/lib/scoring/valueReceived';

/**
 * ValueReceivedIndicator - Owned-game counterpart to DealIndicator.
 *
 * Where DealIndicator answers "is this a good price to buy?", this answers
 * "have I gotten my money's worth?" — colored by how far past expected value
 * the user is (time lens) or how their realized $/hr compares (money lens).
 */
interface ValueReceivedIndicatorProps {
  tier: ValueReceivedTier;
  lens: ValueReceivedLens;
  completionRatio?: number;
  realizedDollarsPerHour?: number;
  hoursPlayed?: number;
  summary?: string;
  /** Post-play rating (1-5). When set, the warm verdict leads instead of the tier. */
  enjoymentRating?: number;
  /** Rating-led verdict headline ("Glad I played it"). */
  headline?: string;
  /** Efficiency qualifier ("paid a premium"), shown only when it would be misread. */
  qualifier?: string;
}

const tierBg: Record<ValueReceivedTier, string> = {
  exceeded: 'bg-deal-great',
  realized: 'bg-deal-good',
  approaching: 'bg-deal-okay',
  unrealized: 'bg-secondary',
};

// Verdict chip color keyed by the rating itself (not the efficiency tier).
function ratingBg(rating: number): string {
  if (rating >= 4) return 'bg-deal-great';
  if (rating === 3) return 'bg-deal-okay';
  return 'bg-secondary';
}

export function ValueReceivedIndicator({
  tier,
  lens,
  completionRatio,
  realizedDollarsPerHour,
  hoursPlayed,
  summary,
  enjoymentRating,
  headline,
  qualifier,
}: ValueReceivedIndicatorProps) {
  // Rated: the warm verdict leads. $/hr / completion are demoted to the tooltip.
  if (enjoymentRating !== undefined && enjoymentRating > 0 && headline) {
    const isMuted = enjoymentRating <= 2;
    const label = qualifier ? `${headline} · ${qualifier}` : headline;
    return (
      <span
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-label font-bold ${isMuted ? 'text-muted-foreground' : 'text-white'} ${ratingBg(enjoymentRating)}`}
        title={summary ?? label}
      >
        <span>{label}</span>
      </span>
    );
  }

  // No honest baseline (played, but no HLTB estimate and no price): show a neutral
  // played-hours chip rather than a value tier we can't actually justify.
  if (lens === 'none') {
    const hrs = hoursPlayed !== undefined ? `Played ${hoursPlayed}h` : 'Played';
    return (
      <span
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-label font-bold text-muted-foreground bg-secondary"
        title="No HowLongToBeat estimate or price recorded — add one to grade value."
      >
        <span>{hrs}</span>
      </span>
    );
  }

  const label = valueReceivedTierLabel(tier);
  const isMuted = tier === 'unrealized';

  const detail =
    lens === 'money' && realizedDollarsPerHour !== undefined
      ? `$${realizedDollarsPerHour.toFixed(2)}/hr`
      : completionRatio !== undefined
        ? `${Math.round(completionRatio * 100)}% of main story`
        : '';

  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-label font-bold ${isMuted ? 'text-muted-foreground' : 'text-white'} ${tierBg[tier]}`}
      title={summary ?? `${label}${detail ? ` — ${detail}` : ''}`}
    >
      <span>{label}</span>
    </span>
  );
}
