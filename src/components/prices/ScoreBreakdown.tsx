import { AlertTriangle } from 'lucide-react';
import type { DealScore, ScoringWeights } from '@/lib/scoring/types';

interface ScoreBreakdownProps {
  dealScore: DealScore;
  weights: ScoringWeights;
  hasReviewData: boolean;
  hasHltbData: boolean;
}

const ratingLabels: Record<string, string> = {
  excellent: 'Excellent Deal',
  great: 'Great Deal',
  good: 'Good Deal',
  okay: 'Okay Deal',
  poor: 'Poor Deal',
};

const ratingColors: Record<string, string> = {
  excellent: 'text-deal-great',
  great: 'text-deal-good',
  good: 'text-yellow-500',
  okay: 'text-orange-500',
  poor: 'text-deal-poor',
};

function ScoreBar({ score, color }: { score: number; color: string }) {
  return (
    <div className="h-2 flex-1 rounded-full bg-secondary overflow-hidden">
      <div
        className={`h-full rounded-full ${color}`}
        style={{ width: `${Math.max(score, 2)}%` }}
      />
    </div>
  );
}

function getBarColor(score: number): string {
  if (score >= 80) return 'bg-deal-great';
  if (score >= 60) return 'bg-deal-good';
  if (score >= 40) return 'bg-yellow-600';
  if (score >= 20) return 'bg-orange-600';
  return 'bg-deal-poor';
}

export function ScoreBreakdown({ dealScore, weights, hasReviewData, hasHltbData }: ScoreBreakdownProps) {
  const dimensions = [
    {
      label: 'Price vs ATL',
      score: dealScore.priceScore,
      weight: weights.priceWeight,
      noData: false,
    },
    {
      label: 'Reviews',
      score: dealScore.reviewScore,
      weight: weights.reviewWeight,
      noData: !hasReviewData,
    },
    {
      label: 'Value ($/hr)',
      score: dealScore.valueScore,
      weight: weights.valueWeight,
      noData: !hasHltbData,
    },
    {
      label: 'Interest',
      score: dealScore.interestScore,
      weight: weights.interestWeight,
      noData: false,
    },
  ];

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Deal Score Breakdown</h3>
        <span className={`text-sm font-bold ${ratingColors[dealScore.rating] ?? 'text-foreground'}`}>
          {dealScore.overall} — {ratingLabels[dealScore.rating] ?? dealScore.rating}
        </span>
      </div>

      <div className="space-y-2.5">
        {dimensions.map((dim) => (
          <div key={dim.label} className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">{dim.label}</span>
              <div className="flex items-center gap-1.5">
                {dim.noData && (
                  <span className="flex items-center gap-0.5 text-yellow-500">
                    <AlertTriangle className="h-3 w-3" />
                    <span>No data</span>
                  </span>
                )}
                <span className="font-medium tabular-nums w-7 text-right">{dim.score}</span>
                <span className="text-muted-foreground/60 w-10 text-right">
                  ({Math.round(dim.weight * 100)}%)
                </span>
              </div>
            </div>
            <ScoreBar score={dim.score} color={getBarColor(dim.score)} />
          </div>
        ))}
      </div>

      <p className="text-[10px] text-muted-foreground/60 pt-1">
        Score is 0–100. Missing data defaults to neutral (50).
      </p>
    </div>
  );
}
