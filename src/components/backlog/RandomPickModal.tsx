'use client';

import { useCallback, useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { X, Shuffle, Star, Clock, Users, ExternalLink } from 'lucide-react';
import type { EnrichedGame } from '@/types';

interface RandomPickModalProps {
  picked: EnrichedGame | null;
  open: boolean;
  onClose: () => void;
  onReroll: () => void;
}

export function RandomPickModal({ picked, open, onClose, onReroll }: RandomPickModalProps) {
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

  if (!open || !picked) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-card border border-border rounded-lg shadow-xl w-full max-w-md mx-4 overflow-hidden">
        {/* Close */}
        <button
          onClick={onClose}
          className="absolute top-3 right-3 z-10 p-1 rounded-md bg-black/40 text-white hover:bg-black/60 transition-colors"
        >
          <X className="h-4 w-4" />
        </button>

        {/* Game Image */}
        <div className="relative aspect-[460/215] bg-secondary">
          {picked.headerImageUrl && (
            <Image
              src={picked.headerImageUrl}
              alt={picked.title}
              fill
              className="object-cover"
              sizes="(max-width: 768px) 100vw, 420px"
            />
          )}
        </div>

        {/* Content */}
        <div className="p-4 space-y-3">
          <h2 className="text-lg font-bold">{picked.title}</h2>

          {/* Meta */}
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            {picked.reviewScore !== undefined && (
              <span className="flex items-center gap-1">
                <Star className="h-3.5 w-3.5" />
                {picked.reviewScore}%
              </span>
            )}
            {picked.hltbMain !== undefined && picked.hltbMain > 0 && (
              <span className="flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" />
                {picked.hltbMain}h
              </span>
            )}
            {picked.isCoop && (
              <span className="flex items-center gap-1">
                <Users className="h-3.5 w-3.5" />
                Co-op
              </span>
            )}
          </div>

          {/* Genres */}
          {picked.genres.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {picked.genres.slice(0, 5).map((g) => (
                <span key={g} className="px-2 py-0.5 rounded-full bg-secondary text-xs text-secondary-foreground">
                  {g}
                </span>
              ))}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            <a
              href={`steam://run/${picked.steamAppId}`}
              className="flex-1 px-4 py-2 rounded-md bg-steam-blue text-white text-sm font-medium text-center hover:bg-steam-blue/90 transition-colors flex items-center justify-center gap-1.5"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Launch
            </a>
            <Link
              href={`/games/${picked.id}`}
              className="flex-1 px-4 py-2 rounded-md border border-border text-sm font-medium text-center hover:bg-secondary transition-colors"
              onClick={onClose}
            >
              View Details
            </Link>
            <button
              onClick={onReroll}
              className="px-4 py-2 rounded-md border border-border text-sm font-medium hover:bg-secondary transition-colors flex items-center gap-1.5"
            >
              <Shuffle className="h-3.5 w-3.5" />
              Reroll
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
