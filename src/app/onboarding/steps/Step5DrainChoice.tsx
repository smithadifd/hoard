'use client';

import { useState } from 'react';
import { Clock, DollarSign, Loader2, MoonStar, Sparkles } from 'lucide-react';
import { StepLayout, PrimaryButton, SecondaryButton } from '../StepLayout';
import { useApiMutation } from '@/hooks/useApiMutation';
import type { DrainMode, DrainProgress } from '@/lib/onboarding/types';
import type { StepProps } from '../OnboardingWizard';

export function Step5DrainChoice({ step, totalSteps, shared, onNext, onBack }: StepProps) {
  const itadAvailable = shared.itadApiKey.trim().length > 0;
  const libSize = Math.max(shared.libraryCount, shared.steamGameCount ?? 0);

  // Default to Lite when ITAD is missing (Full requires it), Full otherwise.
  const [selected, setSelected] = useState<DrainMode>(itadAvailable ? 'full' : 'lite');

  const start = useApiMutation<{ mode: DrainMode }, { data: DrainProgress }>(
    '/api/onboarding/drain',
    {
      onSuccess: () => {
        onNext();
      },
    },
  );

  const handleStart = () => {
    void start.mutate({ mode: selected });
  };

  const estimates = computeEstimates(libSize);

  return (
    <StepLayout
      step={step}
      totalSteps={totalSteps}
      title="Pick a starting strategy"
      subtitle={`You have roughly ${libSize.toLocaleString()} games. Choose how aggressively to enrich them now — anything you skip will trickle in via nightly cron.`}
      footer={
        <>
          <SecondaryButton onClick={onBack} disabled={start.isPending}>
            Back
          </SecondaryButton>
          <PrimaryButton onClick={handleStart} disabled={start.isPending}>
            {start.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Starting…
              </>
            ) : selected === 'cron-only' ? (
              'Skip drain & finish'
            ) : (
              'Start drain'
            )}
          </PrimaryButton>
        </>
      }
    >
      <ModeCard
        icon={<Sparkles className="h-4 w-4" />}
        title="Full"
        selected={selected === 'full'}
        onClick={() => itadAvailable && setSelected('full')}
        disabled={!itadAvailable}
        estimate={estimates.full}
        body={
          itadAvailable
            ? 'Prices, metadata, play-time estimates, and reviews. Best fit if you want to start triaging right away.'
            : 'Requires an IsThereAnyDeal API key. Go back to step 3 to add one.'
        }
      />
      <ModeCard
        icon={<DollarSign className="h-4 w-4" />}
        title="Lite"
        selected={selected === 'lite'}
        onClick={() => setSelected('lite')}
        estimate={estimates.lite}
        body="Prices and metadata only. Skips play-time and reviews — cron will fill those in over the next week."
      />
      <ModeCard
        icon={<MoonStar className="h-4 w-4" />}
        title="Cron only"
        selected={selected === 'cron-only'}
        onClick={() => setSelected('cron-only')}
        estimate={{ wall: 'instant', api: 'no calls now' }}
        body="Don't drain anything now — let scheduled cron catch up overnight. Charts and scores stay empty for ~1 week."
      />

      {start.error && (
        <p className="text-sm text-destructive">{start.error}</p>
      )}
    </StepLayout>
  );
}

function ModeCard({
  icon,
  title,
  body,
  selected,
  disabled,
  estimate,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  selected: boolean;
  disabled?: boolean;
  estimate: { wall: string; api: string };
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`w-full text-left rounded-lg border p-4 transition-colors ${
        disabled
          ? 'border-white/[0.04] bg-background/20 opacity-50 cursor-not-allowed'
          : selected
          ? 'border-primary/60 bg-primary/[0.08]'
          : 'border-white/[0.08] bg-background/40 hover:bg-white/[0.04]'
      }`}
    >
      <div className="flex items-center gap-2 mb-1.5">
        <span className={selected ? 'text-primary' : 'text-muted-foreground'}>{icon}</span>
        <span className="text-sm font-headline font-bold">{title}</span>
        <span className="ml-auto inline-flex items-center gap-1 text-[10px] font-label font-semibold uppercase tracking-[0.15em] text-muted-foreground">
          <Clock className="h-3 w-3" />
          {estimate.wall} · {estimate.api}
        </span>
      </div>
      <p className="text-xs text-muted-foreground leading-snug">{body}</p>
    </button>
  );
}

function computeEstimates(libSize: number) {
  // Rough heuristics — these are sticker-shock numbers, not promises.
  // Full: ~1s/game ITAD + ~3s/game metadata + ~1s × 300 HLTB + ~3s/game reviews
  const fullSec =
    libSize * 1 + libSize * 3 + Math.min(libSize, 300) * 1 + libSize * 3;
  const liteSec = libSize * 1 + libSize * 3;

  return {
    full: {
      wall: formatMin(fullSec),
      api: `≈${approximate(libSize * 7 + Math.min(libSize, 300))} calls`,
    },
    lite: {
      wall: formatMin(liteSec),
      api: `≈${approximate(libSize * 3)} calls`,
    },
  };
}

function formatMin(seconds: number): string {
  const mins = Math.max(1, Math.round(seconds / 60));
  if (mins < 60) return `~${mins} min`;
  const hours = Math.round((mins / 60) * 10) / 10;
  return `~${hours} hr`;
}

function approximate(n: number): string {
  if (n < 100) return String(n);
  if (n < 1000) return `${Math.round(n / 10) * 10}`;
  return `${(n / 1000).toFixed(1)}k`;
}
