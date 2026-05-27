/**
 * Onboarding milestones — celebratory Discord embeds fired once per user
 * lifecycle event. Each milestone fires at most once; the fired set is
 * persisted in `settings` at key `onboarding_milestones:${userId}` so a
 * restart doesn't replay the embeds.
 *
 * Milestones are intentionally lower-stakes than ops alerts and route to the
 * ops webhook (which falls back to the deals webhook when ops isn't set), so
 * a user with a single Discord webhook still sees them.
 */

import { getSetting, setSetting } from '@/lib/db/queries';
import { getDiscordClient } from '@/lib/discord/client';
import type { DrainMode } from './types';

export type MilestoneKey =
  | 'drain-25'
  | 'drain-50'
  | 'drain-complete'
  | 'first-10-rated'
  | 'first-deal';

const MILESTONE_COLOR = 0x10b981; // Emerald — celebratory, distinct from ops red/amber

function milestonesKey(userId: string): string {
  return `onboarding_milestones:${userId}`;
}

function readFired(userId: string): Set<MilestoneKey> {
  const raw = getSetting(milestonesKey(userId));
  if (!raw) return new Set();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((k): k is MilestoneKey => typeof k === 'string'));
  } catch {
    return new Set();
  }
}

function writeFired(userId: string, fired: Set<MilestoneKey>): void {
  setSetting(milestonesKey(userId), JSON.stringify([...fired]), 'Onboarding milestones');
}

export function hasFiredMilestone(userId: string, key: MilestoneKey): boolean {
  return readFired(userId).has(key);
}

/**
 * Test-only: wipe the fired-milestone set for a user. Production callers
 * should not need this — milestones are append-only.
 */
export function resetMilestonesForTests(userId: string): void {
  setSetting(milestonesKey(userId), JSON.stringify([]), 'Onboarding milestones');
}

interface MilestoneEmbed {
  title: string;
  description: string;
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
}

async function dispatch(embed: MilestoneEmbed): Promise<void> {
  try {
    const discord = getDiscordClient();
    await discord.sendOperationalAlert({
      title: embed.title,
      description: embed.description,
      color: MILESTONE_COLOR,
      fields: embed.fields,
    });
  } catch (err) {
    // Discord misconfiguration must never break the surrounding work.
    console.warn('[Milestone] Discord embed failed:', err);
  }
}

/**
 * Fire a milestone if it hasn't been fired before for this user. Always
 * idempotent — a second call with the same key is a no-op. Internal failures
 * (DB unavailable, Discord broken) never throw out of this function: the
 * surrounding code path (drain, alert send, rating update) must keep
 * working even when milestone bookkeeping fails.
 */
export async function fireMilestone(
  userId: string,
  key: MilestoneKey,
  embed: MilestoneEmbed,
): Promise<boolean> {
  try {
    const fired = readFired(userId);
    if (fired.has(key)) return false;

    fired.add(key);
    // Mark fired before sending so a failed Discord call doesn't reopen the
    // window for duplicate fires. We log the failure but accept it as final.
    writeFired(userId, fired);

    await dispatch(embed);
    return true;
  } catch (err) {
    console.warn('[Milestone] fireMilestone failed:', err);
    return false;
  }
}

/**
 * Convenience wrappers — keep the call sites in drain.ts / rating / alert
 * code small and let this module own the embed copy.
 */
export const milestones = {
  async drainProgress(userId: string, mode: DrainMode, percent: 25 | 50): Promise<void> {
    const key: MilestoneKey = percent === 25 ? 'drain-25' : 'drain-50';
    await fireMilestone(userId, key, {
      title: `Initial enrichment ${percent}% complete`,
      description: `Hoard is still working through the ${mode} drain. You'll get one more ping when it finishes.`,
    });
  },

  async drainComplete(userId: string, mode: DrainMode): Promise<void> {
    await fireMilestone(userId, 'drain-complete', {
      title: 'Initial enrichment finished',
      description: `Your library has prices, metadata${mode === 'full' ? ', play-time estimates, and reviews' : ''} ready to use.`,
    });
  },

  async firstTenRated(userId: string, ratedCount: number): Promise<void> {
    await fireMilestone(userId, 'first-10-rated', {
      title: 'First 10 games rated',
      description: 'Backlog scoring is now meaningful — open the backlog to see your top picks.',
      fields: [{ name: 'Rated so far', value: String(ratedCount), inline: true }],
    });
  },

  async firstDeal(userId: string, gameTitle: string): Promise<void> {
    await fireMilestone(userId, 'first-deal', {
      title: 'First deal alert fired',
      description: `Hoard just sent its first deal alert for **${gameTitle}** — the wishlist + watchlist pipeline is live.`,
    });
  },
};
