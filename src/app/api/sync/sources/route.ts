import { NextRequest } from 'next/server';
import { requireUserIdFromRequest } from '@/lib/auth-helpers';
import { apiSuccess, apiError, apiUnauthorized } from '@/lib/utils/api';
import { getTaskStatus } from '@/lib/scheduler';
import {
  getRecentSyncStats,
  sumApiCallsBySourcesSince,
} from '@/lib/db/queries';
import { SYNC_SOURCES, type SyncService } from '@/lib/sync/sources';
import {
  SUCCESS_RATE_THRESHOLDS,
  MIN_ATTEMPTS_FOR_ALERT,
} from '@/lib/sync/health';

type SyncStatus = 'success' | 'partial' | 'error' | 'running';

interface RecentStatRow {
  id: number;
  source: string;
  status: SyncStatus | string;
  itemsProcessed: number | null;
  itemsAttempted: number | null;
  itemsFailed: number | null;
  apiCalls: number | null;
  startedAt: string;
  completedAt: string | null;
}

type Health = 'healthy' | 'degraded' | 'unhealthy' | 'unknown';

function deriveHealth(
  rows: RecentStatRow[],
  threshold: number | undefined,
  minAttempts: number,
): Health {
  if (rows.length === 0) return 'unknown';

  let totalAttempted = 0;
  let totalProcessed = 0;
  let errors = 0;
  let partials = 0;
  for (const r of rows) {
    totalAttempted += r.itemsAttempted ?? 0;
    totalProcessed += r.itemsProcessed ?? 0;
    if (r.status === 'error') errors++;
    else if (r.status === 'partial') partials++;
  }

  if (threshold !== undefined && totalAttempted >= minAttempts && totalAttempted > 0) {
    const rate = totalProcessed / totalAttempted;
    if (rate < threshold) return 'unhealthy';
  }

  if (rows[0].status === 'error') return errors >= 3 ? 'unhealthy' : 'degraded';
  if (errors > 0 || partials > 0) return 'degraded';
  return 'healthy';
}

function sourceKeysByService(service: SyncService): string[] {
  return SYNC_SOURCES.filter((s) => s.service === service).map((s) => s.key);
}

/**
 * GET /api/sync/sources
 *
 * Returns one entry per known sync source with scheduler info, derived health,
 * recent run stats, and 24h API-call totals. Also returns 7-day API-call totals
 * grouped by external service (steam/itad/hltb) for the top-of-page widget.
 */
export async function GET(request: NextRequest) {
  try {
    await requireUserIdFromRequest(request);
  } catch {
    return apiUnauthorized();
  }

  try {
    const taskStatus = getTaskStatus();
    const taskByName = new Map(taskStatus.map((t) => [t.name, t]));

    const now = Date.now();
    const since24h = new Date(now - 24 * 60 * 60 * 1000).toISOString();
    const since7d = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();

    const sources = SYNC_SOURCES.map((def) => {
      const recent = getRecentSyncStats(def.key, 14) as RecentStatRow[];
      const threshold = SUCCESS_RATE_THRESHOLDS[def.key];
      const minAttempts = MIN_ATTEMPTS_FOR_ALERT[def.key] ?? 0;
      const health = deriveHealth(recent, threshold, minAttempts);

      const apiCalls24h = sumApiCallsBySourcesSince([def.key], since24h);

      const task = def.taskName ? taskByName.get(def.taskName) : undefined;

      const lastRun = recent[0]
        ? {
            id: recent[0].id,
            status: recent[0].status,
            itemsProcessed: recent[0].itemsProcessed,
            itemsAttempted: recent[0].itemsAttempted,
            itemsFailed: recent[0].itemsFailed,
            apiCalls: recent[0].apiCalls,
            startedAt: recent[0].startedAt,
            completedAt: recent[0].completedAt,
          }
        : null;

      return {
        source: def.key,
        label: def.label,
        description: def.description,
        service: def.service,
        supportsManualRun: def.supportsManualRun,
        manualRunType: def.manualRunType ?? null,
        task: task
          ? {
              name: task.name,
              schedule: task.schedule,
              isRunning: task.isRunning,
              lastRun: task.lastRun ? task.lastRun.toISOString() : null,
              nextRun: task.nextRun ? task.nextRun.toISOString() : null,
            }
          : null,
        health,
        threshold: threshold ?? null,
        minAttempts,
        recentStats: recent.map((r) => ({
          startedAt: r.startedAt,
          status: r.status,
          itemsProcessed: r.itemsProcessed,
          itemsAttempted: r.itemsAttempted,
          itemsFailed: r.itemsFailed,
          apiCalls: r.apiCalls,
        })),
        apiCalls24h,
        lastRun,
      };
    });

    const apiCallsByService7d = {
      steam: sumApiCallsBySourcesSince(sourceKeysByService('steam'), since7d),
      itad: sumApiCallsBySourcesSince(sourceKeysByService('itad'), since7d),
      hltb: sumApiCallsBySourcesSince(sourceKeysByService('hltb'), since7d),
    };

    return apiSuccess({ sources, apiCallsByService7d });
  } catch (error) {
    console.error('[GET /api/sync/sources]', error);
    return apiError('Failed to fetch sync sources');
  }
}
