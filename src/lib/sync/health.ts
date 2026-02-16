/**
 * Sync Health Evaluation
 *
 * Monitors sync success rates and sends alerts when they drop
 * below expected thresholds. Also provides a weekly health summary.
 */

import type { SyncStats } from './types';
import { getRecentSyncStats, getSyncLogsSince } from '../db/queries';
import { getDiscordClient } from '../discord/client';

export const SUCCESS_RATE_THRESHOLDS: Record<string, number> = {
  hltb: 0.20,        // Normally 60-80% match rate
  reviews: 0.50,     // Two API calls/game, some rate-limiting normal
  itad_prices: 0.50, // Batch API, partial failures rare
};

/**
 * Evaluate sync health after a completed run.
 * If success rate is below threshold, send an amber Discord ops alert.
 */
export async function evaluateSyncHealth(source: string, stats: SyncStats): Promise<void> {
  const threshold = SUCCESS_RATE_THRESHOLDS[source];
  if (threshold === undefined || stats.attempted === 0) return;

  const rate = stats.succeeded / stats.attempted;
  if (rate >= threshold) return;

  // Fetch recent runs for context
  const recentRuns = getRecentSyncStats(source, 5);
  const recentSummary = recentRuns
    .filter(r => (r.status === 'success' || r.status === 'partial') && r.itemsAttempted && r.itemsAttempted > 0)
    .map(r => `${r.itemsProcessed}/${r.itemsAttempted}`)
    .join(', ');

  const discord = getDiscordClient();
  await discord.sendOperationalAlert({
    title: `Low Success Rate: ${source}`,
    description: `${stats.succeeded}/${stats.attempted} succeeded (${Math.round(rate * 100)}%) — threshold is ${Math.round(threshold * 100)}%`,
    color: 0xf59e0b, // Amber
    fields: [
      { name: 'Failed', value: String(stats.failed), inline: true },
      { name: 'Skipped', value: String(stats.skipped), inline: true },
      ...(recentSummary ? [{ name: 'Recent Runs', value: recentSummary, inline: false }] : []),
    ],
  });
}

/**
 * Build and send a weekly health summary covering all sync sources.
 */
export async function sendWeeklyHealthSummary(): Promise<void> {
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  const sinceDate = weekAgo.toISOString();

  const sources = ['steam_library', 'steam_wishlist', 'hltb', 'reviews', 'itad_prices', 'alert_check'];
  const fields: Array<{ name: string; value: string; inline: boolean }> = [];
  let allHealthy = true;

  for (const source of sources) {
    const logs = getSyncLogsSince(source, sinceDate);
    if (logs.length === 0) {
      fields.push({ name: source, value: 'No runs', inline: true });
      continue;
    }

    const successRuns = logs.filter(l => l.status === 'success');
    const partialRuns = logs.filter(l => l.status === 'partial');
    const errorRuns = logs.filter(l => l.status === 'error');
    const totalProcessed = logs.reduce((sum, l) => sum + (l.itemsProcessed ?? 0), 0);
    const totalAttempted = logs.reduce((sum, l) => sum + (l.itemsAttempted ?? 0), 0);
    const totalFailed = logs.reduce((sum, l) => sum + (l.itemsFailed ?? 0), 0);
    const avgRate = totalAttempted > 0 ? totalProcessed / totalAttempted : 1;

    const threshold = SUCCESS_RATE_THRESHOLDS[source];
    if (threshold !== undefined && avgRate < threshold) {
      allHealthy = false;
    }
    if (partialRuns.length > 0 || errorRuns.length > 0) {
      allHealthy = false;
    }

    const lastRun = logs[0];
    const parts: string[] = [];
    if (partialRuns.length > 0) {
      parts.push(`${successRuns.length}/${logs.length} runs OK, ${partialRuns.length} partial`);
    } else {
      parts.push(`${successRuns.length}/${logs.length} runs OK`);
    }
    if (totalAttempted > 0) {
      parts.push(`${totalProcessed}/${totalAttempted} items (${Math.round(avgRate * 100)}%)`);
    }
    if (totalFailed > 0) {
      parts.push(`${totalFailed} failed`);
    }
    if (lastRun?.completedAt) {
      const ago = Math.round((Date.now() - new Date(lastRun.completedAt).getTime()) / (1000 * 60 * 60));
      parts.push(`last: ${ago}h ago`);
    }

    fields.push({ name: source, value: parts.join(' | '), inline: false });
  }

  const discord = getDiscordClient();
  await discord.sendOperationalAlert({
    title: 'Weekly Sync Health Summary',
    description: allHealthy
      ? 'All sync sources operating normally.'
      : 'Some sync sources are below expected thresholds.',
    color: allHealthy ? 0x22c55e : 0xf59e0b, // Green or amber
    fields,
  });
}
