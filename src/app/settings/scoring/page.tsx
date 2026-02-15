import { redirect } from 'next/navigation';
import { getScoringConfig, getBacklogThreshold } from '@/lib/db/queries';
import { getSession } from '@/lib/auth-helpers';
import { ScoringConfig } from '@/components/settings/ScoringConfig';
import { DEFAULT_WEIGHTS, DEFAULT_THRESHOLDS } from '@/lib/scoring/types';

export const dynamic = 'force-dynamic';

export default async function ScoringPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  let weights = DEFAULT_WEIGHTS;
  let thresholds = DEFAULT_THRESHOLDS;
  let backlogThreshold = 10;
  try {
    const config = getScoringConfig();
    weights = config.weights;
    thresholds = config.thresholds;
    backlogThreshold = getBacklogThreshold();
  } catch {
    // DB not initialized yet — render with defaults
  }

  return (
    <ScoringConfig
      initialWeights={weights}
      initialThresholds={thresholds}
      initialBacklogThreshold={backlogThreshold}
    />
  );
}
