'use client';

import { useState } from 'react';
import { AlertCircle, CheckCircle2, ExternalLink, Loader2 } from 'lucide-react';
import { StepLayout, PrimaryButton, SecondaryButton } from '../StepLayout';
import { useApiMutation } from '@/hooks/useApiMutation';
import type { StepProps } from '../OnboardingWizard';

interface ProbeResponse {
  ok: boolean;
  gameCount?: number;
  profileVisible?: boolean;
  message?: string;
}

export function Step2Steam({ step, totalSteps, shared, setShared, onNext, onBack }: StepProps) {
  const [result, setResult] = useState<ProbeResponse | null>(null);
  const probe = useApiMutation<
    { steamApiKey: string; steamUserId: string },
    { data: ProbeResponse }
  >('/api/onboarding/validate-steam', {
    onSuccess: (data) => {
      setResult(data.data);
      if (data.data.ok) {
        setShared({ steamGameCount: data.data.gameCount ?? null });
      }
    },
  });

  const handleValidate = async () => {
    setResult(null);
    const data = await probe.mutate({
      steamApiKey: shared.steamApiKey.trim(),
      steamUserId: shared.steamUserId.trim(),
    });
    if (data?.data.ok) {
      // small UX delay so the success state is visible before advancing
      setTimeout(onNext, 600);
    }
  };

  const canSubmit =
    shared.steamApiKey.trim().length > 0 &&
    /^\d{17}$/.test(shared.steamUserId.trim()) &&
    !probe.isPending;

  return (
    <StepLayout
      step={step}
      totalSteps={totalSteps}
      title="Connect Steam"
      subtitle="Hoard needs read-only access to your Steam library. Your API key and Steam64 ID stay on this server."
      footer={
        <>
          <SecondaryButton onClick={onBack} disabled={probe.isPending}>
            Back
          </SecondaryButton>
          <PrimaryButton onClick={handleValidate} disabled={!canSubmit}>
            {probe.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Checking…
              </>
            ) : (
              'Validate & continue'
            )}
          </PrimaryButton>
        </>
      }
    >
      <Field
        label="Steam Web API key"
        helper={
          <>
            Get a key at{' '}
            <a
              href="https://steamcommunity.com/dev/apikey"
              target="_blank"
              rel="noreferrer"
              className="text-primary hover:underline inline-flex items-center gap-1"
            >
              steamcommunity.com/dev/apikey <ExternalLink className="h-3 w-3" />
            </a>
            . Any non-empty domain works (e.g. <code>localhost</code>).
          </>
        }
      >
        <input
          type="text"
          value={shared.steamApiKey}
          onChange={(e) => setShared({ steamApiKey: e.target.value })}
          placeholder="0123456789ABCDEF0123456789ABCDEF"
          autoComplete="off"
          spellCheck={false}
          className="w-full rounded-md border border-white/[0.08] bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary/30"
        />
      </Field>

      <Field
        label="Steam64 ID"
        helper={
          <>
            17-digit number starting with <code>7656119</code> — find yours at{' '}
            <a
              href="https://steamid.io"
              target="_blank"
              rel="noreferrer"
              className="text-primary hover:underline inline-flex items-center gap-1"
            >
              steamid.io <ExternalLink className="h-3 w-3" />
            </a>
            . Your profile and game details must be public.
          </>
        }
      >
        <input
          type="text"
          value={shared.steamUserId}
          onChange={(e) => setShared({ steamUserId: e.target.value })}
          placeholder="76561198012345678"
          autoComplete="off"
          spellCheck={false}
          className="w-full rounded-md border border-white/[0.08] bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary/30"
        />
      </Field>

      {result && !result.ok && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm">
          <div className="flex items-start gap-2">
            <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
            <p className="text-destructive">{result.message ?? 'Validation failed.'}</p>
          </div>
        </div>
      )}

      {result?.ok && (
        <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm">
          <div className="flex items-start gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />
            <p>
              Steam connected — found <strong>{result.gameCount?.toLocaleString() ?? '?'}</strong>{' '}
              owned games.
            </p>
          </div>
        </div>
      )}
    </StepLayout>
  );
}

function Field({
  label,
  helper,
  children,
}: {
  label: string;
  helper: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-sm font-medium mb-1.5">{label}</label>
      {children}
      <p className="mt-1.5 text-xs text-muted-foreground leading-snug">{helper}</p>
    </div>
  );
}
