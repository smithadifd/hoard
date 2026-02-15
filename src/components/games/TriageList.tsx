'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Star, Clock, SkipForward, Library, Heart, Ban, AlertTriangle } from 'lucide-react';
import { TriageCard } from './TriageCard';
import { TriageHltbEditor } from './TriageHltbEditor';
import { Toast } from '@/components/ui/Toast';
import type { ToastData } from '@/components/ui/Toast';

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
  currentView?: 'library' | 'wishlist' | 'missing-hltb';
  mode: 'rating' | 'interest';
  missingHltbCount?: number;
}

const starLabels = {
  rating: ['', 'Disliked', 'Meh', 'Decent', 'Great', 'Loved it'],
  interest: ['', 'Not interested', 'Slightly curious', 'Interested', 'Very interested', 'Must buy'],
};

const FEEDBACK_DELAY_MS = 600;

export function TriageList({ initialGames, currentView, mode, missingHltbCount }: TriageListProps) {
  const router = useRouter();
  const [games, setGames] = useState(initialGames);
  const [ratedCount, setRatedCount] = useState(
    initialGames.filter((g) => g.interestRatedAt !== null).length
  );
  const [focusIndex, setFocusIndex] = useState(0);
  const [ratingFeedback, setRatingFeedback] = useState<{ gameId: number; interest: number } | null>(null);
  const [toast, setToast] = useState<ToastData | null>(null);
  const [showRated, setShowRated] = useState(false);
  const [skipFeedbackId, setSkipFeedbackId] = useState<number | null>(null);
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const unratedGames = games.filter((g) => g.interestRatedAt === null);
  const ratedGames = games.filter((g) => g.interestRatedAt !== null);

  const handleRate = useCallback((gameId: number, interest: number) => {
    // Prevent double-rating during feedback
    if (ratingFeedback) return;

    // Show feedback immediately
    setRatingFeedback({ gameId, interest });

    // Clear any pending timer
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);

    // After delay, clear feedback first, then apply state change in next frame
    // Two-phase approach prevents animation bleed to next card
    feedbackTimerRef.current = setTimeout(() => {
      setRatingFeedback(null);

      // Use requestAnimationFrame to ensure feedback is cleared before card swap
      requestAnimationFrame(() => {
        setGames((prev) =>
          prev.map((g) =>
            g.id === gameId
              ? { ...g, personalInterest: interest, interestRatedAt: new Date().toISOString() }
              : g
          )
        );
        setRatedCount((c) => c + 1);
        setFocusIndex((prev) => Math.min(prev, Math.max(0, unratedGames.length - 2)));
      });

      // Fire-and-forget API call
      fetch('/api/games/interest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameId, interest }),
      }).catch(() => {});
    }, FEEDBACK_DELAY_MS);
  }, [ratingFeedback, unratedGames.length]);

  // Re-rate for already rated games (no feedback delay needed)
  const handleReRate = useCallback((gameId: number, interest: number) => {
    setGames((prev) =>
      prev.map((g) =>
        g.id === gameId
          ? { ...g, personalInterest: interest, interestRatedAt: new Date().toISOString() }
          : g
      )
    );
    fetch('/api/games/interest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameId, interest }),
    }).catch(() => {});
  }, []);

  const handleSkip = useCallback(() => {
    if (ratingFeedback) return;
    const currentGame = unratedGames[focusIndex];
    if (currentGame) {
      setSkipFeedbackId(currentGame.id);
      if (skipTimerRef.current) clearTimeout(skipTimerRef.current);
      skipTimerRef.current = setTimeout(() => setSkipFeedbackId(null), 300);
    }
    setFocusIndex((prev) => Math.min(prev + 1, unratedGames.length - 1));
  }, [unratedGames, focusIndex, ratingFeedback]);

  const handlePrev = useCallback(() => {
    if (ratingFeedback) return;
    setFocusIndex((prev) => Math.max(prev - 1, 0));
  }, [ratingFeedback]);

  const handleIgnore = useCallback((gameId: number) => {
    const ignoredGame = games.find((g) => g.id === gameId);
    if (!ignoredGame) return;

    // Remove from list
    setGames((prev) => prev.filter((g) => g.id !== gameId));
    setFocusIndex((prev) => Math.min(prev, Math.max(0, unratedGames.length - 2)));

    // API call
    fetch(`/api/games/${gameId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isIgnored: true }),
    }).catch(() => {});

    // Toast with undo
    setToast({
      message: `"${ignoredGame.title}" ignored`,
      undoAction: () => {
        setGames((prev) => {
          const restored = [...prev, ignoredGame];
          // Re-sort: unrated first, then alphabetically
          return restored.sort((a, b) => {
            const aRated = a.interestRatedAt ? 1 : 0;
            const bRated = b.interestRatedAt ? 1 : 0;
            if (aRated !== bRated) return aRated - bRated;
            return a.title.localeCompare(b.title);
          });
        });

        fetch(`/api/games/${gameId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ isIgnored: false }),
        }).catch(() => {});
      },
      duration: 3000,
    });
  }, [games, unratedGames.length]);

  const handleHltbSaved = useCallback((gameId: number) => {
    // Remove from list (HLTB data was added, no longer "missing")
    setGames((prev) => prev.filter((g) => g.id !== gameId));
    setRatedCount((c) => c + 1);
    setFocusIndex((prev) => Math.min(prev, Math.max(0, unratedGames.length - 2)));
  }, [unratedGames.length]);

  // Keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (ratingFeedback) return;

      const currentGame = unratedGames[focusIndex];
      if (!currentGame) return;

      if (e.key >= '1' && e.key <= '5') {
        e.preventDefault();
        handleRate(currentGame.id, parseInt(e.key));
      } else if (e.key === 's' || e.key === 'S') {
        e.preventDefault();
        handleSkip();
      } else if (e.key === 'x' || e.key === 'X') {
        e.preventDefault();
        handleIgnore(currentGame.id);
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
  }, [focusIndex, unratedGames, handleRate, handleSkip, handleIgnore, ratingFeedback]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
      if (skipTimerRef.current) clearTimeout(skipTimerRef.current);
    };
  }, []);

  const labels = starLabels[mode];
  const isHltbMode = currentView === 'missing-hltb';

  return (
    <div className="space-y-4">
      {/* View toggle */}
      <div className="flex items-center gap-2 overflow-x-auto">
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
        <ViewButton
          label="Missing HLTB"
          icon={<AlertTriangle className="h-3.5 w-3.5" />}
          active={currentView === 'missing-hltb'}
          onClick={() => router.push('/triage?view=missing-hltb')}
          badge={missingHltbCount && missingHltbCount > 0 ? missingHltbCount : undefined}
        />
      </div>

      {/* Progress */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{ratedCount}</span>/{games.length} {isHltbMode ? 'resolved' : 'rated'}
        </p>
        {!isHltbMode && (
          <p className="text-xs text-muted-foreground hidden lg:block">
            Keys: 1-5 rate, S skip, X ignore, arrows navigate
          </p>
        )}
      </div>

      {/* Progress bar */}
      <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
        <div
          className="h-full rounded-full bg-steam-blue transition-all"
          style={{ width: `${games.length > 0 ? (ratedCount / games.length) * 100 : 0}%` }}
        />
      </div>

      {/* Mobile card view */}
      {unratedGames.length > 0 && (
        <div className="lg:hidden">
          <TriageCard
            key={unratedGames[focusIndex]?.id}
            game={unratedGames[focusIndex]}
            index={focusIndex}
            total={unratedGames.length}
            onRate={(interest) => handleRate(unratedGames[focusIndex].id, interest)}
            onSkip={handleSkip}
            onIgnore={() => handleIgnore(unratedGames[focusIndex].id)}
            onPrev={handlePrev}
            starLabels={labels}
            ratingFeedback={ratingFeedback}
            hltbMode={isHltbMode}
            onHltbSaved={handleHltbSaved}
          />
        </div>
      )}

      {/* Desktop list view */}
      {unratedGames.length > 0 && (
        <div ref={listRef} className="space-y-1 hidden lg:block">
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
            {isHltbMode ? `Missing HLTB (${unratedGames.length})` : `Unrated (${unratedGames.length})`}
          </h3>
          {unratedGames.map((game, index) => (
            <TriageRow
              key={game.id}
              game={game}
              isFocused={index === focusIndex}
              isSkipFeedback={skipFeedbackId === game.id}
              onRate={(interest) => handleRate(game.id, interest)}
              onSkip={handleSkip}
              onIgnore={() => handleIgnore(game.id)}
              starLabels={labels}
              ratingFeedback={ratingFeedback}
              hltbMode={isHltbMode}
              onHltbSaved={handleHltbSaved}
            />
          ))}
        </div>
      )}

      {unratedGames.length === 0 && (
        <div className="text-center py-8 text-muted-foreground">
          {games.length === 0
            ? isHltbMode ? 'All games have HLTB data!' : 'No games to rate in this view.'
            : isHltbMode ? 'All done! Every game now has duration data.' : 'All games rated! You can adjust ratings below.'}
        </div>
      )}

      {/* Rated Games - collapsible on mobile */}
      {ratedGames.length > 0 && (
        <div className="space-y-1">
          {/* Mobile: expandable */}
          <button
            onClick={() => setShowRated(!showRated)}
            className="lg:hidden text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1"
          >
            Already Rated ({ratedGames.length})
            <span className="text-muted-foreground/50">{showRated ? '(hide)' : '(show)'}</span>
          </button>
          {/* Desktop: always visible header */}
          <h3 className="hidden lg:block text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
            Already Rated ({ratedGames.length})
          </h3>

          <div className={`space-y-1 ${showRated ? '' : 'hidden lg:block'}`}>
            {ratedGames.map((game) => (
              <TriageRow
                key={game.id}
                game={game}
                isFocused={false}
                onRate={(interest) => handleReRate(game.id, interest)}
                starLabels={labels}
                ratingFeedback={null}
              />
            ))}
          </div>
        </div>
      )}

      {/* Toast */}
      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </div>
  );
}

