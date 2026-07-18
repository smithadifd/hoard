---
title: Value received
description: How Hoard scores whether you've gotten your money's worth from a game you own — the backward-looking counterpart to the deal score.
---

The [deal score](/architecture/scoring-engine/) answers a forward-looking question: is this a good price to buy? **Value received** answers the mirror image for games you already own: have you gotten what you paid for — and have you blown past it?

It shows up as a badge on owned-game cards (where the buy-oriented deal badge would otherwise be blank, since Hoard only price-syncs wishlisted and watchlisted games) and as a breakdown card on the game detail page. Wishlist games keep the deal score; owned games lead with value received.

It also drives a set of **Library sorts** — *Value Received* (tier), *Realized $/hr*, *Completion %*, and *Price Paid* — and two dashboard cards: a **Value Received** donut breaking your owned library down by tier, and a **Spending & Value** tile rolling up total spent, hours played, blended $/hour, and how often you've reached expected value.

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

### Price-paid suggestions

Recording a price is the one bit of friction in the money lens, so Hoard offers to pre-fill it. When a wishlisted game becomes owned — caught during the Steam library sync — Hoard estimates what you likely paid from the **last price it tracked** before the purchase (the cheapest store on the most recent snapshot) and surfaces a *suggestion* on the game's detail page: "Did you pay around $X?" Confirm it, correct it, or dismiss it with **Not now**.

It is only ever a suggestion. The estimate never becomes your recorded price on its own — only an explicit Confirm or Update writes it, in keeping with Hoard's honesty-over-compulsion stance. A game Hoard can't estimate honestly — one that was never wishlisted, or that you owned before Hoard started tracking it — gets no suggestion and falls back to manual entry; Hoard won't fabricate a number from nothing.

A pending suggestion shows in three places: the detail-page prompt, a subtle "Paid ~$X?" hint on the library card, and one in-app bell notification per purchase. Turn the whole feature off with **Suggest prices I paid** under Settings → Alerts, or silence just the bell via the *Price-paid suggestions* category under Settings → Notifications.

## Was it worth it? Your rating leads

The two lenses above are honest, but both are *proxies*. Review % is the crowd's opinion, not yours; $/hour is an efficiency measure that's structurally unfair to short games — a two-hour game you adored can never "break even" on $/hour no matter the threshold. For a game you've actually played, the most honest measure of value received is your own verdict.

So on a game's detail page, the **Was it worth it?** card lets you record a 1–5 **enjoyment rating**. Once you do, your rating *leads* the verdict and the $/hour and completion figures become supporting context — not deleted, just demoted from the headline. The verdict reads in plain language:

| Rating | Verdict |
| ------ | ------------------- |
| 4–5 | **Glad I played it** |
| 3 | **On the fence** |
| 2 | **Not for me** |
| 1 | **Regret it** |

When your rating and the efficiency lens disagree, the verdict carries a short qualifier so it can't be misread — a game you loved but overpaid for reads *"Glad I played it · paid a premium"*, and one you bounced off but barely paid for reads *"Not for me · at least it was cheap."* When they agree, the verdict stands on its own. A rating also grades a game that otherwise had no baseline at all (no duration, no price) — your verdict is enough.

This is deliberately additive and never pushy: rating is optional, an unrated game scores exactly as before, and there's no toggle to make the verdict more flattering. If you want to catch up on games you've played but not yet graded, the opt-in **Worth it?** view under [Rate your games](/features/triage/) lists them for quick backfill — but Hoard never nags you to.

If you'd rated your pre-purchase **interest** (the "bet") before buying, the detail card also shows whether the bet paid off — *wanted it 3 → got 5 (exceeded expectations)* — comparing what you hoped for against what you got. That gap is its own signal for future buys.

## Edge cases

- **Never played** is always *unrealized*, regardless of price — a game you paid for and never opened has returned none of its value yet. (Rating it is moot until you've played it.)
- **Free games** (price recorded as $0) stay on the time lens. Hoard won't report "$0.00/hour."
- **No HowLongToBeat data and no recorded price** has no honest baseline to grade against — there's no main-story estimate to measure completion, and no price for $/hour. Rather than invent a tier from raw hours (which reads misleadingly as "Approaching" off 15 minutes, or "Exceeded" off a sandbox game you've sunk 100 hours into), the badge shows a neutral **Played Xh** chip with no value claim. Add a duration *or* a price and the game grades normally — the money lens needs no duration at all. A post-play **rating** also resolves it: your verdict needs no baseline.

## In the backlog

The same completion axis feeds the backlog's **Most Value Waiting** preset and `valueWaiting` sort. Where value received looks back at a single game ("have I gotten my money's worth?"), Most Value Waiting points the question at the whole backlog from the other side: *which* unplayed games hold the most value still waiting for you. It ranks by review quality × personal interest × remaining unplayed main-story hours, so a highly rated game you genuinely want with 40 hours still ahead outranks one you've already finished or one Hoard can't size. It's a sort, not a filter — see [Backlog](/features/backlog/#presets) for the full preset list.

## Where it lives

The scoring is a pure function in `src/lib/scoring/valueReceived.ts`, tested alongside the deal-score engine. It's computed for owned games during enrichment in `getEnrichedGames` / `getEnrichedGameById`, so any page that lists or opens a game gets it for free. The badge is `ValueReceivedIndicator`; the detail card is `ValueReceivedBreakdown`; the price entry is `PricePaidEditor`. The purchase-time estimate is captured by `capturePricePaidSuggestions` (called from the library sync) and surfaced per-game by `PricePaidSuggestionPrompt`. For the backlog of games still awaiting a decision, `/library/pending-prices` (`getPendingPricePaidSuggestions` + `PendingPriceConfirmList`) lists every unconfirmed estimate at once and lets you accept all, accept a selection, or adjust individually — `POST /api/games/price-paid/bulk-confirm` writes the result the same way the single-game prompt does, so a manually-recorded price or an already-confirmed game is never overwritten.
