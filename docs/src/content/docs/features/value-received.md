---
title: Value received
description: How Hoard scores whether you've gotten your money's worth from a game you own — the backward-looking counterpart to the deal score.
---

The [deal score](/architecture/scoring-engine/) answers a forward-looking question: is this a good price to buy? **Value received** answers the mirror image for games you already own: have you gotten what you paid for — and have you blown past it?

It shows up as a badge on owned-game cards (where the buy-oriented deal badge would otherwise be blank, since Hoard only price-syncs wishlisted and watchlisted games) and as a breakdown card on the game detail page. Wishlist games keep the deal score; owned games lead with value received.

## The two lenses

Every owned game gets a value-received score, even if you've never told Hoard what you paid. The score uses whichever of two lenses it has the data for.

### Time lens (the default)

With no price recorded, the score is pure completion: hours played versus the HowLongToBeat main-story estimate. This is the same axis the [backlog](/features/backlog/) uses from the other end — a game is "backlog" until you've played ~10% of its main story; here it's "realized" once you're near the whole thing.

| Tier | Playtime vs main story |
|------|------------------------|
| **Unrealized** | under 20% — barely touched |
| **Approaching** | 20–80% — value building |
| **Realized** | 80–110% — you've effectively seen the game |
| **Exceeded** | 110%+ — well past the main story |

The 80% floor for "realized" is deliberate: HowLongToBeat is a crowd-sourced estimate, not a contract, so getting most of the way through counts as beating it.

### Money lens (once you record a price)

On a game's detail page, the **What you paid** card lets you enter the purchase price. It's optional, and it's the only honest source — Steam's API doesn't expose what you actually paid, and Hoard won't invent a number for you. Recording a price unlocks the money lens: your *realized* dollars-per-hour, graded against the exact same per-review-tier thresholds the deal score uses.

For an Overwhelmingly Positive game the target is $4/hour, so a $24.99 game you've played 41 hours sits at $0.61/hour — value exceeded, with plenty of room to spare. The card also shows your **break-even point**: the hours you'd need to play to reach the target for that review tier.

"Received expected value" means your realized $/hour is at or under the target. Falling past twice the target reads as unrealized; getting it for half the target or less reads as exceeded — the same 0.5×/1×/2× bands the forward-looking value score uses, so a game that was a good-value *buy* reads as "realized" once you've played it through.

Prices are assumed to be in USD, matching the rest of Hoard's pricing.

## Edge cases

- **Never played** is always *unrealized*, regardless of price — a game you paid for and never opened has returned none of its value yet.
- **Free games** (price recorded as $0) stay on the time lens. Hoard won't report "$0.00/hour."
- **No HowLongToBeat data** falls back to absolute hours on the time lens (under 15 minutes is unrealized, 10+ hours is realized, 25+ exceeded) — the same cutoffs the backlog uses for games it can't size. If you've recorded a price, the money lens is used instead, since it doesn't need a duration at all.

## In the backlog

The same completion axis feeds the backlog's **Most Value Waiting** preset and `valueWaiting` sort. Where value received looks back at a single game ("have I gotten my money's worth?"), Most Value Waiting points the question at the whole backlog from the other side: *which* unplayed games hold the most value still waiting for you. It ranks by review quality × personal interest × remaining unplayed main-story hours, so a highly rated game you genuinely want with 40 hours still ahead outranks one you've already finished or one Hoard can't size. It's a sort, not a filter — see [Backlog](/features/backlog/#presets) for the full preset list.

## Where it lives

The scoring is a pure function in `src/lib/scoring/valueReceived.ts`, tested alongside the deal-score engine. It's computed for owned games during enrichment in `getEnrichedGames` / `getEnrichedGameById`, so any page that lists or opens a game gets it for free. The badge is `ValueReceivedIndicator`; the detail card is `ValueReceivedBreakdown`; the price entry is `PricePaidEditor`.
