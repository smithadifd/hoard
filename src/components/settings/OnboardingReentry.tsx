'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCcw, Play, RotateCcw, AlertCircle, Loader2 } from 'lucide-react';
import type { OnboardingState, DrainProgress, DrainMode } from '@/lib/onboarding/types';

interface OnboardingReentryProps {
  initialState: OnboardingState;
  initialDrain: DrainProgress;
}

const DRAIN_MODES: Array<{ value: DrainMode; label: string; blurb: string }> = [
  { value: 'full', label: 'Full', blurb: 'Prices + metadata + HLTB + reviews.' },
  { value: 'lite', label: 'Lite', blurb: 'Prices + metadata only — fastest.' },
  { value: 'cron-only', label: 'Cron only', blurb: 'Skip drain — let cron handle it.' },
];

const DEFAULT_STATE = {
  wizardCompletedAt: null,
  steamConnectedAt: null,
  drainStartedAt: null,
  drainCompletedAt: null,
  drainMode: null,
  drainPauseReason: null,
  drainPausedUntil: null,
  checklistDismissed: false,
  triagePromptDismissedAt: null,
} as const;

type ActionMessage = { kind: 'success' | 'error'; text: string } | null;

export function OnboardingReentry({ initialState, initialDrain }: OnboardingReentryProps) {
  const router = useRouter();
  const [state, setState] = useState(initialState);
  const [drainRunning, setDrainRunning] = useState(initialDrain.running);
  const [drainMode, setDrainMode] = useState<DrainMode>('lite');
  const [pendingAction, setPendingAction] = useState<'wizard' | 'drain' | 'reset' | null>(null);
  const [resetConfirm, setResetConfirm] = useState(false);
  const [message, setMessage] = useState<ActionMessage>(null);

  const handleRerunWizard = async () => {
    setPendingAction('wizard');
    setMessage(null);
    try {
      const res = await fetch('/api/onboarding/state', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wizardCompletedAt: null }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setMessage({ kind: 'error', text: data.error ?? 'Failed to reset wizard.' });
        return;
      }
      router.push('/onboarding');
    } finally {
      setPendingAction(null);
    }
  };

  const handleRunDrain = async () => {
    setPendingAction('drain');
    setMessage(null);
    try {
      const res = await fetch('/api/onboarding/drain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: drainMode }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage({ kind: 'error', text: data.error ?? 'Failed to start drain.' });
        return;
      }
      setDrainRunning(true);
      setMessage({
        kind: 'success',
        text:
          drainMode === 'cron-only'
            ? 'Cron-only mode — no drain queued. Cron will continue chewing through the queue on schedule.'
            : 'Drain started — track progress on the dashboard.',
      });
    } finally {
      setPendingAction(null);
    }
  };

  const handleReset = async () => {
    if (!resetConfirm) {
      setResetConfirm(true);
      return;
    }
    setPendingAction('reset');
    setMessage(null);
    try {
      const res = await fetch('/api/onboarding/state', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(DEFAULT_STATE),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setMessage({ kind: 'error', text: data.error ?? 'Failed to reset state.' });
        return;
      }
      const data = await res.json();
      setState(data.data?.state ?? DEFAULT_STATE);
      setResetConfirm(false);
      setMessage({
        kind: 'success',
        text: 'Onboarding state cleared. Your library data is untouched.',
      });
    } finally {
      setPendingAction(null);
    }
  };

  const wizardStatus = state.wizardCompletedAt
    ? `Completed ${new Date(state.wizardCompletedAt).toLocaleDateString()}.`
    : 'Not completed yet.';

  const drainStatus = drainRunning
    ? 'A drain is currently running.'
    : state.drainCompletedAt
      ? `Last drain completed ${new Date(state.drainCompletedAt).toLocaleDateString()}.`
      : state.drainPauseReason === 'rate-limit'
        ? `Paused (rate-limited)${state.drainPausedUntil ? ` until ${new Date(state.drainPausedUntil).toLocaleString()}` : ''}.`
        : state.drainPauseReason === 'manual'
          ? 'Paused (manually cancelled).'
          : 'Never run.';

  return (
    <div className="space-y-6">
      <section className="rounded-xl bg-card p-6 space-y-3">
        <header className="flex items-center gap-2">
          <RefreshCcw className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-lg font-semibold">Re-run setup wizard</h2>
        </header>
        <p className="text-sm text-muted-foreground">
          Walk through the onboarding wizard again. Useful when reconnecting Steam, swapping
          integrations, or just refreshing the time-estimate guidance.
        </p>
        <p className="text-xs text-muted-foreground">{wizardStatus}</p>
        <button
          type="button"
          onClick={handleRerunWizard}
          disabled={pendingAction !== null}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-60 transition-colors"
        >
          {pendingAction === 'wizard' ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCcw className="h-4 w-4" />
          )}
          Re-run wizard
        </button>
      </section>

      <section className="rounded-xl bg-card p-6 space-y-3">
        <header className="flex items-center gap-2">
          <Play className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-lg font-semibold">Run drain again</h2>
        </header>
        <p className="text-sm text-muted-foreground">
          Re-enrich your library — prices, metadata, optionally play-time and reviews. Useful after
          a long absence or once Steam adds new games to your library.
        </p>
        <p className="text-xs text-muted-foreground">{drainStatus}</p>
        <fieldset className="space-y-2">
          <legend className="text-xs font-label font-semibold uppercase tracking-widest text-muted-foreground">
            Mode
          </legend>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {DRAIN_MODES.map((mode) => {
              const active = drainMode === mode.value;
              return (
                <button
                  key={mode.value}
                  type="button"
                  onClick={() => setDrainMode(mode.value)}
                  disabled={pendingAction !== null}
                  className={`text-left rounded-lg border p-3 text-sm transition-colors disabled:opacity-60 ${
                    active
                      ? 'border-primary bg-primary/10'
                      : 'border-white/[0.06] hover:bg-accent/40'
                  }`}
                >
                  <div className="font-medium">{mode.label}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{mode.blurb}</div>
                </button>
              );
            })}
          </div>
        </fieldset>
        <button
          type="button"
          onClick={handleRunDrain}
          disabled={pendingAction !== null || drainRunning}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-60 transition-colors"
        >
          {pendingAction === 'drain' ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Play className="h-4 w-4" />
          )}
          {drainRunning ? 'Drain in progress' : 'Start drain'}
        </button>
      </section>

      <section className="rounded-xl bg-card p-6 space-y-3">
        <header className="flex items-center gap-2">
          <RotateCcw className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-lg font-semibold">Reset onboarding state</h2>
        </header>
        <p className="text-sm text-muted-foreground">
          Wipe wizard progress, drain history, checklist dismissal, and the triage nudge timer.
          Your <strong>library data is untouched</strong> — only the onboarding bookkeeping is
          cleared.
        </p>
        {resetConfirm ? (
          <div className="rounded-md bg-destructive/10 border border-destructive/40 p-3 space-y-2">
            <p className="text-sm">
              This clears wizard, drain, and checklist state. Continue?
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleReset}
                disabled={pendingAction !== null}
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-destructive text-destructive-foreground text-xs font-medium hover:bg-destructive/90 disabled:opacity-60 transition-colors"
              >
                {pendingAction === 'reset' ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RotateCcw className="h-3.5 w-3.5" />
                )}
                Yes, reset
              </button>
              <button
                type="button"
                onClick={() => setResetConfirm(false)}
                disabled={pendingAction !== null}
                className="px-3 py-1.5 rounded-md bg-accent text-xs font-medium hover:bg-accent/80 disabled:opacity-60 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={handleReset}
            disabled={pendingAction !== null}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-accent text-foreground text-sm font-medium hover:bg-accent/80 disabled:opacity-60 transition-colors"
          >
            <RotateCcw className="h-4 w-4" />
            Reset state
          </button>
        )}
      </section>

      {message && (
        <div
          className={`rounded-md border p-3 text-sm flex items-start gap-2 ${
            message.kind === 'success'
              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
              : 'border-destructive/40 bg-destructive/10 text-destructive-foreground'
          }`}
        >
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{message.text}</span>
        </div>
      )}
    </div>
  );
}
