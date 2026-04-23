---
title: Scoring engine
description: How Hoard computes deal scores from price, reviews, value per hour, and interest.
---

Every game gets a 0–100 deal score derived from four sub-scores combined via weighted average. Higher is better.

## The four sub-scores

### Price score

Measures how close the current price is to the all-time low (ATL).

```
position = (regularPrice - currentPrice) / (regularPrice - historicalLow)
priceScore = round(position * 100)
```

Edge cases:

- `currentPrice <= 0` → 100 (free games are as cheap as it gets)
- `regularPrice <= 0` → 50 (no baseline data, neutral)
- `currentPrice <= historicalLow` → 100 (at or below ATL)
- `regularPrice == historicalLow` (no range) → 50

So a game at its regular price scores 0, a game at ATL scores 100, and anything in between is linear.

### Review score

Steam review percentage maps directly to 0–100 with no transformation:

```
reviewScore = reviewPercent   // e.g., 92% positive → score 92
```

If review data is unavailable, the score is 50 (neutral). No curve, no logarithm — it's a direct pass-through.

### Value score

This is the most interesting sub-score. It computes dollars per hour (`currentPrice / hltbMainHours`) and compares that against a tier-specific threshold. The tier is determined by the game's review percentage.

**Review tiers and default thresholds:**

| Review tier | Review % range | Default max $/hr |
|---|---|---|
| Overwhelmingly Positive | 95%+ | $4.00 |
| Very Positive | 80–94% | $3.00 |
| Positive | 70–79% | $2.00 |
| Mixed | 40–69% | $1.00 |
| Negative | below 40% | $0.50 |

Once `dollarsPerHour` and `maxAcceptable` are known, the score is stepped (not linear):

| Condition | Score |
|---|---|
| `$/hr ≤ maxAcceptable × 0.5` | 100 |
| `$/hr ≤ maxAcceptable` | 75 |
| `$/hr ≤ maxAcceptable × 1.5` | 50 |
| `$/hr ≤ maxAcceptable × 2.0` | 25 |
| `$/hr > maxAcceptable × 2.0` | 10 |

Edge cases: if HLTB hours are unknown or zero, the score is 50 (neutral). Free games (`price <= 0`) always score 100.

### Interest score

Maps the 1–5 personal interest rating to 0–100 linearly:

```
interestScore = round(((interest - 1) / 4) * 100)
```

| Interest | Score |
|---|---|
| 1 | 0 |
| 2 | 25 |
| 3 | 50 |
| 4 | 75 |
| 5 | 100 |

## Weighted combination

The overall score is a weighted sum of the four sub-scores, clamped to 0–100:

```
dealScore = round(
  priceScore    × priceWeight   +
  reviewScore   × reviewWeight  +
  valueScore    × valueWeight   +
  interestScore × interestWeight
)
```

**Default weights** (from `DEFAULT_WEIGHTS` in `src/lib/scoring/types.ts`):

| Weight | Default |
|---|---|
| `priceWeight` | 0.30 |
| `reviewWeight` | 0.25 |
| `valueWeight` | 0.25 |
| `interestWeight` | 0.20 |

The weights don't need to sum to 1.0 by constraint, but the defaults do. If you adjust them in Settings, the raw `round()` result is still clamped to `[0, 100]` in `calculateDealScore`.

## Rating labels

The numeric score maps to five rating labels:

| Score range | Rating |
|---|---|
| 85–100 | `excellent` |
| 70–84 | `great` |
| 55–69 | `good` |
| 40–54 | `okay` |
| 0–39 | `poor` |

These labels drive the color-coded badges on game cards and the deal detail panel.

A short human-readable summary string is also generated from the raw scores — for example, "All-time low price, stellar reviews, great value ($1.23/hr)". It's built from the same threshold comparisons, so it stays consistent with the badge.

## Customizing weights and thresholds

Weights (`priceWeight`, `reviewWeight`, `valueWeight`, `interestWeight`) and the per-tier $/hr thresholds are configurable through the Settings page. Changes persist in the `settings` table in SQLite as JSON-encoded values. The scoring engine reads these at runtime — no restart needed. For full details on the Settings fields and environment variable equivalents, see [Configuration](/self-hosting/configuration/).

## Implementation note

The value score branching is a flat conditional chain, not a recursive tree. The Mermaid flowchart described in the plan would be misleading — there's no looping or backtracking. The path is: check if hours are known → compute $/hr → look up the review-tier threshold → compare against the five stepped bands → return the score.

All scoring logic lives in `src/lib/scoring/engine.ts`. The types and defaults are in `src/lib/scoring/types.ts`.
