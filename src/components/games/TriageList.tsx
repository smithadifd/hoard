'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Star, Clock, SkipForward, Library, Heart } from 'lucide-react';

interface TriageGame {
  id: number;
  steamAppId: number;
  title: string;
  headerImageUrl: string | null;
  developer: string | null;
  reviewScore: number | null;
  reviewDescription: string | null;
  hltbMain: number | null;
  currentPrice: number | null;
  personalInterest: number;
  interestRatedAt: string | null;
}

interface TriageListProps {
  initialGames: TriageGame[];
  currentView?: 'library' | 'wishlist';
  mode: 'rating' | 'interest';
}

const starLabels = {
  rating: ['', 'Disliked', 'Meh', 'Decent', 'Great', 'Loved it'],
  interest: ['', 'Not interested', 'Slightly curious', 'Interested', 'Very interested', 'Must buy'],
};

export function TriageList({ initialGames, currentView, mode }: TriageListProps) {
  const router = useRouter();
  const [games, setGames] = useState(initialGames);
  const [ratedCount, setRatedCount] = useState(
    initialGames.filter((g) => g.interestRatedAt !== null).length
  );
  const [focusIndex, setFocusIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const unratedGames = games.filter((g) => g.interestRatedAt === null);
  const ratedGames = games.filter((g) => g.interestRatedAt !== null);

  const handleRate = useCallback(async (gameId: number, interest: number) => {
    // Optimistic update
    setGames((prev) =>
      prev.map((g) =>
        g.id === gameId
          ? { ...g, personalInterest: interest, interestRatedAt: new Date().toISOString() }
          : g
      )
    );
    setRatedCount((c) => c + 1);

    // Move focus to next unrated game
    setFocusIndex((prev) => Math.min(prev, unratedGames.length - 2));

    // Fire-and-forget API call
    try {
      await fetch('/api/games/interest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameId, interest }),
      });
    } catch {
      // Silently fail — optimistic update already applied
    }
  }, [unratedGames.length]);

  const handleSkip = useCallback(() => {
    setFocusIndex((prev) => Math.min(prev + 1, unratedGames.length - 1));
  }, [unratedGames.length]);

  // Keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      const currentGame = unratedGames[focusIndex];
      if (!currentGame) return;

      if (e.key >= '1' && e.key <= '5') {
        e.preventDefault();
        handleRate(currentGame.id, parseInt(e.key));
      } else if (e.key === 's' || e.key === 'S') {
        e.preventDefault();
        handleSkip();
      } else if (e.key === 'ArrowDown' || e.key === 'j') {
        e.preventDefault();
        setFocusIndex((prev) => Math.min(prev + 1, unratedGames.length - 1));
      } else if (e.key === 'ArrowUp' || e.key === 'k') {
        e.preventDefault();
        setFocusIndex((prev) => Math.max(prev - 1, 0));
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [focusIndex, unratedGames, handleRate, handleSkip]);

  const labels = starLabels[mode];

  return (
    <div className="space-y-4">
      {/* View toggle */}
      <div className="flex items-center gap-2">
        <ViewButton
          label="All"
          active={currentView === undefined}
          onClick={() => router.push('/triage')}
        />
        <ViewButton
          label="Library"
          icon={<Library className="h-3.5 w-3.5" />}
          active={currentView === 'library'}
          onClick={() => router.push('/triage?view=library')}
        />
        <ViewButton
          label="Wishlist"
          icon={<Heart className="h-3.5 w-3.5" />}
          active={currentView === 'wishlist'}
          onClick={() => router.push('/triage?view=wishlist')}
        />
      </div>

      {/* Progress */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{ratedCount}</span>/{games.length} rated
        </p>
        <p className="text-xs text-muted-foreground">
          Keys: 1-5 rate, S skip, arrows navigate
        </p>
      </div>

      {/* Progress bar */}
      <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
        <div
          className="h-full rounded-full bg-steam-blue transition-all"
          style={{ width: `${games.length > 0 ? (ratedCount / games.length) * 100 : 0}%` }}
        />
      </div>

      {/* Unrated Games */}
      {unratedGames.length > 0 && (
        <div ref={listRef} className="space-y-1">
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
            Unrated ({unratedGames.length})
          </h3>
          {unratedGames.map((game, index) => (
            <TriageRow
              key={game.id}
              game={game}
              isFocused={index === focusIndex}
              onRate={(interest) => handleRate(game.id, interest)}
              onSkip={handleSkip}
              starLabels={labels}
            />
          ))}
        </div>
      )}

      {unratedGames.length === 0 && (
        <div className="text-center py-8 text-muted-foreground">
          {games.length === 0
            ? 'No games to rate in this view.'
            : 'All games rated! You can adjust ratings below.'}
        </div>
      )}

      {/* Rated Games */}
      {ratedGames.length > 0 && (
        <div className="space-y-1">
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
            Already Rated ({ratedGames.length})
          </h3>
          {ratedGames.map((game) => (
            <TriageRow
              key={game.id}
              game={game}
              isFocused={false}
              onRate={(interest) => {
                setGames((prev) =>
                  prev.map((g) =>
                    g.id === game.id
                      ? { ...g, personalInterest: interest, interestRatedAt: new Date().toISOString() }
                      : g
                  )
                );
                fetch('/api/games/interest', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ gameId: game.id, interest }),
                }).catch(() => {});
              }}
              starLabels={labels}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ViewButton({
  label,
  icon,
  active,
  onClick,
}: {
  label: string;
  icon?: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
        active
          ? 'bg-steam-blue text-white'
          : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function TriageRow({
  game,
  isFocused,
  onRate,
  onSkip,
  starLabels,
}: {
  game: TriageGame;
  isFocused: boolean;
  onRate: (interest: number) => void;
  onSkip?: () => void;
  starLabels: string[];
}) {
  return (
    <div
      className={`flex items-center gap-3 p-2 rounded-md transition-colors ${
        isFocused ? 'bg-steam-blue/10 border border-steam-blue/30' : 'hover:bg-secondary/50'
      }`}
    >
      {/* Thumbnail */}
      <Link href={`/games/${game.id}`} className="shrink-0">
        <div className="relative w-[120px] h-[56px] rounded overflow-hidden bg-secondary">
          {game.headerImageUrl && (
            <Image
              src={game.headerImageUrl}
              alt={game.title}
              fill
              className="object-cover"
              sizes="120px"
            />
          )}
        </div>
      </Link>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <Link href={`/games/${game.id}`} className="hover:text-steam-blue transition-colors">
          <h4 className="text-sm font-medium truncate">{game.title}</h4>
        </Link>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {game.developer && <span className="truncate max-w-[120px]">{game.developer}</span>}
          {game.reviewScore !== null && (
            <>
              {game.developer && <span>&middot;</span>}
              <span>{game.reviewDescription ?? `${game.reviewScore}%`}</span>
            </>
          )}
          {game.hltbMain !== null && game.hltbMain > 0 && (
            <>
              <span>&middot;</span>
              <span className="flex items-center gap-0.5">
                <Clock className="h-3 w-3" />
                {game.hltbMain}h
              </span>
            </>
          )}
          {game.currentPrice !== null && (
            <>
              <span>&middot;</span>
              <span>${game.currentPrice.toFixed(2)}</span>
            </>
          )}
        </div>
      </div>

      {/* Star Rating */}
      <div className="flex items-center gap-1 shrink-0">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            onClick={() => onRate(n)}
            className={`p-1 rounded transition-colors ${
              n <= game.personalInterest && game.interestRatedAt
                ? 'text-yellow-500'
                : 'text-muted-foreground/30 hover:text-yellow-500/60'
            }`}
            title={`${n} — ${starLabels[n]}`}
          >
            <Star className="h-5 w-5" fill={n <= game.personalInterest && game.interestRatedAt ? 'currentColor' : 'none'} />
          </button>
        ))}
        {onSkip && (
          <button
            onClick={onSkip}
            className="p-1 rounded text-muted-foreground/50 hover:text-muted-foreground transition-colors ml-1"
            title="Skip (S)"
          >
            <SkipForward className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}
