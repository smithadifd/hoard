import { redirect } from 'next/navigation';
import { getGamesForTriage, getMissingHltbCount } from '@/lib/db/queries';
import { getSession } from '@/lib/auth-helpers';
import { TriageList } from '@/components/games/TriageList';

export const dynamic = 'force-dynamic';

const VALID_VIEWS = ['library', 'wishlist', 'missing-hltb'] as const;
type TriageView = (typeof VALID_VIEWS)[number];

export default async function TriagePage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect('/login');

  const { view: rawView } = await searchParams;
  const view: TriageView | undefined = VALID_VIEWS.includes(rawView as TriageView)
    ? (rawView as TriageView)
    : undefined;

  const games = getGamesForTriage(view, session.user.id);
  const missingHltbCount = getMissingHltbCount(session.user.id);

  const mode = view === 'library' ? 'rating' as const : 'interest' as const;

  const descriptions: Record<string, string> = {
    library: 'Rate how much you enjoy each owned game. Ratings influence deal scores and recommendations.',
    wishlist: 'Rate your interest in each wishlisted game. Higher interest = better deal scores.',
    'missing-hltb': 'Games missing duration data. Search HLTB or enter hours manually for each game.',
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-headline font-extrabold tracking-tight">Rate Your Games</h1>
        <p className="text-muted-foreground mt-1">
          {view ? descriptions[view] : 'Quickly rate your games (1-5 stars). Ratings influence deal scores.'}
        </p>
      </div>

      <TriageList
        key={view ?? 'all'}
        initialGames={games}
        currentView={view}
        mode={mode}
        missingHltbCount={missingHltbCount}
      />
    </div>
  );
}
