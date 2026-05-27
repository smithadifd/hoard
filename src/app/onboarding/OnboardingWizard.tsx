'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { OnboardingState } from '@/lib/onboarding/types';
import { Step1Welcome } from './steps/Step1Welcome';
import { Step2Steam } from './steps/Step2Steam';
import { Step3Integrations } from './steps/Step3Integrations';
import { Step4Library } from './steps/Step4Library';
import { Step5DrainChoice } from './steps/Step5DrainChoice';
import { Step6DrainProgress } from './steps/Step6DrainProgress';
import { Step7Done } from './steps/Step7Done';

const TOTAL_STEPS = 7;

export interface WizardSharedState {
  steamApiKey: string;
  steamUserId: string;
  steamGameCount: number | null;
  itadApiKey: string;
  discordWebhookUrl: string;
  discordOpsWebhookUrl: string;
  libraryCount: number;
}

interface OnboardingWizardProps {
  initialState: OnboardingState;
}

export interface StepProps {
  step: number;
  totalSteps: number;
  shared: WizardSharedState;
  setShared: (patch: Partial<WizardSharedState>) => void;
  onNext: () => void;
  onBack: () => void;
}

export function OnboardingWizard({ initialState }: OnboardingWizardProps) {
  const router = useRouter();
  // Resume the user where they left off:
  //   - drainStartedAt + !drainCompletedAt → drop them on the drain progress
  //   - drainCompletedAt → final step
  //   - steamConnectedAt → after the Steam step
  const initialStep = (() => {
    if (initialState.drainStartedAt && !initialState.drainCompletedAt) return 6;
    if (initialState.drainCompletedAt) return 7;
    if (initialState.steamConnectedAt) return 3;
    return 1;
  })();

  const [step, setStep] = useState<number>(initialStep);
  const [shared, setSharedState] = useState<WizardSharedState>({
    steamApiKey: '',
    steamUserId: '',
    steamGameCount: null,
    itadApiKey: '',
    discordWebhookUrl: '',
    discordOpsWebhookUrl: '',
    libraryCount: 0,
  });

  const setShared = useCallback((patch: Partial<WizardSharedState>) => {
    setSharedState((prev) => ({ ...prev, ...patch }));
  }, []);

  const onNext = useCallback(() => {
    setStep((s) => Math.min(TOTAL_STEPS, s + 1));
  }, []);
  const onBack = useCallback(() => {
    setStep((s) => Math.max(1, s - 1));
  }, []);

  // After Step 7 marks the wizard complete, the user clicks "Go to dashboard"
  // and Step 7 calls router.push('/'). We just need to provide the navigation
  // function via context if needed; for now Step 7 takes a callback.
  const onFinish = useCallback(() => {
    router.push('/');
  }, [router]);

  const props: StepProps = {
    step,
    totalSteps: TOTAL_STEPS,
    shared,
    setShared,
    onNext,
    onBack,
  };

  switch (step) {
    case 1:
      return <Step1Welcome {...props} />;
    case 2:
      return <Step2Steam {...props} />;
    case 3:
      return <Step3Integrations {...props} />;
    case 4:
      return <Step4Library {...props} />;
    case 5:
      return <Step5DrainChoice {...props} />;
    case 6:
      return <Step6DrainProgress {...props} />;
    case 7:
      return <Step7Done {...props} onFinish={onFinish} />;
    default:
      return <Step1Welcome {...props} />;
  }
}
