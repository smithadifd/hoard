import { NextRequest } from 'next/server';
import { requireUserIdFromRequest } from '@/lib/auth-helpers';
import { apiSuccess, apiError, apiUnauthorized, apiNotFound } from '@/lib/utils/api';
import {
  getSyncLogsForSource,
  getDailySyncRollup,
} from '@/lib/db/queries';
import { getSourceDef } from '@/lib/sync/sources';
import {
  SUCCESS_RATE_THRESHOLDS,
  MIN_ATTEMPTS_FOR_ALERT,
} from '@/lib/sync/health';

/**
 * GET /api/sync/sources/[source]
 *
 * Drill-down detail for one sync source:
 *  - last 50 runs (full sync_log rows including errorMessage)
 *  - 14-day per-day rollup
 *  - threshold + minAttempts from health.ts
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ source: string }> },
) {
  try {
    await requireUserIdFromRequest(request);
  } catch {
    return apiUnauthorized();
  }

  const { source } = await params;
  const def = getSourceDef(source);
  if (!def) return apiNotFound('Sync source');

  try {
    const runs = getSyncLogsForSource(source, 50);
    const since14d = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
    const dailyRollup = getDailySyncRollup(source, since14d);

    return apiSuccess({
      source: def.key,
      label: def.label,
      description: def.description,
      service: def.service,
      supportsManualRun: def.supportsManualRun,
      manualRunType: def.manualRunType ?? null,
      threshold: SUCCESS_RATE_THRESHOLDS[def.key] ?? null,
      minAttempts: MIN_ATTEMPTS_FOR_ALERT[def.key] ?? 0,
      runs,
      dailyRollup,
    });
  } catch (error) {
    console.error(`[GET /api/sync/sources/${source}]`, error);
    return apiError('Failed to fetch sync source detail');
  }
}
