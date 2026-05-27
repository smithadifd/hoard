'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, Heart, Library, Loader2, Star } from 'lucide-react';
import { StepLayout, PrimaryButton } from '../StepLayout';
import { useApiMutation } from '@/hooks/useApiMutation';
import type { StepProps } from '../OnboardingWizard';

interface Step7Props extends StepProps {
  onFinish: () => void;
}

export function Step7Done({ step, totalSteps, onFinish }: Step7Props) {
  const [stamped, setStamped] = useState(false);
  const stamp = useApiMutation<{ wizardCompletedAt: string }, { data: unknown }>(
    '/api/onboarding/state',
    { method: 'PATCH' },
  );

  // Stamp wizardCompletedAt exactly once when this step renders.
  useEffect(() => {
    if (stamped) return;
    void stamp
      .mutate({ wizardCompletedAt: new Date().toISOString() })
      .finally(() => setStamped(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <StepLayout
      step={step}
      totalSteps={totalSteps}
      title="You're set"
      subtitle="A quick tour of what to do next."
      footer={
        <>
          <span className="text-xs text-muted-foreground">
            Need to re-run anything? Head to <strong>Settings → Onboarding</strong>.
          </span>
          <PrimaryButton onClick={onFinish} disabled={stamp.isPending && !stamped}>
            {stamp.isPending && !stamped ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Finishing…
              </>
            ) : (
              <>
                Go to dashboard
                <CheckCircle2 className="ml-2 h-4 w-4" />
              </>
            )}
          </PrimaryButton>
        </>
      }
    >
      <Tip
        icon={<Library className="h-4 w-4" />}
        title="Library"
        body="Every owned game, sortable by deal score, playtime, value, or interest. Use it to triage."
      />
      <Tip
        icon={<Heart className="h-4 w-4" />}
        title="Wishlist"
        body="Live prices across stores. Click the bell icon on any game to get a Discord ping when it drops."
      />
      <Tip
        icon={<Star className="h-4 w-4" />}
        title="Rate as you go"
        body="A 1–5 interest rating feeds the backlog recommender. You don't need to rate everything — even 10 ratings make backlog suggestions feel personal."
      />

      {stamp.error && (
        <p className="text-sm text-destructive">
          Couldn&apos;t mark the wizard as complete: {stamp.error}. You can continue anyway.
        </p>
      )}
    </StepLayout>
  );
}

function Tip({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="rounded-lg bg-background/40 border border-white/[0.04] p-4">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-primary">{icon}</span>
        <span className="text-sm font-headline font-bold">{title}</span>
      </div>
      <p className="text-xs text-muted-foreground leading-snug">{body}</p>
    </div>
  );
}
