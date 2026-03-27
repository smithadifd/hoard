'use client';

import { useCallback, useEffect, useState, useRef } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { X, Shuffle, Star, Clock, Users, ExternalLink } from 'lucide-react';
import type { EnrichedGame } from '@/types';

interface RandomPickModalProps {
  finalPick: EnrichedGame | null;
  candidates: EnrichedGame[];
  open: boolean;
  onClose: () => void;
  onReroll: () => void;
}

export function RandomPickModal({ finalPick, candidates, open, onClose, onReroll }: RandomPickModalProps) {
  const [phase, setPhase] = useState<'spinning' | 'slowing' | 'landed'>('spinning');
  const [displayGame, setDisplayGame] = useState<EnrichedGame | null>(null);
  const animationRef = useRef<{ cleanup: () => void } | null>(null);

  // Close on Escape
  const handleKey = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    },
    [onClose]
  );

  useEffect(() => {
    if (open) {
      document.addEventListener('keydown', handleKey);
      return () => document.removeEventListener('keydown', handleKey);
    }
  }, [open, handleKey]);

  // Run animation when modal opens or finalPick changes
  useEffect(() => {
    if (!open || !finalPick) return;

    // Cleanup any previous animation
    if (animationRef.current) {
      animationRef.current.cleanup();
    }

    // Not enough games for animation — skip to result
    if (candidates.length < 3) {
      setDisplayGame(finalPick);
      setPhase('landed');
      return;
    }

    setPhase('spinning');
    let i = 0;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const intervals: ReturnType<typeof setInterval>[] = [];

    // Phase 1: Fast cycling (50ms intervals, ~800ms)
    const fastInterval = setInterval(() => {
      setDisplayGame(candidates[i % candidates.length]);
      i++;
    }, 50);
    intervals.push(fastInterval);

    // Phase 2: Slow down after 800ms
    const slowTimer = setTimeout(() => {
      clearInterval(fastInterval);
      setPhase('slowing');

      const slowInterval = setInterval(() => {
        setDisplayGame(candidates[i % candidates.length]);
        i++;
      }, 150);
      intervals.push(slowInterval);

      // Phase 3: Land on final pick after another 1200ms
      const landTimer = setTimeout(() => {
        clearInterval(slowInterval);
        setDisplayGame(finalPick);
        setPhase('landed');
      }, 1200);
      timers.push(landTimer);
    }, 800);
    timers.push(slowTimer);

    const cleanup = () => {
      intervals.forEach(clearInterval);
      timers.forEach(clearTimeout);
    };
    animationRef.current = { cleanup };

    return cleanup;
  }, [open, finalPick, candidates]);

  if (!open || !finalPick) return null;

  const game = displayGame ?? finalPick;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={phase === 'landed' ? onClose : undefined}
      />

      {/* Modal */}
      <div className="relative bg-card border border-white/[0.08] rounded-lg shadow-xl w-full max-w-md mx-4 overflow-hidden">
        {/* Close */}
        {phase === 'landed' && (
          <button
            onClick={onClose}
            className="absolute top-3 right-3 z-10 p-1 rounded-md bg-black/40 text-white hover:bg-black/60 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        )}

        {/* Game Image */}
        <div className={`relative aspect-[460/215] bg-secondary transition-all duration-200 ${
          phase === 'spinning' ? 'scale-[0.97] opacity-80' :
          phase === 'slowing' ? 'scale-[0.99] opacity-90' :
          'scale-100 opacity-100'
        }`}>
          {game.headerImageUrl && (
            <Image
              src={game.headerImageUrl}
              alt={game.title}
              fill
              className="object-cover"
              sizes="(max-width: 768px) 100vw, 420px"
            />
          )}
        </div>

        {/* Content */}
        <div className="p-4 space-y-3">
          <h2 className={`text-lg font-bold transition-opacity duration-200 ${
            phase !== 'landed' ? 'opacity-70' : 'opacity-100'
          }`}>
            {game.title}
          </h2>

          {/* Meta */}
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            {game.reviewScore !== undefined && (
              <span className="flex items-center gap-1">
                <Star className="h-3.5 w-3.5" />
                {game.reviewScore}%
              </span>
            )}
            {game.hltbMain !== undefined && game.hltbMain > 0 && (
              <span className="flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" />
                {game.hltbMain}h
              </span>
            )}
            {game.isCoop && (
              <span className="flex items-center gap-1">
                <Users className="h-3.5 w-3.5" />
                Co-op
              </span>
            )}
          </div>

          {/* Genres */}
          {game.genres.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {game.genres.slice(0, 5).map((g) => (
                <span key={g} className="px-2 py-0.5 rounded-full bg-secondary text-xs text-secondary-foreground">
                  {g}
                </span>
              ))}
            </div>
          )}

          {/* Landing celebration */}
          {phase === 'landed' && (
            <p className="text-sm text-muted-foreground text-center animate-in fade-in slide-in-from-bottom-2 duration-500">
              Your pick is in!
            </p>
          )}

          {/* Action buttons — only show after landing */}
          {phase === 'landed' && (
            <div className="flex gap-2 pt-1 animate-in fade-in duration-300">
              <a
                href={`steam://run/${game.steamAppId}`}
                className="flex-1 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium text-center hover:bg-primary/90 transition-colors flex items-center justify-center gap-1.5"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Launch
              </a>
              <Link
                href={`/games/${game.id}`}
                className="flex-1 px-4 py-2 rounded-md border border-white/[0.08] text-sm font-medium text-center hover:bg-secondary transition-colors"
                onClick={onClose}
              >
                View Details
              </Link>
              <button
                onClick={onReroll}
                className="px-4 py-2 rounded-md border border-white/[0.08] text-sm font-medium hover:bg-secondary transition-colors flex items-center gap-1.5"
              >
                <Shuffle className="h-3.5 w-3.5" />
                Reroll
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
