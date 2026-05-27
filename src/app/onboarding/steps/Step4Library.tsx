'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Heart, Library as LibraryIcon, Loader2, X } from 'lucide-react';
import { StepLayout, PrimaryButton, SecondaryButton } from '../StepLayout';
import { readSSEStream } from '@/lib/utils/sse';
import type { StepProps } from '../OnboardingWizard';

type Phase = 'idle' | 'library' | 'wishlist' | 'done' | 'error';

interface ProgressState {
  phase: Phase;
  message: string;
  processed: number;
  total: number;
  libraryCount: number;
  wishlistCount: number;
  error: string | null;
}

const INITIAL: ProgressState = {
  phase: 'idle',
  message: '',
  processed: 0,
  total: 0,
  libraryCount: 0,
  wishlistCount: 0,
  error: null,
};

export function Step4Library({ step, totalSteps, setShared, onNext, onBack }: StepProps) {
  const [progress, setProgress] = useState<ProgressState>(INITIAL);
  const abortRef = useRef<AbortController | null>(null);

  const runStream = useCallback(
    async (type: 'library' | 'wishlist', signal: AbortSignal): Promise<number> => {
      const res = await fetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type }),
        signal,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Sync failed' }));
        throw new Error(data.error ?? `${type} sync failed`);
      }

      let final = 0;

      await readSSEStream(res, {
        onProgress: ({ processed, total, gameName }) => {
          setProgress((prev) => ({
            ...prev,
            processed,
            total,
            message: gameName ? `${type}: ${gameName}` : `${type}: ${processed}/${total}`,
          }));
        },
        onDone: (gamesProcessed) => {
          final = gamesProcessed;
        },
        onError: (message) => {
          throw new Error(message);
        },
      });

      return final;
    },
    [],
  );

  const runSyncs = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setProgress({ ...INITIAL, phase: 'library', message: 'Pulling owned games…' });

    try {
      const libraryCount = await runStream('library', controller.signal);
      setProgress((prev) => ({
        ...prev,
        phase: 'wishlist',
        libraryCount,
        message: 'Pulling wishlist…',
        processed: 0,
        total: 0,
      }));

      const wishlistCount = await runStream('wishlist', controller.signal);
      setProgress((prev) => ({
        ...prev,
        phase: 'done',
        wishlistCount,
        message: '',
      }));
      setShared({ libraryCount });

      // Stamp steamConnectedAt if it wasn't already set in Step 2 (defensive)
      try {
        await fetch('/api/onboarding/state', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ steamConnectedAt: new Date().toISOString() }),
        });
      } catch {
        // Non-fatal — the validate-steam route already stamps this in the happy path
      }
    } catch (err) {
      if (controller.signal.aborted) {
        setProgress((prev) => ({ ...prev, phase: 'idle', message: 'Cancelled' }));
        return;
      }
      const message = err instanceof Error ? err.message : 'Sync failed';
      setProgress((prev) => ({ ...prev, phase: 'error', error: message }));
    }
  }, [runStream, setShared]);

  // Auto-start on first mount
  useEffect(() => {
    void runSyncs();
    return () => {
      abortRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCancel = () => {
    abortRef.current?.abort();
  };

  const isRunning = progress.phase === 'library' || progress.phase === 'wishlist';
  const isDone = progress.phase === 'done';
  const isError = progress.phase === 'error';

  return (
    <StepLayout
      step={step}
      totalSteps={totalSteps}
      title="Pulling your library"
      subtitle="One-shot import of owned games and wishlist from Steam. Owned games are fast; wishlist items new to Hoard need a Steam details fetch (~3s each) so the count can take a few minutes if you've never synced."
      footer={
        <>
          <SecondaryButton onClick={onBack} disabled={isRunning}>
            Back
          </SecondaryButton>
          {isDone ? (
            <PrimaryButton onClick={onNext}>Continue</PrimaryButton>
          ) : isError ? (
            <PrimaryButton onClick={runSyncs}>Retry</PrimaryButton>
          ) : (
            <SecondaryButton onClick={handleCancel} disabled={!isRunning}>
              <X className="mr-2 h-4 w-4" /> Cancel
            </SecondaryButton>
          )}
        </>
      }
    >
      <ProgressRow
        icon={<LibraryIcon className="h-4 w-4" />}
        label="Owned games"
        active={progress.phase === 'library'}
        done={progress.phase !== 'library' && progress.phase !== 'idle' && progress.libraryCount > 0}
        count={progress.libraryCount}
        processed={progress.phase === 'library' ? progress.processed : 0}
        total={progress.phase === 'library' ? progress.total : 0}
      />
      <ProgressRow
        icon={<Heart className="h-4 w-4" />}
        label="Wishlist"
        active={progress.phase === 'wishlist'}
        done={progress.phase === 'done'}
        count={progress.wishlistCount}
        processed={progress.phase === 'wishlist' ? progress.processed : 0}
        total={progress.phase === 'wishlist' ? progress.total : 0}
      />

      {progress.message && (
        <p className="text-xs text-muted-foreground truncate">{progress.message}</p>
      )}

      {isError && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {progress.error}
        </div>
      )}

      {isDone && (
        <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm">
          <div className="flex items-start gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />
            <p>
              Imported <strong>{progress.libraryCount.toLocaleString()}</strong> owned games and{' '}
              <strong>{progress.wishlistCount.toLocaleString()}</strong> wishlist items. Hit{' '}
              <em>Continue</em> to choose how to enrich them.
            </p>
          </div>
        </div>
      )}
    </StepLayout>
  );
}

function ProgressRow({
  icon,
  label,
  active,
  done,
  count,
  processed,
  total,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  done: boolean;
  count: number;
  processed: number;
  total: number;
}) {
  const percent = total > 0 ? Math.round((processed / total) * 100) : done ? 100 : 0;
  return (
    <div className="rounded-lg bg-background/40 border border-white/[0.04] p-4">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-primary">{icon}</span>
        <span className="text-sm font-medium">{label}</span>
        <span className="ml-auto text-xs text-muted-foreground">
          {done ? `${count.toLocaleString()} synced` : active ? `${processed}/${total || '?'}` : '—'}
        </span>
        {active && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
        {done && <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
      </div>
      <div className="h-1 rounded-full bg-white/[0.06] overflow-hidden">
        <div
          className="h-full bg-primary transition-all duration-300"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
