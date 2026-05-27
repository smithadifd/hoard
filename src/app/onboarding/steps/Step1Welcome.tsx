'use client';

import { Clock, Heart, Sparkles } from 'lucide-react';
import { StepLayout, PrimaryButton } from '../StepLayout';
import type { StepProps } from '../OnboardingWizard';

export function Step1Welcome({ step, totalSteps, onNext }: StepProps) {
  return (
    <StepLayout
      step={step}
      totalSteps={totalSteps}
      title="Welcome to Hoard"
      subtitle="A 5-minute setup gets you to a working dashboard. Initial enrichment runs in the background and finishes in roughly an hour."
      footer={
        <>
          <span className="text-xs text-muted-foreground">
            You can leave and come back — we&apos;ll pick up where you left off.
          </span>
          <PrimaryButton onClick={onNext}>Get started</PrimaryButton>
        </>
      }
    >
      <div className="grid sm:grid-cols-3 gap-3 text-sm">
        <Tile
          icon={<Sparkles className="h-4 w-4" />}
          title="Now (5 min)"
          body="Connect Steam, optionally add deal & notification keys, pull your library."
        />
        <Tile
          icon={<Clock className="h-4 w-4" />}
          title="Next ~1 hour"
          body="Price history, metadata, and play-time estimates fill in. Close the tab if you want."
        />
        <Tile
          icon={<Heart className="h-4 w-4" />}
          title="Then"
          body="Rate a few games to power backlog scoring — totally optional."
        />
      </div>
    </StepLayout>
  );
}

function Tile({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="rounded-lg bg-background/40 border border-white/[0.04] p-4">
      <div className="flex items-center gap-2 text-primary">
        {icon}
        <span className="text-[10px] font-label font-semibold uppercase tracking-[0.15em]">
          {title}
        </span>
      </div>
      <p className="mt-2 text-sm text-muted-foreground leading-snug">{body}</p>
    </div>
  );
}
