import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth-helpers';
import { getOnboardingState } from '@/lib/onboarding/state';
import { OnboardingWizard } from './OnboardingWizard';

export const dynamic = 'force-dynamic';

export default async function OnboardingPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  const state = getOnboardingState(session.user.id);
  // Already finished? Send the user home. They can re-enter via Settings → Onboarding
  // (Phase 3) if they want to redo any step.
  if (state.wizardCompletedAt) {
    redirect('/');
  }

  return <OnboardingWizard initialState={state} />;
}
