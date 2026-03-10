import { redirect } from 'next/navigation';
import { getUnreleasedWishlistGames } from '@/lib/db/queries';
import { getSession } from '@/lib/auth-helpers';
import { parseReleaseDate, getReleaseBucket, getBucketLabel, compareBuckets } from '@/lib/utils/releaseDate';
import type { ReleaseBucket } from '@/lib/utils/releaseDate';
import type { EnrichedGame } from '@/types';
import { ReleaseTimeline } from './ReleaseTimeline';

export const dynamic = 'force-dynamic';

interface GroupedRelease {
  bucket: ReleaseBucket;
  label: string;
  games: Array<EnrichedGame & { parsedDate: string }>;
}

export default async function ReleasesPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  const games = getUnreleasedWishlistGames(session.user.id);
  const now = new Date();

  // Parse dates and assign to buckets
  const bucketMap = new Map<ReleaseBucket, GroupedRelease>();

  for (const game of games) {
    const parsed = parseReleaseDate(game.releaseDate);
    const bucket = getReleaseBucket(parsed, now);

    if (!bucketMap.has(bucket)) {
      bucketMap.set(bucket, {
        bucket,
        label: getBucketLabel(bucket, now),
        games: [],
      });
    }

    bucketMap.get(bucket)!.games.push({
      ...game,
      parsedDate: parsed.label,
    });
  }

  // Sort groups by bucket order, then sort games within each group by title
  const groups = [...bucketMap.values()]
    .sort((a, b) => compareBuckets(a.bucket, b.bucket))
    .map((group) => ({
      ...group,
      games: group.games.sort((a, b) => a.title.localeCompare(b.title)),
    }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Releases</h1>
        <p className="text-muted-foreground mt-1">
          {games.length > 0
            ? `${games.length} upcoming game${games.length === 1 ? '' : 's'} from your wishlist`
            : 'Track upcoming games from your wishlist'}
        </p>
      </div>

      {games.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-12 text-center space-y-3">
          <p className="text-muted-foreground">
            No upcoming releases found. Games marked as &quot;Coming Soon&quot; on Steam will appear here
            when you sync your wishlist.
          </p>
        </div>
      ) : (
        <ReleaseTimeline groups={groups} />
      )}
    </div>
  );
}
