import { redirect } from 'next/navigation';
import { getGamesForTriage } from '@/lib/db/queries';
import { getSession } from '@/lib/auth-helpers';
import { TriageList } from '@/components/games/TriageList';

export const dynamic = 'force-dynamic';

export default async function TriagePage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect('/login');

  const { view: rawView } = await searchParams;
  const view = rawView === 'library' || rawView === 'wishlist' ? rawView : undefined;
  const games = getGamesForTriage(view, session.user.id);

  const mode = view === 'library' ? 'rating' as const : 'interest' as const;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Rate Your Games</h1>
        <p className="text-muted-foreground mt-1">
          {view === 'library'
            ? 'Rate how much you enjoy each owned game. Ratings influence deal scores and recommendations.'
            : view === 'wishlist'
              ? 'Rate your interest in each wishlisted game. Higher interest = better deal scores.'
              : 'Quickly rate your games (1-5 stars). Ratings influence deal scores.'}
        </p>
      </div>

      <TriageList key={view ?? 'all'} initialGames={games} currentView={view} mode={mode} />
    </div>
  );
}
