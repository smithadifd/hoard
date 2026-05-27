'use client';

import { useState } from 'react';
import { CheckCircle2, ExternalLink, Loader2, SkipForward } from 'lucide-react';
import { StepLayout, PrimaryButton, SecondaryButton } from '../StepLayout';
import { useApiMutation } from '@/hooks/useApiMutation';
import type { StepProps } from '../OnboardingWizard';

export function Step3Integrations({ step, totalSteps, shared, setShared, onNext, onBack }: StepProps) {
  const [saved, setSaved] = useState(false);
  const save = useApiMutation<{ settings: Record<string, string> }, { data: { message: string } }>(
    '/api/settings',
    {
      method: 'PUT',
      onSuccess: () => {
        setSaved(true);
        setTimeout(onNext, 400);
      },
    },
  );

  const handleContinue = async () => {
    const settings: Record<string, string> = {};
    if (shared.itadApiKey.trim()) settings['itad_api_key'] = shared.itadApiKey.trim();
    if (shared.discordWebhookUrl.trim())
      settings['discord_webhook_url'] = shared.discordWebhookUrl.trim();
    if (shared.discordOpsWebhookUrl.trim())
      settings['discord_ops_webhook_url'] = shared.discordOpsWebhookUrl.trim();

    // Skip the PUT entirely if the user added nothing — there's no point of
    // round-tripping an empty patch through the API.
    if (Object.keys(settings).length === 0) {
      onNext();
      return;
    }
    await save.mutate({ settings });
  };

  return (
    <StepLayout
      step={step}
      totalSteps={totalSteps}
      title="Optional integrations"
      subtitle="Skip anything you don't have yet — you can add these later in Settings. ITAD is technically optional, but Hoard's deal tracking, price history, and ATL alerts all need it."
      footer={
        <>
          <SecondaryButton onClick={onBack} disabled={save.isPending}>
            Back
          </SecondaryButton>
          <PrimaryButton onClick={handleContinue} disabled={save.isPending}>
            {save.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving…
              </>
            ) : saved ? (
              <>
                <CheckCircle2 className="mr-2 h-4 w-4" /> Saved
              </>
            ) : (
              <>
                Continue
                <SkipForward className="ml-2 h-4 w-4" />
              </>
            )}
          </PrimaryButton>
        </>
      }
    >
      <Field
        label="IsThereAnyDeal API key"
        muted={!shared.itadApiKey}
        helper={
          <>
            Unlocks current prices, deal alerts, and full price history.{' '}
            <a
              href="https://isthereanydeal.com/dev/app/"
              target="_blank"
              rel="noreferrer"
              className="text-primary hover:underline inline-flex items-center gap-1"
            >
              Get a key <ExternalLink className="h-3 w-3" />
            </a>
            . Without this you can still browse your library, but the Full drain mode will be
            unavailable.
          </>
        }
      >
        <input
          type="text"
          value={shared.itadApiKey}
          onChange={(e) => setShared({ itadApiKey: e.target.value })}
          placeholder="optional"
          autoComplete="off"
          spellCheck={false}
          className="w-full rounded-md border border-white/[0.08] bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary/30"
        />
      </Field>

      <Field
        label="Discord deals webhook"
        muted={!shared.discordWebhookUrl}
        helper="Pings you when watched games hit their target price or all-time low. Server Settings → Integrations → Webhooks."
      >
        <input
          type="text"
          value={shared.discordWebhookUrl}
          onChange={(e) => setShared({ discordWebhookUrl: e.target.value })}
          placeholder="optional — https://discord.com/api/webhooks/…"
          autoComplete="off"
          spellCheck={false}
          className="w-full rounded-md border border-white/[0.08] bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary/30"
        />
      </Field>

      <Field
        label="Discord ops webhook"
        muted={!shared.discordOpsWebhookUrl}
        helper="Optional second webhook for backup/sync alerts so they don't clutter the deals channel. Falls back to the deals webhook if blank."
      >
        <input
          type="text"
          value={shared.discordOpsWebhookUrl}
          onChange={(e) => setShared({ discordOpsWebhookUrl: e.target.value })}
          placeholder="optional"
          autoComplete="off"
          spellCheck={false}
          className="w-full rounded-md border border-white/[0.08] bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary/30"
        />
      </Field>

      {save.error && (
        <p className="text-sm text-destructive">{save.error}</p>
      )}
    </StepLayout>
  );
}

function Field({
  label,
  helper,
  muted,
  children,
}: {
  label: string;
  helper: React.ReactNode;
  muted?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label className="block text-sm font-medium">{label}</label>
        {muted && (
          <span className="text-[10px] font-label font-semibold uppercase tracking-[0.15em] text-muted-foreground">
            Optional
          </span>
        )}
      </div>
      {children}
      <p className="mt-1.5 text-xs text-muted-foreground leading-snug">{helper}</p>
    </div>
  );
}
