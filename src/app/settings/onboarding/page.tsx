import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth-helpers';
import { getOnboardingState } from '@/lib/onboarding/state';
import { getDrainProgressForUser } from '@/lib/sync/drain';
import { OnboardingReentry } from '@/components/settings/OnboardingReentry';

export const dynamic = 'force-dynamic';

export default async function OnboardingSettingsPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  const state = getOnboardingState(session.user.id);
  const drainProgress = getDrainProgressForUser(session.user.id);

  return <OnboardingReentry initialState={state} initialDrain={drainProgress} />;
}
