import { Check, X } from 'lucide-react';
import type { EnrichedGame } from '@/types';
import { valueReceivedTierLabel } from '@/lib/scoring/valueReceived';
import type { ValueReceivedTier } from '@/lib/scoring/valueReceived';

/**
 * ValueReceivedBreakdown - Detail-page card explaining the Value Received score
 * for an owned game. The backward-looking mirror of ScoreBreakdown.
 */
const tierTextColor: Record<ValueReceivedTier, string> = {
  exceeded: 'text-deal-great',
  realized: 'text-deal-good',
  approaching: 'text-yellow-500',
  unrealized: 'text-muted-foreground',
};

const tierBarColor: Record<ValueReceivedTier, string> = {
  exceeded: 'bg-deal-great',
  realized: 'bg-deal-good',
  approaching: 'bg-deal-okay',
  unrealized: 'bg-muted-foreground/40',
};

export function ValueReceivedBreakdown({ game }: { game: EnrichedGame }) {
  const tier = game.valueReceivedTier;
  if (!tier) return null;

  const lens = game.valueReceivedLens ?? 'time';
  const hoursPlayed = Math.round((game.playtimeMinutes / 60) * 10) / 10;

  // No honest baseline: played, but no HLTB estimate and no recorded price. Don't
  // claim a value tier — explain what's missing and how to unlock the grade.
  if (lens === 'none') {
    return (
      <div className="rounded-xl bg-card p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-label font-semibold uppercase tracking-widest text-muted-foreground">
            Value Received
          </h3>
          <span className="text-sm font-bold text-muted-foreground">No estimate</span>
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Playtime</span>
          <span className="font-label font-medium tabular-nums">{hoursPlayed}h</span>
        </div>
        <p className="text-[10px] text-muted-foreground/60 pt-1">
          No HowLongToBeat main-story estimate and no recorded price, so there&apos;s no honest
          baseline to grade value against. Add a duration or what you paid to score this game.
        </p>
      </div>
    );
  }

  const completionRatio = game.completionRatio ?? 0;
  const pct = Math.round(completionRatio * 100);
  const hasHltb = game.hltbMain !== undefined && game.hltbMain > 0;
  const barWidth = Math.min(100, Math.max(completionRatio * 100, 2));
  const isMoney = lens === 'money' && game.realizedDollarsPerHour !== undefined;

  return (
    <div className="rounded-xl bg-card p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-label font-semibold uppercase tracking-widest text-muted-foreground">
          Value Received
        </h3>
        <span className={`text-sm font-bold ${tierTextColor[tier]}`}>{valueReceivedTierLabel(tier)}</span>
      </div>

      {/* Playtime vs HLTB main story */}
      {hasHltb ? (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Playtime vs main story</span>
            <span className="font-label font-medium tabular-nums">
              {hoursPlayed}h / {game.hltbMain}h ({pct}%)
            </span>
          </div>
          <div className="h-2 rounded-full bg-secondary overflow-hidden">
            <div className={`h-full rounded-full ${tierBarColor[tier]}`} style={{ width: `${barWidth}%` }} />
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Playtime</span>
          <span className="font-label font-medium tabular-nums">
            {hoursPlayed}h <span className="text-muted-foreground/60">(no duration data)</span>
          </span>
        </div>
      )}

      {/* Money lens — realized $/hr vs the per-review-tier target */}
      {isMoney && (
        <div className="space-y-1.5 pt-1">
          {game.pricePaid !== undefined && (
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">You paid</span>
              <span className="font-label font-medium tabular-nums">${game.pricePaid.toFixed(2)}</span>
            </div>
          )}
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Realized value</span>
            <span className="font-label font-medium tabular-nums">${game.realizedDollarsPerHour!.toFixed(2)}/hr</span>
          </div>
          {game.hoursToBreakEven !== undefined && (
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Break-even at</span>
              <span className="font-label font-medium tabular-nums">{game.hoursToBreakEven}h played</span>
            </div>
          )}
          {game.receivedExpectedValue !== undefined && (
            <div
              className={`flex items-center gap-1.5 text-xs pt-0.5 ${game.receivedExpectedValue ? 'text-deal-good' : 'text-muted-foreground'}`}
            >
              {game.receivedExpectedValue ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
              <span>{game.receivedExpectedValue ? 'Received expected value' : 'Expected value not yet reached'}</span>
            </div>
          )}
        </div>
      )}

      <p className="text-[10px] text-muted-foreground/60 pt-1">
        {isMoney
          ? 'Realized $/hr graded against your per-review-tier target. Price paid is what you entered (assumed USD).'
          : 'Based on playtime vs HowLongToBeat main story. Add what you paid to grade realized $/hr.'}
      </p>
    </div>
  );
}
