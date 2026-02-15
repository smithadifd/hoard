'use client';

import { useState, useRef, useCallback } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Star, Clock, ChevronLeft, ChevronRight, Ban, HelpCircle } from 'lucide-react';
import { TriageHltbEditor } from './TriageHltbEditor';

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

interface TriageCardProps {
  game: TriageGame;
  index: number;
  total: number;
  onRate: (interest: number) => void;
  onSkip: () => void;
  onIgnore: () => void;
  onPrev: () => void;
  starLabels: string[];
  ratingFeedback: { gameId: number; interest: number } | null;
  hltbMode?: boolean;
  onHltbSaved?: (gameId: number) => void;
}

export function TriageCard({
  game,
  index,
  total,
  onRate,
  onSkip,
  onIgnore,
  onPrev,
  starLabels,
  ratingFeedback,
  hltbMode,
  onHltbSaved,
}: TriageCardProps) {
  const [hoverStar, setHoverStar] = useState(0);
  const touchRef = useRef<{ startX: number; startY: number } | null>(null);

  const isFeedbackActive = ratingFeedback?.gameId === game.id;
  const feedbackInterest = ratingFeedback?.interest ?? 0;

  // Long-press ignore state
  const [ignoreProgress, setIgnoreProgress] = useState(false);
  const ignoreTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleIgnoreStart = useCallback(() => {
    setIgnoreProgress(true);
    ignoreTimerRef.current = setTimeout(() => {
      setIgnoreProgress(false);
      onIgnore();
    }, 1000);
  }, [onIgnore]);

  const handleIgnoreEnd = useCallback(() => {
    setIgnoreProgress(false);
    if (ignoreTimerRef.current) {
      clearTimeout(ignoreTimerRef.current);
      ignoreTimerRef.current = null;
    }
  }, []);

  const handleTouchStart = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    touchRef.current = { startX: touch.clientX, startY: touch.clientY };
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (!touchRef.current) return;
    const touch = e.changedTouches[0];
    const deltaX = touch.clientX - touchRef.current.startX;
    const deltaY = Math.abs(touch.clientY - touchRef.current.startY);
    touchRef.current = null;

    // Only trigger swipe if horizontal > 50px and more horizontal than vertical
    if (Math.abs(deltaX) > 50 && Math.abs(deltaX) > deltaY) {
      if (deltaX < 0) {
        onSkip(); // Swipe left = skip/next
      } else {
        onPrev(); // Swipe right = previous
      }
    }
  };

  return (
    <div
      className={`rounded-lg border overflow-hidden transition-all duration-300 ${
        isFeedbackActive
          ? 'border-deal-great/50 bg-deal-great/5'
          : 'border-border bg-card'
      }`}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* Header Image */}
      <Link href={`/games/${game.id}`}>
        <div className="relative aspect-[460/215] w-full bg-secondary">
          {game.headerImageUrl && (
            <Image
              src={game.headerImageUrl}
              alt={game.title}
              fill
              className="object-cover"
              sizes="100vw"
              priority
            />
          )}
        </div>
      </Link>

      <div className="p-4 space-y-3">
        {/* Title & Info */}
        <div>
          <Link href={`/games/${game.id}`} className="hover:text-steam-blue transition-colors">
            <h3 className="text-lg font-semibold leading-tight">{game.title}</h3>
          </Link>
          <div className="flex flex-wrap items-center gap-2 mt-1 text-sm text-muted-foreground">
            {game.developer && <span>{game.developer}</span>}
            {game.reviewScore !== null && (
              <>
                {game.developer && <span>&middot;</span>}
                <span>{game.reviewDescription ?? `${game.reviewScore}%`}</span>
              </>
            )}
            {game.hltbMain !== null && game.hltbMain > 0 ? (
              <>
                <span>&middot;</span>
                <span className="flex items-center gap-0.5">
                  <Clock className="h-3.5 w-3.5" />
                  {game.hltbMain}h
                </span>
              </>
            ) : (
              <>
                <span>&middot;</span>
                <Link
                  href={`/games/${game.id}`}
                  className="flex items-center gap-0.5 text-yellow-500/70 hover:text-yellow-500"
                >
                  <HelpCircle className="h-3.5 w-3.5" />
                  No HLTB
                </Link>
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

        {/* Card counter */}
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{index + 1} of {total} {hltbMode ? 'missing HLTB' : 'unrated'}</span>
          <span className="text-muted-foreground/50">Swipe to navigate</span>
        </div>

        {hltbMode ? (
          /* HLTB inline editor */
          <TriageHltbEditor
            gameId={game.id}
            gameTitle={game.title}
            onSaved={() => onHltbSaved?.(game.id)}
          />
        ) : (
          <>
            {/* Star Rating */}
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map((n) => {
                const isActive = isFeedbackActive
                  ? n <= feedbackInterest
                  : n <= hoverStar;
                return (
                  <button
                    key={n}
                    onClick={() => onRate(n)}
                    onPointerEnter={() => setHoverStar(n)}
                    onPointerLeave={() => setHoverStar(0)}
                    disabled={isFeedbackActive}
                    className={`flex-1 flex items-center justify-center py-3 rounded-md transition-colors min-h-[56px] ${
                      isActive
                        ? 'text-yellow-500 bg-yellow-500/10'
                        : 'text-muted-foreground/30 hover:text-yellow-500/60 hover:bg-yellow-500/5'
                    }`}
                  >
                    <Star className="h-7 w-7" fill={isActive ? 'currentColor' : 'none'} />
                  </button>
                );
              })}
            </div>

            {/* Feedback label */}
            {isFeedbackActive && (
              <p className="text-center text-sm font-medium text-deal-great animate-in fade-in duration-200">
                {starLabels[feedbackInterest]}
              </p>
            )}

            {/* Hover label (when not in feedback state) */}
            {!isFeedbackActive && hoverStar > 0 && (
              <p className="text-center text-sm text-muted-foreground">
                {starLabels[hoverStar]}
              </p>
            )}

            {/* Navigation & Actions */}
            <div className="flex items-center gap-2">
              <button
                onClick={onPrev}
                disabled={index === 0 || isFeedbackActive}
                className="p-3 rounded-md bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors disabled:opacity-30 min-h-[44px]"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>

              <button
                onClick={onSkip}
                disabled={isFeedbackActive}
                className="flex-1 py-3 rounded-md bg-secondary text-secondary-foreground text-sm font-medium hover:bg-secondary/80 transition-colors disabled:opacity-30 min-h-[44px]"
              >
                Skip
              </button>

              <button
                onClick={onPrev}
                disabled={isFeedbackActive}
                className="p-3 rounded-md bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors disabled:opacity-30 min-h-[44px]"
                style={{ visibility: 'hidden' }}
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            </div>

            {/* Ignore (long-press) */}
            <div className="relative">
              <button
                onPointerDown={handleIgnoreStart}
                onPointerUp={handleIgnoreEnd}
                onPointerLeave={handleIgnoreEnd}
                disabled={isFeedbackActive}
                className="w-full relative overflow-hidden py-2 rounded-md text-xs text-muted-foreground/60 hover:text-destructive/80 transition-colors min-h-[44px] flex items-center justify-center gap-1 select-none"
                style={{ WebkitTouchCallout: 'none' }}
              >
                {/* Progress fill */}
                <div
                  className={`absolute inset-0 bg-destructive/10 origin-left ${
                    ignoreProgress ? 'scale-x-100' : 'scale-x-0'
                  }`}
                  style={{ transition: ignoreProgress ? 'transform 1s linear' : 'transform 0.1s ease-out' }}
                />
                <span className="relative z-10 flex items-center gap-1">
                  <Ban className="h-3 w-3" />
                  Hold to ignore
                </span>
              </button>
            </div>
          </>
        )}

        {/* Skip/Nav for HLTB mode */}
        {hltbMode && (
          <div className="flex items-center gap-2">
            <button
              onClick={onPrev}
              disabled={index === 0}
              className="p-3 rounded-md bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors disabled:opacity-30 min-h-[44px]"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button
              onClick={onSkip}
              className="flex-1 py-3 rounded-md bg-secondary text-secondary-foreground text-sm font-medium hover:bg-secondary/80 transition-colors min-h-[44px]"
            >
              Skip
            </button>
            <button
              disabled
              className="p-3 rounded-md bg-secondary text-secondary-foreground min-h-[44px]"
              style={{ visibility: 'hidden' }}
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
