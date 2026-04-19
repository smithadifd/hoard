---
title: Features overview
description: A tour of every page in Hoard — what each one shows and what you can do there.
---

Hoard has six main pages: Dashboard, Library, Wishlist, Releases, Backlog, and Watchlist. Each one reads from the local SQLite database, so they're fast and work even when upstream APIs are unavailable.

<!-- Screenshot placeholder: Dashboard -->

## Dashboard (`/`)

The dashboard gives you a one-screen summary of your collection. Six compact stat cards link to the relevant pages: library size, wishlist count, active alert count, total playtime, wishlist games currently on sale, and unplayed backlog count.

Below the stats, two Recharts charts fill in the picture: a genre breakdown bar chart (`GenreChart`) and a deal score distribution histogram (`DealScoreChart`). A recent activity feed shows the latest price drops, newly wishlisted games, and recently played titles. If you have unreleased wishlist games, up to five appear in an upcoming releases card with their release dates, linking through to `/releases`.

A footer bar shows when data was last synced and provides quick links to Library, Wishlist, Backlog, and Watchlist.

## Library (`/library`)

Your owned Steam games. The page defaults to alphabetical order and loads 24 games at a time, adding more as you scroll via `InfiniteGameGrid`. `GameListFilters` sits above the grid and lets you filter by search, genre, tags, review score, duration, co-op support, and playtime status.

Every game card links to its detail page at `/games/[id]`, where you can see the full price history chart, review breakdown, HowLongToBeat estimates, and deal score.

## Wishlist (`/wishlist`)

Your Steam wishlist, sorted by deal score (highest first) by default. The page filters out unreleased games and games with incomplete price/review data by default — the subtitle shows a count of what's hidden and links to toggle it back in. A separate link points to `/releases` for the unreleased games.

Filter and sort controls are the same `GameListFilters` component as the library. Like the library, the grid is infinite-scrolling.

## Releases (`/releases`)

Unreleased games from your wishlist, grouped into time buckets by `parseReleaseDate` and `getReleaseBucket` from `src/lib/utils/releaseDate.ts`. The `ReleaseTimeline` component renders each bucket as a labeled section: games overdue for release are highlighted in amber, others are grouped into near-term and longer-horizon buckets. A search field lets you filter within the timeline by title.

Games move off this page and onto the wishlist automatically after the `price-check` task runs `checkReleaseStatus`, which polls the Steam Store API for newly released titles.

## Backlog (`/backlog`)

Unplayed and barely-started games from your library. The backlog applies strict filters by default — games without HowLongToBeat duration data or Steam review data are excluded so filter results are reliable. A toggle in the subtitle lets you include games with missing data.

`BacklogFilters` offers five preset moods that apply preset filter combinations:

| Preset | What it matches |
|---|---|
| Date Night | Co-op games under 10 hours |
| Quick Play | Games finishable in under 5 hours with 75%+ reviews |
| Deep Dive | 40+ hour games with 75%+ reviews |
| Hidden Gems | 85%+ reviews with under 5,000 review count |
| Play Again | Games you've played heavily but not touched in a long time |

A "Pick for me" button (`PickForMePanel`) fetches all candidates matching your current filters and picks one at random.

For a deeper look at filter logic, presets, and the pick-for-me behavior, see [Backlog](/features/backlog/).

## Watchlist (`/watchlist`)

A table view of all games you've flagged for price alerts, managed by `WatchlistTable`. Each row shows the game, your target price threshold, and the last time the alert fired. The header shows a count of active alerts and how many triggered in the past week.

Alert evaluation runs automatically after every price sync (every 12 hours by default). Hoard sends individual Discord messages for new all-time lows and groups repeated still-at-ATL alerts into a digest to reduce noise. You set per-game price thresholds on the game detail page, or flag a game for notify-on-ATL without a specific threshold.

For configuration, throttle settings, and how Discord notifications work, see [Alerts](/features/alerts/).
