import { Check, X, Star, ArrowRight } from 'lucide-react';
import type { EnrichedGame } from '@/types';
import { valueReceivedTierLabel } from '@/lib/scoring/valueReceived';
import type { ValueReceivedTier } from '@/lib/scoring/valueReceived';

/**
 * ValueReceivedBreakdown - Detail-page card explaining the Value Received score
 * for an owned game. The backward-looking mirror of ScoreBreakdown.
 *
 * Once the user has rated the game, the rating LEADS the verdict (the warm
 * headline) and the efficiency lens ($/hr, completion) is demoted to supporting
 * context below. Unrated games render exactly as before.
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

function StarRow({ value }: { value: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${value} of 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          className={`h-3.5 w-3.5 ${n <= value ? 'fill-yellow-500 text-yellow-500' : 'text-muted-foreground/30'}`}
        />
      ))}
    </span>
  );
}

export function ValueReceivedBreakdown({ game }: { game: EnrichedGame }) {
  const tier = game.valueReceivedTier;
  if (!tier) return null;

  const lens = game.valueReceivedLens ?? 'time';
  const hoursPlayed = Math.round((game.playtimeMinutes / 60) * 10) / 10;

  const rated = game.enjoymentRating !== undefined && game.enjoymentRating > 0;
  const headline = game.valueReceivedHeadline;
  const qualifier = game.valueReceivedQualifier;
  const betPayoff = game.betPayoff;

  // Verdict header — rating-led when rated, else the efficiency tier label
  // (or "No estimate" when there's no honest baseline to grade against).
  const header = (
    <div className="flex items-center justify-between">
      <h3 className="text-xs font-label font-semibold uppercase tracking-widest text-muted-foreground">
        Value Received
      </h3>
      {rated && headline ? (
        <span className="text-sm font-bold text-foreground text-right">
          {headline}
          {qualifier ? <span className="text-muted-foreground font-medium"> · {qualifier}</span> : ''}
        </span>
      ) : lens === 'none' ? (
        <span className="text-sm font-bold text-muted-foreground">No estimate</span>
      ) : (
        <span className={`text-sm font-bold ${tierTextColor[tier]}`}>{valueReceivedTierLabel(tier)}</span>
      )}
    </div>
  );

  // Your rating + "did the bet pay off?" — shown only when rated.
  const ratingBlock = rated && (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">Your rating</span>
        <StarRow value={game.enjoymentRating!} />
      </div>
      {betPayoff && (
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">The bet</span>
          <span className="inline-flex items-center gap-1 font-label font-medium">
            <span className="tabular-nums">wanted {betPayoff.interest}</span>
            <ArrowRight className="h-3 w-3 text-muted-foreground/60" />
            <span className="tabular-nums">got {betPayoff.enjoyment}</span>
            <span className="text-muted-foreground/70"> ({betPayoff.label})</span>
          </span>
        </div>
      )}
    </div>
  );

  // No honest baseline: played, but no HLTB estimate and no recorded price.
  if (lens === 'none') {
    return (
      <div className="rounded-xl bg-card p-5 space-y-3">
        {header}
        {ratingBlock}
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Playtime</span>
          <span className="font-label font-medium tabular-nums">{hoursPlayed}h</span>
        </div>
        <p className="text-[10px] text-muted-foreground/60 pt-1">
          {rated
            ? 'Your rating is the verdict. Add a duration or what you paid for $/hr context.'
            : 'No HowLongToBeat main-story estimate and no recorded price, so there’s no honest baseline to grade value against. Rate it, or add a duration or what you paid.'}
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
      {header}
      {ratingBlock}

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
        {rated
          ? 'Your rating leads the verdict; the figures above are supporting context (the $/hr lens can’t fairly grade a short game you loved).'
          : isMoney
            ? 'Realized $/hr graded against your per-review-tier target. Price paid is what you entered (assumed USD).'
            : 'Based on playtime vs HowLongToBeat main story. Add what you paid to grade realized $/hr, or rate it.'}
      </p>
    </div>
  );
}