function ViewButton({
  label,
  icon,
  active,
  onClick,
  badge,
}: {
  label: string;
  icon?: React.ReactNode;
  active: boolean;
  onClick: () => void;
  badge?: number;
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors whitespace-nowrap ${
        active
          ? 'bg-steam-blue text-white'
          : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
      }`}
    >
      {icon}
      {label}
      {badge !== undefined && (
        <span className={`ml-1 px-1.5 py-0.5 rounded-full text-xs ${
          active ? 'bg-white/20' : 'bg-yellow-500/20 text-yellow-500'
        }`}>
          {badge}
        </span>
      )}
    </button>
  );
}

function TriageRow({
  game,
  isFocused,
  isSkipFeedback,
  onRate,
  onSkip,
  onIgnore,
  starLabels,
  ratingFeedback,
  hltbMode,
  onHltbSaved,
}: {
  game: TriageGame;
  isFocused: boolean;
  isSkipFeedback?: boolean;
  onRate: (interest: number) => void;
  onSkip?: () => void;
  onIgnore?: () => void;
  starLabels: string[];
  ratingFeedback: { gameId: number; interest: number } | null;
  hltbMode?: boolean;
  onHltbSaved?: (gameId: number) => void;
}) {
  const isFeedbackActive = ratingFeedback?.gameId === game.id;
  const feedbackInterest = ratingFeedback?.interest ?? 0;

  // Long-press ignore
  const [ignoreProgress, setIgnoreProgress] = useState(false);
  const ignoreTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleIgnoreStart = useCallback(() => {
    setIgnoreProgress(true);
    ignoreTimerRef.current = setTimeout(() => {
      setIgnoreProgress(false);
      onIgnore?.();
    }, 1000);
  }, [onIgnore]);

  const handleIgnoreEnd = useCallback(() => {
    setIgnoreProgress(false);
    if (ignoreTimerRef.current) {
      clearTimeout(ignoreTimerRef.current);
      ignoreTimerRef.current = null;
    }
  }, []);

  return (
    <div
      className={`flex items-center gap-3 p-2 rounded-md transition-all duration-300 ${
        isFeedbackActive
          ? 'bg-deal-great/10 border border-deal-great/30'
          : isSkipFeedback
            ? 'bg-muted/50 border border-muted-foreground/20 opacity-60'
            : isFocused
              ? 'bg-steam-blue/10 border border-steam-blue/30'
              : 'hover:bg-secondary/50 border border-transparent'
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
          {game.hltbMain !== null && game.hltbMain > 0 ? (
            <>
              <span>&middot;</span>
              <span className="inline-flex items-center gap-0.5 shrink-0">
                <Clock className="h-3 w-3" />
                {game.hltbMain}h
              </span>
            </>
          ) : (
            <>
              <span>&middot;</span>
              <span className="inline-flex items-center gap-0.5 shrink-0 text-yellow-500/60">
                <Clock className="h-3 w-3" />
                <span>?h</span>
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

      {hltbMode ? (
        /* HLTB inline editor for desktop row */
        <div className="shrink-0 w-56">
          <TriageHltbEditor
            gameId={game.id}
            gameTitle={game.title}
            onSaved={() => onHltbSaved?.(game.id)}
            compact
          />
        </div>
      ) : (
        <>
          {/* Feedback label */}
          {isFeedbackActive && (
            <span className="text-xs font-medium text-deal-great shrink-0 animate-in fade-in duration-200">
              {starLabels[feedbackInterest]}
            </span>
          )}

          {/* Star Rating */}
          <div className="flex items-center gap-1 shrink-0">
            {[1, 2, 3, 4, 5].map((n) => {
              const isActive = isFeedbackActive
                ? n <= feedbackInterest
                : n <= game.personalInterest && game.interestRatedAt;
              return (
                <button
                  key={n}
                  onClick={() => onRate(n)}
                  disabled={isFeedbackActive}
                  className={`p-1 rounded transition-colors ${
                    isActive
                      ? 'text-yellow-500'
                      : 'text-muted-foreground/30 hover:text-yellow-500/60'
                  }`}
                  title={`${n} — ${starLabels[n]}`}
                >
                  <Star className="h-5 w-5" fill={isActive ? 'currentColor' : 'none'} />
                </button>
              );
            })}

            {/* Skip + Ignore (only for unrated games) */}
            {onSkip && (
              <button
                onClick={onSkip}
                disabled={isFeedbackActive}
                className="p-1 rounded text-muted-foreground/50 hover:text-muted-foreground transition-colors ml-1"
                title="Skip (S)"
              >
                <SkipForward className="h-4 w-4" />
              </button>
            )}
            {onIgnore && (
              <div className="relative ml-0.5">
                <button
                  onPointerDown={handleIgnoreStart}
                  onPointerUp={handleIgnoreEnd}
                  onPointerLeave={handleIgnoreEnd}
                  disabled={isFeedbackActive}
                  className="relative overflow-hidden p-1 rounded text-muted-foreground/30 hover:text-destructive/80 transition-colors select-none"
                  title="Hold to ignore (X)"
                >
                  <div
                    className={`absolute inset-0 bg-destructive/20 origin-left ${
                      ignoreProgress ? 'scale-x-100' : 'scale-x-0'
                    }`}
                    style={{ transition: ignoreProgress ? 'transform 1s linear' : 'transform 0.1s ease-out' }}
                  />
                  <Ban className="h-4 w-4 relative z-10" />
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
