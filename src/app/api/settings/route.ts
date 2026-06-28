import { NextRequest } from 'next/server';
import { getAllSettings, setSetting } from '@/lib/db/queries';
import { settingsUpdateSchema, formatZodError, SECRET_SETTING_KEYS } from '@/lib/validations';
import { requireUserIdFromRequest } from '@/lib/auth-helpers';
import { apiSuccess, apiError, apiUnauthorized, apiValidationError } from '@/lib/utils/api';

/**
 * GET /api/settings
 * Returns all settings as a flat object, with secret-valued keys redacted: their
 * raw values are omitted and surfaced as booleans under `_secrets` so the client
 * can tell what's configured without receiving the secret itself.
 */
export async function GET(request: NextRequest) {
  try {
    await requireUserIdFromRequest(request);
  } catch {
    return apiUnauthorized();
  }

  try {
    const settings = getAllSettings();
    const secretKeys = SECRET_SETTING_KEYS as readonly string[];

    const safe: Record<string, string> = {};
    for (const [key, value] of Object.entries(settings)) {
      if (!secretKeys.includes(key)) safe[key] = value;
    }

    const _secrets: Record<string, boolean> = {};
    for (const key of SECRET_SETTING_KEYS) _secrets[key] = Boolean(settings[key]);

    return apiSuccess({ ...safe, _secrets });
  } catch (error) {
    console.error('[GET /api/settings]', error);
    return apiError('Failed to fetch settings');
  }
}

/**
 * PUT /api/settings
 * Batch update settings.
 * Body: { settings: { key: value, ... } }
 */
export async function PUT(request: NextRequest) {
  try {
    await requireUserIdFromRequest(request);
  } catch {
    return apiUnauthorized();
  }

  try {
    const body = await request.json().catch(() => null);
    if (body === null) {
      return apiValidationError('Invalid JSON');
    }
    const parsed = settingsUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return apiValidationError(formatZodError(parsed.error));
    }

    for (const [key, value] of Object.entries(parsed.data.settings)) {
      if (value !== undefined) setSetting(key, value);
    }

    // Changing the scoring weights/thresholds shifts every deal score. Refresh
    // the stored snapshot scores (the deal-score sort key) so list ordering
    // matches the live-recomputed badges instead of drifting until the next
    // price sync rewrites each snapshot.
    const changedScoringConfig =
      parsed.data.settings.scoring_weights !== undefined ||
      parsed.data.settings.scoring_thresholds !== undefined;
    if (changedScoringConfig) {
      // Settings are already committed above; a recompute failure must not turn a
      // successful save into a 500 (which would prompt the client to retry).
      // Isolate it and log, mirroring the non-fatal boot backfill.
      try {
        const { recomputeAllLatestDealScores } = await import('@/lib/db/queries');
        const changed = recomputeAllLatestDealScores();
        console.log(`[Settings] Scoring config changed — refreshed ${changed} stored deal score(s)`);
      } catch (err) {
        console.error('[Settings] Deal-score recompute failed (settings were saved):', err);
      }
    }

    return apiSuccess({ message: 'Settings saved' });
  } catch (error) {
    console.error('[PUT /api/settings]', error);
    return apiError('Failed to save settings');
  }
}
