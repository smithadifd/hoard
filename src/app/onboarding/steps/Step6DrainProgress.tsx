'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock, Loader2, Pause, X } from 'lucide-react';
import { StepLayout, PrimaryButton, SecondaryButton } from '../StepLayout';
import type { DrainProgress, DrainStage } from '@/lib/onboarding/types';
import type { StepProps } from '../OnboardingWizard';

const POLL_INTERVAL_MS = 2000;

const STAGE_LABELS: Record<DrainStage, string> = {
  'price-history': 'Prices',
  metadata: 'Metadata',
  hltb: 'Play-time (HLTB)',
  reviews: 'Reviews',
};

export function Step6DrainProgress({ step, totalSteps, onNext, onBack }: StepProps) {
  const [progress, setProgress] = useState<DrainProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pollOnce = useCallback(async () => {
    try {
      const res = await fetch('/api/onboarding/drain');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: { data: DrainProgress } = await res.json();
      setProgress(json.data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Polling failed');
    }
  }, []);

  // Poll loop — schedules the next tick after each fetch resolves so we never
  // overlap requests on a slow connection.
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      await pollOnce();
      if (cancelled) return;
      timerRef.current = setTimeout(tick, POLL_INTERVAL_MS);
    };
    void tick();
    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [pollOnce]);

  const handleCancel = useCallback(async () => {
    setCancelling(true);
    try {
      await fetch('/api/onboarding/drain', { method: 'DELETE' });
      await pollOnce();
    } finally {
      setCancelling(false);
    }
  }, [pollOnce]);

  const isComplete = progress?.completedAt != null;
  const isPaused = progress?.paused === true;
  const isRunning = progress?.running === true;

  const stagesInOrder: DrainStage[] = ['price-history', 'metadata', 'hltb', 'reviews'];

  return (
    <StepLayout
      step={step}
      totalSteps={totalSteps}
      title={isComplete ? 'Drain complete' : isPaused ? 'Drain paused' : 'Enriching your library'}
      subtitle={
        isComplete
          ? 'Every stage finished. Your dashboard is ready.'
          : isPaused
          ? 'We hit a snag and paused. See below — you can resume from Settings → Onboarding later, or wait for cron to pick up the rest.'
          : "You can close this tab — the drain runs server-side. We'll send a Discord ping when it finishes (if you wired up the deals webhook)."
      }
      footer={
        <>
          <SecondaryButton onClick={onBack} disabled={isRunning}>
            Back
          </SecondaryButton>
          {isComplete ? (
            <PrimaryButton onClick={onNext}>Continue</PrimaryButton>
          ) : isPaused ? (
            <PrimaryButton onClick={onNext}>Finish setup anyway</PrimaryButton>
          ) : (
            <SecondaryButton onClick={handleCancel} disabled={cancelling || !isRunning}>
              {cancelling ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Cancelling…
                </>
              ) : (
                <>
                  <X className="mr-2 h-4 w-4" /> Cancel
                </>
              )}
            </SecondaryButton>
          )}
        </>
      }
    >
      {progress?.mode === 'cron-only' ? (
        <div className="rounded-md border border-white/[0.06] bg-background/40 p-3 text-sm">
          <p>
            You picked <strong>Cron only</strong> — nothing to drain right now. Hit <em>Continue</em>{' '}
            to finish setup. Nightly cron will enrich data over the next ~1 week.
          </p>
        </div>
      ) : (
        stagesInOrder
          .filter((stage) => progress?.stages[stage] && progress.stages[stage].total > 0)
          .map((stage) => (
            <StageRow
              key={stage}
              label={STAGE_LABELS[stage]}
              active={progress?.stage === stage && isRunning}
              done={
                progress != null &&
                progress.stage !== stage &&
                progress.stages[stage].processed > 0
              }
              processed={progress?.stages[stage].processed ?? 0}
              total={progress?.stages[stage].total ?? 0}
            />
          ))
      )}

      {/* When nothing has happened yet, show all four planned stages as pending. */}
      {progress?.mode !== 'cron-only' &&
        progress?.overallProcessed === 0 &&
        !isComplete &&
        !isPaused && (
          <div className="rounded-md border border-white/[0.06] bg-background/40 p-3 text-sm text-muted-foreground">
            <Loader2 className="inline-block h-3.5 w-3.5 mr-2 animate-spin text-primary" />
            Spinning up the drain orchestrator…
          </div>
        )}

      {isPaused && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
          <div className="flex items-start gap-2">
            {progress?.pauseReason === 'rate-limit' ? (
              <Pause className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
            ) : (
              <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
            )}
            <div>
              <p className="font-medium">
                {progress?.pauseReason === 'rate-limit'
                  ? 'Upstream API rate-limited us'
                  : 'You cancelled the drain'}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {progress?.pauseReason === 'rate-limit' && progress.pausedUntil && (
                  <>
                    Paused until {new Date(progress.pausedUntil).toLocaleString()}. Cron will resume
                    enrichment overnight.
                  </>
                )}
                {progress?.pauseReason === 'manual' && (
                  <>You can pick up later from Settings → Onboarding.</>
                )}
              </p>
            </div>
          </div>
        </div>
      )}

      {isComplete && (
        <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm">
          <div className="flex items-start gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />
            <p>
              Drain finished at{' '}
              <strong>
                {progress?.completedAt
                  ? new Date(progress.completedAt).toLocaleTimeString()
                  : 'just now'}
              </strong>
              . Your library has fresh prices, metadata, and (in Full mode) play-time estimates.
            </p>
          </div>
        </div>
      )}

      {error && !isComplete && (
        <p className="text-xs text-muted-foreground inline-flex items-center gap-1">
          <Clock className="h-3 w-3" /> Retrying poll in {Math.round(POLL_INTERVAL_MS / 1000)}s…
        </p>
      )}
    </StepLayout>
  );
}

function StageRow({
  label,
  active,
  done,
  processed,
  total,
}: {
  label: string;
  active: boolean;
  done: boolean;
  processed: number;
  total: number;
}) {
  const percent = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0;
  return (
    <div className="rounded-lg bg-background/40 border border-white/[0.04] p-4">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-sm font-medium">{label}</span>
        <span className="ml-auto text-xs text-muted-foreground">
          {done ? `${processed.toLocaleString()} done` : `${processed}/${total || '?'}`}
        </span>
        {active && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
        {done && <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
      </div>
      <div className="h-1 rounded-full bg-white/[0.06] overflow-hidden">
        <div
          className="h-full bg-primary transition-all duration-500"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
