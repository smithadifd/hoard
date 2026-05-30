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
  summary?: string;
}

const tierBg: Record<ValueReceivedTier, string> = {
  exceeded: 'bg-deal-great',
  realized: 'bg-deal-good',
  approaching: 'bg-deal-okay',
  unrealized: 'bg-secondary',
};

export function ValueReceivedIndicator({
  tier,
  lens,
  completionRatio,
  realizedDollarsPerHour,
  summary,
}: ValueReceivedIndicatorProps) {
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
