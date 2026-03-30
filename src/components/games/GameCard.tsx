import Image from 'next/image';
import Link from 'next/link';
import { Clock, Star, DollarSign } from 'lucide-react';
import type { EnrichedGame } from '@/types';
import { DealIndicator } from '@/components/prices/DealIndicator';

/**
 * GameCard - Displays a game in the grid view with key info at a glance.
 *
 * Shows: header image, title, review score, HLTB duration,
 * current price, deal indicator, and playtime (if owned).
 */
interface GameCardProps {
  game: EnrichedGame;
}

export function GameCard({ game }: GameCardProps) {
  return (
    <Link
      href={`/games/${game.id}`}
      className="group rounded-xl bg-card overflow-hidden transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-black/30"
    >
      {/* Header Image */}
      <div className="relative aspect-[460/215] bg-surface-lowest overflow-hidden">
        {game.headerImageUrl ? (
          <Image
            src={game.headerImageUrl}
            alt={game.title}
            fill
            className="object-cover transition-transform duration-500 group-hover:scale-105"
            sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
          />
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            No Image
          </div>
        )}

        {/* Bottom gradient overlay */}
        <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-card to-transparent" />

        {/* Deal Badge */}
        {game.dealRating && (
          <div className="absolute top-2 right-2">
            <DealIndicator rating={game.dealRating} score={game.dealScore} lowConfidence={game.dataCompleteness === 'minimal'} />
          </div>
        )}

        {/* Coming Soon Badge (non-owned unreleased games) */}
        {game.isReleased === false && !game.isOwned && (
          <span className="absolute top-2 left-2 px-1.5 py-0.5 rounded text-[10px] font-label font-semibold bg-teal/80 text-white backdrop-blur-sm">
            Coming Soon
          </span>
        )}

        {/* Playtime Status Badge */}
        {game.isOwned && game.playtimeMinutes === 0 && (
          <span className="absolute top-2 left-2 px-1.5 py-0.5 rounded text-[10px] font-label font-semibold bg-primary/80 text-primary-foreground backdrop-blur-sm">
            Unplayed
          </span>
        )}
        {game.isOwned && game.playtimeMinutes > 0 && game.playtimeMinutes < 60 && (
          <span className="absolute top-2 left-2 px-1.5 py-0.5 rounded text-[10px] font-label font-semibold bg-deal-okay/80 text-primary-foreground backdrop-blur-sm">
            &lt;1h played
          </span>
        )}
      </div>

      {/* Info */}
      <div className="p-3 space-y-2">
        <h3 className="font-headline font-semibold text-sm truncate group-hover:text-primary transition-colors">
          {game.title}
        </h3>

        {/* Meta Row */}
        <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
          {/* Reviews */}
          {game.reviewScore !== undefined ? (
            <span className="flex items-center gap-1 font-label">
              <Star className="h-3 w-3 text-teal" />
              {game.reviewScore}%
            </span>
          ) : (
            <span className="text-[10px] text-muted-foreground/60">No reviews</span>
          )}

          {/* HLTB Duration */}
          {game.hltbMain !== undefined && game.hltbMain > 0 ? (
            <span className="flex items-center gap-1 font-label">
              <Clock className="h-3 w-3" />
              {game.hltbMain}h
            </span>
          ) : game.reviewScore !== undefined ? (
            <span className="text-[10px] text-muted-foreground/60">No duration</span>
          ) : null}

          {/* Playtime (if owned) */}
          {game.isOwned && game.playtimeMinutes > 0 && (
            <span className="text-primary font-label">
              {Math.round(game.playtimeMinutes / 60)}h played
            </span>
          )}
        </div>

        {/* Price Row */}
        {game.currentPrice !== undefined ? (
          <div className="flex items-center justify-between gap-y-1 flex-wrap">
            <div className="flex items-center gap-2 min-w-0 flex-wrap gap-y-1">
              {game.discountPercent && game.discountPercent > 0 ? (
                <>
                  <span className="bg-primary text-primary-foreground text-xs font-label font-bold px-1.5 py-0.5 rounded">
                    -{game.discountPercent}%
                  </span>
                  <span className="text-xs text-muted-foreground line-through font-label">
                    ${game.regularPrice?.toFixed(2)}
                  </span>
                  <span className="text-sm font-label font-bold text-teal">
                    ${game.currentPrice.toFixed(2)}
                  </span>
                </>
              ) : (
                <span className="text-sm font-label font-medium">
                  ${game.currentPrice.toFixed(2)}
                </span>
              )}
            </div>

            {/* $/hour */}
            {game.dollarsPerHour !== undefined && (
              <span className="flex items-center gap-0.5 text-xs text-muted-foreground font-label">
                <DollarSign className="h-3 w-3" />
                {game.dollarsPerHour.toFixed(2)}/hr
              </span>
            )}
          </div>
        ) : (
          <div className="text-[10px] text-muted-foreground/60">No price data</div>
        )}
      </div>
    </Link>
  );
}
