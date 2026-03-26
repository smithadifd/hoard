import { notFound, redirect } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { ArrowLeft, Star, Clock, Gamepad2, DollarSign, ExternalLink } from 'lucide-react';
import { getEnrichedGameById, getPriceAlertForGame, getScoringConfig } from '@/lib/db/queries';
import { getSession } from '@/lib/auth-helpers';
import { calculateDealScore } from '@/lib/scoring/engine';
import { GameUserControls } from '@/components/games/GameUserControls';
import { PriceBadge } from '@/components/prices/PriceBadge';
import { DealIndicator } from '@/components/prices/DealIndicator';
import { ScoreBreakdown } from '@/components/prices/ScoreBreakdown';
import { PriceHistoryChart } from '@/components/prices/PriceHistoryChart';
import { DataStatus } from '@/components/games/DataStatus';
import { HltbEditor } from '@/components/games/HltbEditor';

export const dynamic = 'force-dynamic';

export default async function GameDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getSession();
  if (!session) redirect('/login');

  const { id } = await params;
  const gameId = parseInt(id);
  if (isNaN(gameId)) notFound();

  const game = getEnrichedGameById(gameId, session.user.id);
  if (!game) notFound();

  const alert = getPriceAlertForGame(gameId, session.user.id);

  // Compute full deal score breakdown for transparency display
  const scoringConfig = getScoringConfig();
  const fullDealScore = game.currentPrice !== undefined && game.currentPrice > 0
    ? calculateDealScore({
        currentPrice: game.currentPrice,
        regularPrice: game.regularPrice ?? game.currentPrice,
        historicalLow: game.historicalLow ?? game.currentPrice,
        reviewPercent: game.reviewScore ?? null,
        hltbMainHours: game.hltbMain ?? null,
        personalInterest: game.personalInterest,
      }, scoringConfig.weights, scoringConfig.thresholds)
    : null;

  return (
    <div className="space-y-6">
      {/* Back Link */}
      <Link
        href="/library"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Library
      </Link>

      {/* Header Image */}
      {game.headerImageUrl && (
        <div className="relative aspect-[460/215] max-w-2xl rounded-lg overflow-hidden bg-secondary">
          <Image
            src={game.headerImageUrl}
            alt={game.title}
            fill
            className="object-cover"
            sizes="(max-width: 768px) 100vw, 672px"
            priority
          />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Title & Meta */}
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{game.title}</h1>
            <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
              {game.developer && <span>{game.developer}</span>}
              {game.developer && game.releaseDate && <span>&middot;</span>}
              {game.releaseDate && <span>{game.releaseDate}</span>}
            </div>
          </div>

          {/* Quick Stats */}
          <div className="flex flex-wrap gap-4">
            {game.reviewScore !== undefined && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-card border border-border">
                <Star className="h-4 w-4 text-yellow-500" />
                <div>
                  <div className="text-sm font-medium">
                    {game.reviewDescription || `${game.reviewScore}%`}
                  </div>
                  {game.reviewCount !== undefined && (
                    <div className="text-xs text-muted-foreground">
                      {game.reviewCount.toLocaleString()} reviews
                    </div>
                  )}
                </div>
              </div>
            )}

            {game.isOwned && game.playtimeMinutes > 0 && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-card border border-border">
                <Gamepad2 className="h-4 w-4 text-steam-blue" />
                <div>
                  <div className="text-sm font-medium">
                    {Math.round(game.playtimeMinutes / 60)} hours played
                  </div>
                  <div className="text-xs text-muted-foreground">
                    in your library
                  </div>
                </div>
              </div>
            )}

            {game.hltbMain !== undefined && game.hltbMain > 0 && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-card border border-border">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <div>
                  <div className="text-sm font-medium">{game.hltbMain}h main</div>
                  {game.hltbMainExtra !== undefined && game.hltbMainExtra > 0 && (
                    <div className="text-xs text-muted-foreground">
                      {game.hltbMainExtra}h completionist
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Price Section */}
          {game.currentPrice !== undefined && (
            <section className="rounded-lg border border-border bg-card p-4 space-y-3">
              <h2 className="text-sm font-semibold">Pricing</h2>
              <div className="flex items-center justify-between flex-wrap gap-4">
                <div className="flex items-center gap-4">
                  <PriceBadge
                    currentPrice={game.currentPrice}
                    regularPrice={game.regularPrice}
                    discountPercent={game.discountPercent}
                    historicalLow={game.historicalLow}
                  />
                  {game.dealRating && (
                    <DealIndicator
                      rating={game.dealRating}
                      score={game.dealScore}
                    />
                  )}
                </div>
                <div className="text-right text-sm">
                  {game.bestStore && (
                    <div className="text-muted-foreground">
                      Best at{' '}
                      {game.storeUrl ? (
                        <a
                          href={game.storeUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-steam-blue hover:underline font-medium"
                        >
                          {game.bestStore} <ExternalLink className="inline h-3 w-3" />
                        </a>
                      ) : (
                        <span className="text-foreground font-medium">{game.bestStore}</span>
                      )}
                    </div>
                  )}
                  {game.dollarsPerHour !== undefined && (
                    <div className="flex items-center gap-1 text-muted-foreground justify-end">
                      <DollarSign className="h-3 w-3" />
                      <span>{game.dollarsPerHour.toFixed(2)}/hr</span>
                    </div>
                  )}
                </div>
              </div>
              {game.dealSummary && (
                <p className="text-xs text-muted-foreground">{game.dealSummary}</p>
              )}
              {game.historicalLow !== undefined && (
                <p className="text-xs text-muted-foreground">
                  Historical low: ${game.historicalLow.toFixed(2)}
                  {game.isAtHistoricalLow && (
                    <span className="ml-1 text-deal-great font-bold">Currently at ATL!</span>
                  )}
                </p>
              )}
              <div className="mt-4 pt-3 border-t border-border">
                <h3 className="text-sm font-medium text-muted-foreground mb-3">
                  Price History
                </h3>
                <PriceHistoryChart gameId={game.id} />
              </div>
            </section>
          )}

          {/* Score Breakdown */}
          {fullDealScore && (
            <ScoreBreakdown
              dealScore={fullDealScore}
              weights={scoringConfig.weights}
              hasReviewData={game.reviewScore !== undefined}
              hasHltbData={game.hltbMain !== undefined && game.hltbMain > 0}
            />
          )}

          {/* Description */}
          {game.description && (
            <section className="rounded-lg border border-border bg-card p-4">
              <h2 className="text-sm font-semibold mb-2">About</h2>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {game.description}
              </p>
            </section>
          )}

          {/* Tags & Genres */}
          {(game.genres.length > 0 || game.tags.length > 0) && (
            <div className="space-y-2">
              {game.genres.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {game.genres.map((g) => (
                    <span
                      key={g}
                      className="px-2 py-1 rounded-md bg-steam-blue/10 text-steam-blue text-xs font-medium"
                    >
                      {g}
                    </span>
                  ))}
                </div>
              )}
              {game.tags.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {game.tags.slice(0, 15).map((t) => (
                    <span
                      key={t}
                      className="px-2 py-1 rounded-md bg-secondary text-secondary-foreground text-xs"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Status Badges */}
          <div className="flex flex-wrap gap-2">
            {game.isOwned && (
              <span className="px-2 py-1 rounded-md bg-steam-green/10 text-steam-green text-xs font-medium">
                Owned
              </span>
            )}
            {game.isWishlisted && (
              <span className="px-2 py-1 rounded-md bg-pink-500/10 text-pink-500 text-xs font-medium">
                Wishlisted
              </span>
            )}
            {game.isReleased === false && (
              <span className="px-2 py-1 rounded-md bg-blue-600/10 text-blue-400 text-xs font-medium">
                Coming Soon
              </span>
            )}
            {game.isCoop && (
              <span className="px-2 py-1 rounded-md bg-purple-500/10 text-purple-400 text-xs font-medium">
                Co-op
              </span>
            )}
            {game.isMultiplayer && (
              <span className="px-2 py-1 rounded-md bg-orange-500/10 text-orange-400 text-xs font-medium">
                Multiplayer
              </span>
            )}
          </div>

          {/* Data Status */}
          <DataStatus
            reviewLastUpdated={game.reviewLastUpdated}
            hltbLastUpdated={game.hltbLastUpdated}
            priceLastUpdated={game.priceLastUpdated}
          />
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          {/* User Controls */}
          <GameUserControls
            gameId={game.id}
            steamAppId={game.steamAppId}
            isWishlisted={game.isWishlisted}
            interest={game.personalInterest}
            isWatchlisted={game.isWatchlisted}
            isIgnored={game.isIgnored}
            autoAlertDisabled={game.autoAlertDisabled}
            priceThreshold={alert?.targetPrice ?? undefined}
            notifyOnAllTimeLow={alert?.notifyOnAllTimeLow}
            notifyOnThreshold={alert?.notifyOnThreshold}
            currentPrice={game.currentPrice}
            lastNotifiedAt={alert?.lastNotifiedAt ?? undefined}
          />

          {/* HLTB Duration Editor */}
          <HltbEditor
            gameId={game.id}
            gameTitle={game.title}
            hltbMain={game.hltbMain}
            hltbMainExtra={game.hltbMainExtra}
            hltbCompletionist={game.hltbCompletionist}
            hltbManual={game.hltbManual}
            hltbMissCount={game.hltbMissCount}
          />

          {/* External Links */}
          <div className="rounded-lg border border-border bg-card p-4">
            <h3 className="text-sm font-semibold mb-3">Links</h3>

            <div className="space-y-1">
              <ExternalLinkItem
                href={`https://store.steampowered.com/app/${game.steamAppId}`}
                label="Steam Store"
              />
              <ExternalLinkItem
                href={`https://steamdb.info/app/${game.steamAppId}/`}
                label="SteamDB"
              />
              <ExternalLinkItem
                href={`https://www.protondb.com/app/${game.steamAppId}`}
                label="ProtonDB"
              />
            </div>

            <p className="text-xs font-medium text-muted-foreground mt-3 mb-1">Prices</p>
            <div className="space-y-1">
              {game.storeUrl && (
                <ExternalLinkItem href={game.storeUrl} label="IsThereAnyDeal" />
              )}
              <ExternalLinkItem
                href={`https://gg.deals/games/?title=${encodeURIComponent(game.title)}`}
                label="GG.deals"
              />
            </div>

            <p className="text-xs font-medium text-muted-foreground mt-3 mb-1">Stores</p>
            <div className="space-y-1">
              <ExternalLinkItem
                href={`https://www.gog.com/en/games?query=${encodeURIComponent(game.title)}`}
                label="GOG"
              />
              <ExternalLinkItem
                href={`https://www.greenmangaming.com/search?query=${encodeURIComponent(game.title)}`}
                label="Green Man Gaming"
              />
              <ExternalLinkItem
                href={`https://www.fanatical.com/en/search?search=${encodeURIComponent(game.title)}`}
                label="Fanatical"
              />
            </div>

            <p className="text-xs font-medium text-muted-foreground mt-3 mb-1">Grey Market</p>
            <div className="space-y-1">
              <ExternalLinkItem
                href={`https://www.eneba.com/store?text=${encodeURIComponent(game.title)}`}
                label="Eneba"
              />
              <ExternalLinkItem
                href={`https://www.loaded.com/customsearch?q=${encodeURIComponent(game.title)}`}
                label="loaded.com"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ExternalLinkItem({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center justify-between text-sm text-muted-foreground hover:text-foreground transition-colors py-1"
    >
      {label}
      <ExternalLink className="h-3 w-3" />
    </a>
  );
}

