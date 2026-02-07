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
      className="group rounded-lg border border-border bg-card overflow-hidden hover:border-steam-blue/50 transition-colors"
    >
      {/* Header Image */}
      <div className="relative aspect-[460/215] bg-secondary">
        {game.headerImageUrl ? (
          <Image
            src={game.headerImageUrl}
            alt={game.title}
            fill
            className="object-cover"
            sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
          />
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            No Image
          </div>
        )}

        {/* Deal Badge */}
        {game.dealRating && (
          <div className="absolute top-2 right-2">
            <DealIndicator rating={game.dealRating} score={game.dealScore} />
          </div>
        )}

        {/* Playtime Status Badge */}
        {game.isOwned && game.playtimeMinutes === 0 && (
          <span className="absolute top-2 left-2 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-500/80 text-white backdrop-blur-sm">
            Unplayed
          </span>
        )}
        {game.isOwned && game.playtimeMinutes > 0 && game.playtimeMinutes < 60 && (
          <span className="absolute top-2 left-2 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-500/80 text-white backdrop-blur-sm">
            &lt;1h played
          </span>
        )}
      </div>

      {/* Info */}
      <div className="p-3 space-y-2">
        <h3 className="font-semibold text-sm truncate group-hover:text-steam-blue transition-colors">
          {game.title}
        </h3>

        {/* Meta Row */}
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {/* Reviews */}
          {game.reviewScore !== undefined && (
            <span className="flex items-center gap-1">
              <Star className="h-3 w-3" />
              {game.reviewScore}%
            </span>
          )}

          {/* HLTB Duration */}
          {game.hltbMain !== undefined && game.hltbMain > 0 && (
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {game.hltbMain}h
            </span>
          )}

          {/* Playtime (if owned) */}
          {game.isOwned && game.playtimeMinutes > 0 && (
            <span className="text-steam-blue">
              {Math.round(game.playtimeMinutes / 60)}h played
            </span>
          )}
        </div>

        {/* Price Row */}
        {game.currentPrice !== undefined && (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {game.discountPercent && game.discountPercent > 0 ? (
                <>
                  <span className="bg-steam-sale text-white text-xs font-bold px-1.5 py-0.5 rounded">
                    -{game.discountPercent}%
                  </span>
                  <span className="text-xs text-muted-foreground line-through">
                    ${game.regularPrice?.toFixed(2)}
                  </span>
                  <span className="text-sm font-semibold text-deal-great">
                    ${game.currentPrice.toFixed(2)}
                  </span>
                </>
              ) : (
                <span className="text-sm font-medium">
                  ${game.currentPrice.toFixed(2)}
                </span>
              )}
            </div>

            {/* $/hour */}
            {game.dollarsPerHour !== undefined && (
              <span className="flex items-center gap-0.5 text-xs text-muted-foreground">
                <DollarSign className="h-3 w-3" />
                {game.dollarsPerHour.toFixed(2)}/hr
              </span>
            )}
          </div>
        )}
      </div>
    </Link>
  );
}
