---
title: Backlog recommender
description: How the Backlog page works — filters, presets, the mood picker, and the Pick for Me mechanic.
---

The Backlog page (`/backlog`) surfaces owned games you haven't played yet, or have barely started. It's built around one question: what should I play next?

## What counts as backlog

By default the page uses `playtimeStatus: 'backlog'`, which matches two kinds of games:

- Games where you've played less than `backlog_threshold_percent` of the HowLongToBeat main-story estimate. The default threshold is 10% — so a 20-hour game counts as backlog until you've logged 2 hours.
- Games with no HLTB data, where you've played less than 15 minutes (the `BACKLOG_FALLBACK_MINUTES` constant in `src/lib/db/queries.ts`).

The threshold is configurable via the `backlog_threshold_percent` setting (range: 1–50). Games flagged with `isIgnored` are always excluded when `playtimeStatus` is `backlog` — marking a game ignored removes it from the pool without deleting your library record.

## Strict filters

The backlog always starts with `strictFilters: true`. This means filter conditions like `maxHours` and `minReview` only match games that have the relevant data — games missing HLTB hours or Steam review scores don't slip through. The subtitle shows how many games are hidden this way, with a toggle to turn strict mode off and include incomplete records.

The data-quality filters that operate independently of `strictFilters`:

- `requireCompleteData` — requires `reviewScore` not null, `hltbMain` not null and > 0, and at least one row in `price_snapshots`. More demanding than strict mode.
- `hideUnreleased` — excludes games where `isReleased` is false.

## Filters

`BacklogFilters` passes a `GameFilters` object down to the standard filter controls plus the backlog-specific panels. The relevant fields:

| Filter | Type | What it does |
|---|---|---|
| `maxHours` / `minHours` | `number` | Duration bounds against `hltbMain` |
| `genres` | `string[]` | Matches any of the listed genres (OR logic) |
| `excludeTags` | `string[]` | Excludes games that have any of the listed tags |
| `coop` | `boolean` | When true, only co-op games; when false, only solo |
| `minInterest` | `number` | Minimum personal interest rating (1–5) |
| `hideUnreleased` | `boolean` | Filters out unreleased games |
| `requireCompleteData` | `boolean` | Requires review score, HLTB data, and price history |
| `isIgnored` | `boolean` | Stored per game in `user_games`; excluded automatically in backlog mode |
| `minReview` | `number` | Minimum Steam review percentage |

## Presets

Six presets live in `src/lib/backlog/presets.ts` as `BACKLOG_PRESETS`. Each one is a named `Partial<GameFilters>` — clicking one applies the full filter combination at once. The page counts matching games for each preset before rendering so the preset buttons show live numbers.

| Preset | Filters applied |
|---|---|
| Date Night | `coop: true`, `maxHours: 10` |
| Quick Play | `maxHours: 5`, `minReview: 75` |
| Deep Dive | `minHours: 40`, `minReview: 75` |
| Hidden Gems | `minReview: 85`, `maxReviewCount: 5000` |
| Play Again | `playtimeStatus: 'play-again'`, sorted by `lastPlayed` ascending |
| Most Value Waiting | `minReview: 70`, sorted by `valueWaiting` descending |

All presets also set `strictFilters: true` and `playtimeStatus: 'backlog'` (except Play Again, which uses `play-again`).

"Play Again" uses different logic than the standard backlog. A game qualifies when you've played past a completion threshold (default: 50% of HLTB estimate) and haven't launched it in a while (default: 24 months). Both thresholds are configurable via `play_again_completion_pct` and `play_again_dormant_months`.

"Most Value Waiting" is the backward-looking counterpart to the wishlist's deal score, pointed at your own backlog. It sorts by a `valueWaiting` score — review quality × personal interest × remaining unplayed main-story hours — so the games that bubble up are the ones you'll most likely be glad you played: highly rated, genuinely wanted, and with the most content still ahead of you. A game you've finished contributes no remaining hours, and a game without HowLongToBeat sizing contributes none either (Hoard won't claim unplayed value it can't measure), so both sink to the bottom. It's a *sort*, not a hard filter — every backlog game still shows, just ordered by how much value is sitting unplayed. See [value received](/features/value-received/) for how the same completion axis scores games you've already played.

## Pick for me

The `PickForMePanel` component sits above the game grid. Click "Pick a Game" and it fetches every game matching your current filters — all pages, 100 per request — then applies the mood and time controls client-side before picking.

### Mood picker

Six moods are defined in `PickForMePanel.tsx` as the `MOODS` array. Each mood adds duration and review constraints, and some add tag exclusions applied after fetching:

| Mood | Duration | Min review | Excluded tags |
|---|---|---|---|
| Any | — | — | — |
| Chill | `maxHours: 5` | — | Souls-like, Difficult |
| Relaxing | `maxHours: 20` | — | Souls-like, Difficult, Horror, Survival Horror |
| Short & Sweet | `maxHours: 2` | 80% | — |
| Challenge | — | 80% | — |
| Epic | `minHours: 20` | 80% | — |

Mood filtering is applied client-side after fetching. If you also set the Time control (`< 2h`, `< 5h`, `< 10h`), it works as a cap — the stricter of the mood's `maxHours` and your time selection wins.

### Selection

Once the candidate list is filtered down by mood and time, the pick is not a uniform random draw. `weightedPick` in `PickForMePanel.tsx` weights each game by interest rating (`personalInterest ?? 3`, so 1–5×) and gives a 1.5× bonus to games with a deal score of 70 or higher. The result is that high-interest and well-priced games surface more often, without completely crowding out the rest of the pool.

After fetching, a modal (`RandomPickModal`) shows a brief animation cycling through candidates before settling on the pick. If fewer than three candidates are available the animation is skipped and the result appears immediately.

### What happens at the API layer

All fetching goes through `GET /api/games` with `view=library` and `playtimeStatus=backlog` (or whatever your current filters specify). Page size is 100 (`PICK_PAGE_SIZE`). The loop continues until the total returned matches `json.meta.total` from the first response.

## Scoring and the backlog

The backlog uses the same deal score computed by the [scoring engine](/architecture/scoring-engine/) — you can see it on game cards and in the detail page. But deal score isn't the sorting axis here. The default sort is **Most Value Waiting** (`sortBy: 'valueWaiting'` descending) — the backlog's whole job is answering "what should I play next?", and that's the axis that answers it — and it's offered directly in the sort menu alongside the usual options. The Pick for Me weighting emphasizes `personalInterest` over deal score. The intent is to surface games you actually want to play, not games that happen to be on sale.

If you want to surface the best deals in your backlog specifically, add `minInterest` and sort by deal score manually using the sort controls.

<!-- Screenshot placeholder: Backlog page with Date Night preset active and PickForMePanel visible -->

## Related

- [Scoring engine](/architecture/scoring-engine/) — how deal scores are calculated
- [Features overview](/features/) — all pages at a glance
- [Alerts](/features/alerts/) — price alert configuration
