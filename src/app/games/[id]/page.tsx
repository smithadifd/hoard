import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Star, Clock, Gamepad2, DollarSign, ExternalLink, Users } from 'lucide-react';
import { getEnrichedGameById, getPriceAlertForGame, getScoringConfig } from '@/lib/db/queries';
import { getSession } from '@/lib/auth-helpers';
import { calculateDealScore } from '@/lib/scoring/engine';
import { GameImage } from '@/components/games/GameImage';
import { GameUserControls } from '@/components/games/GameUserControls';
import { PriceBadge } from '@/components/prices/PriceBadge';
import { DealIndicator } from '@/components/prices/DealIndicator';
import { ScoreBreakdown } from '@/components/prices/ScoreBreakdown';
import { ValueReceivedBreakdown } from '@/components/prices/ValueReceivedBreakdown';
import { PriceHistoryChart } from '@/components/prices/PriceHistoryChart';
import { DataStatus } from '@/components/games/DataStatus';
import { HltbEditor } from '@/components/games/HltbEditor';
import { PricePaidEditor } from '@/components/games/PricePaidEditor';
import { EnjoymentRatingEditor } from '@/components/games/EnjoymentRatingEditor';
import { PricePaidSuggestionPrompt } from '@/components/games/PricePaidSuggestionPrompt';
import { LookupModeBanner } from '@/components/games/LookupModeBanner';
import { ITADOverviewCard } from '@/components/games/ITADOverviewCard';
import { AddToWishlistCTA } from '@/components/games/AddToWishlistCTA';
import { HltbAutoFetch } from '@/components/games/HltbAutoFetch';
import { SteamPlaytimeAutoFetch } from '@/components/games/SteamPlaytimeAutoFetch';
import { PlaytimeSourceToggle } from '@/components/games/PlaytimeSourceToggle';
import { EnsurePriceHistory } from '@/components/games/EnsurePriceHistory';
import { PRICE_HISTORY_GIVE_UP_MISSES, STEAM_PLAYTIME_GIVE_UP_MISSES } from '@/lib/db/queries';

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

  // Lookup mode: game exists in DB from a search lookup but not yet in user's library/wishlist.
  // lastViewedAt is stamped by /api/games/lookup on click (both insert and existing-row paths),
  // so we don't need a side-effecting write here in the render path.
  const isLookupMode = game.source === 'lookup' && !game.isOwned && !game.isWishlisted && !game.isWatchlisted;

  // Eligible for the one-shot price-history backfill: never backfilled and not yet
  // given up. Independent of lookup mode — a freshly Hoard-only wishlisted game may
  // still lack history. The server route is idempotent and guards the same way.
  const eligibleForHistoryBackfill =
    !game.priceHistoryBackfilledAt &&
    (game.priceHistoryMissCount ?? 0) < PRICE_HISTORY_GIVE_UP_MISSES;

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
      {/* HLTB auto-fetch trigger (lookup mode only, invisible) */}
      {isLookupMode && game.hltbMain === undefined && (
        <HltbAutoFetch gameId={game.id} />
      )}

      {/* Steam-review playtime auto-fetch trigger (invisible, once per game until
          a median lands or we give up). Best-effort gap-fill for the $/hour basis. */}
      {game.steamPlaytimeMedian === undefined &&
        (game.steamPlaytimeMissCount ?? 0) < STEAM_PLAYTIME_GIVE_UP_MISSES && (
          <SteamPlaytimeAutoFetch gameId={game.id} />
        )}

      {/* Price-history auto-backfill trigger (invisible, once per game) */}
      {eligibleForHistoryBackfill && <EnsurePriceHistory gameId={game.id} />}

      {/* Back Link */}
      <Link
        href="/library"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Library
      </Link>

      {/* Lookup mode banner */}
      {isLookupMode && <LookupModeBanner />}

      {/* Header Image */}
      <div className="relative aspect-[460/215] max-w-2xl rounded-xl overflow-hidden bg-surface-lowest">
        <GameImage
          src={game.headerImageUrl}
          title={game.title}
          fill
          className="object-cover"
          sizes="(max-width: 768px) 100vw, 672px"
          priority
        />
        <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-background to-transparent" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Title & Meta */}
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-3xl font-headline font-extrabold tracking-tight">{game.title}</h1>
              {game.isEarlyAccess && (
                <span className="px-2 py-0.5 rounded-md text-xs font-label font-semibold uppercase tracking-wide bg-amber-500/15 text-amber-400">
                  Early Access
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
              {game.developer && <span>{game.developer}</span>}
              {game.developer && game.releaseDate && <span>&middot;</span>}
              {game.releaseDate && <span>{game.releaseDate}</span>}
            </div>
            {game.isEarlyAccess && game.metadataLastUpdated && (
              <div className="mt-1 text-xs text-muted-foreground">
                In Early Access — last refreshed {new Date(game.metadataLastUpdated).toLocaleDateString('en-US', { timeZone: 'UTC' })}
              </div>
            )}
          </div>

          {/* Quick Stats */}
          <div className="flex flex-wrap gap-4">
            {game.reviewScore !== undefined && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-card">
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

            {!isLookupMode && game.isOwned && game.playtimeMinutes > 0 && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-card">
                <Gamepad2 className="h-4 w-4 text-primary" />
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
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-card">
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

            {game.steamPlaytimeMedian !== undefined && game.steamPlaytimeMedian > 0 && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-card">
                <Users className="h-4 w-4 text-muted-foreground" />
                <div>
                  <div className="text-sm font-medium">
                    ~{game.steamPlaytimeMedian}h median play
                    {game.playtimeSource === 'steam_reviews' && (
                      <span className="ml-1.5 inline-block px-1.5 py-0.5 rounded text-[10px] bg-primary/10 text-primary align-middle">
                        $/hr basis
                      </span>
                    )}
                  </div>
                  {game.steamPlaytimeSampleSize !== undefined && (
                    <div className="text-xs text-muted-foreground">
                      from {game.steamPlaytimeSampleSize.toLocaleString()} reviews
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Price Section — lookup mode shows live ITAD overview, library mode shows history */}
          {isLookupMode ? (
            <>
              <ITADOverviewCard gameId={game.id} />
              {/* Gut-check price history — backfilled on demand by EnsurePriceHistory above. */}
              <section className="rounded-xl bg-card p-5">
                <h3 className="text-xs font-label font-medium uppercase tracking-widest text-muted-foreground mb-3">
                  Price History
                </h3>
                <PriceHistoryChart gameId={game.id} />
              </section>
              <AddToWishlistCTA gameId={game.id} />
            </>
          ) : (
            game.currentPrice !== undefined && (
              <section className="rounded-xl bg-card p-5 space-y-3">
                <h2 className="text-xs font-label font-semibold uppercase tracking-widest text-muted-foreground">Pricing</h2>
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
                        lowConfidence={game.dataCompleteness !== 'full'}
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
                            className="text-primary hover:underline font-medium"
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
                <div className="mt-4 pt-3 border-t border-white/[0.06]">
                  <h3 className="text-xs font-label font-medium uppercase tracking-widest text-muted-foreground mb-3">
                    Price History
                  </h3>
                  <PriceHistoryChart gameId={game.id} />
                </div>
              </section>
            )
          )}

          {/* Score Breakdown — owned games lead with Value Received; others show the buy score */}
          {game.isOwned && game.valueReceivedTier ? (
            <ValueReceivedBreakdown game={game} />
          ) : (
            fullDealScore && (
              <ScoreBreakdown
                dealScore={fullDealScore}
                weights={scoringConfig.weights}
                hasReviewData={game.reviewScore !== undefined}
                hasHltbData={game.hltbMain !== undefined && game.hltbMain > 0}
              />
            )
          )}

          {/* Price-paid suggestion — nudge to confirm a captured estimate (Phase 3) */}
          {!isLookupMode && game.isOwned && game.hasPricePaidSuggestion && game.pricePaidSuggested !== undefined && (
            <PricePaidSuggestionPrompt gameId={game.id} suggested={game.pricePaidSuggested} />
          )}

          {/* Description */}
          {game.description && (
            <section className="rounded-xl bg-card p-5">
              <h2 className="text-xs font-label font-semibold uppercase tracking-widest text-muted-foreground mb-2">About</h2>
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
                      className="px-2 py-1 rounded-md bg-primary/10 text-primary text-xs font-medium"
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
              <span className="px-2 py-1 rounded-md bg-teal/10 text-teal text-xs font-medium">
                Owned
              </span>
            )}
            {game.isWishlisted && (
              <span className="px-2 py-1 rounded-md bg-pink-500/10 text-pink-500 text-xs font-medium">
                Wishlisted
              </span>
            )}
            {game.isWishlisted && game.wishlistedLocally && (
              <span
                className="px-2 py-1 rounded-md bg-amber-500/10 text-amber-400 text-xs font-medium"
                title="On your Hoard wishlist but not your Steam wishlist"
              >
                Not on Steam
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
          {/* User Controls — hidden in lookup mode */}
          {!isLookupMode && (
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
          )}

          {/* HLTB Duration Editor — hidden in lookup mode */}
          {!isLookupMode && (
            <HltbEditor
              gameId={game.id}
              gameTitle={game.title}
              hltbMain={game.hltbMain}
              hltbMainExtra={game.hltbMainExtra}
              hltbCompletionist={game.hltbCompletionist}
              hltbManual={game.hltbManual}
              hltbMissCount={game.hltbMissCount}
            />
          )}

          {/* Playtime-source toggle — pick which playtime drives $/hour. Shown once
              a Steam-review median exists, so there's a genuine choice to make. */}
          {!isLookupMode && game.steamPlaytimeMedian !== undefined && (
            <PlaytimeSourceToggle
              gameId={game.id}
              source={game.playtimeSource ?? 'hltb'}
              hltbMain={game.hltbMain}
              steamPlaytimeMedian={game.steamPlaytimeMedian}
            />
          )}

          {/* Price Paid Editor — owned games only (unlocks the realized $/hr lens).
              Hidden while a suggestion is pending; the prompt above handles entry then. */}
          {!isLookupMode && game.isOwned && !game.hasPricePaidSuggestion && (
            <PricePaidEditor gameId={game.id} pricePaid={game.pricePaid} />
          )}

          {/* Enjoyment Rating Editor — owned games only. Once set, the rating leads
              the Value Received verdict and demotes $/hr to supporting context. */}
          {!isLookupMode && game.isOwned && (
            <EnjoymentRatingEditor gameId={game.id} enjoymentRating={game.enjoymentRating} />
          )}

          {/* External Links */}
          <div className="rounded-xl bg-card p-5">
            <h3 className="text-xs font-label font-semibold uppercase tracking-widest text-muted-foreground mb-3">Links</h3>

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

