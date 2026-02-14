import { NextRequest } from 'next/server';
import {
  getAllPriceAlertsWithGames,
  upsertPriceAlert,
} from '@/lib/db/queries';
import { alertUpsertSchema, formatZodError } from '@/lib/validations';
import { requireUserIdFromRequest } from '@/lib/auth-helpers';
import { apiSuccess, apiError, apiUnauthorized, apiValidationError } from '@/lib/utils/api';

/**
 * GET /api/alerts
 * List all price alerts with game data.
 * Optional query: ?active=true to filter active-only.
 */
export async function GET(request: NextRequest) {
  let userId: string;
  try {
    userId = await requireUserIdFromRequest(request);
  } catch {
    return apiUnauthorized();
  }

  try {
    const { searchParams } = new URL(request.url);
    const activeOnly = searchParams.get('active') === 'true';

    let alerts = getAllPriceAlertsWithGames(userId);
    if (activeOnly) {
      alerts = alerts.filter((a) => a.isActive);
    }

    return apiSuccess(alerts);
  } catch (error) {
    console.error('[GET /api/alerts]', error);
    return apiError('Failed to fetch alerts');
  }
}

/**
 * POST /api/alerts
 * Create or update a price alert.
 * Body: { gameId, targetPrice?, notifyOnAllTimeLow?, notifyOnThreshold? }
 */
export async function POST(request: NextRequest) {
  let userId: string;
  try {
    userId = await requireUserIdFromRequest(request);
  } catch {
    return apiUnauthorized();
  }

  try {
    const body = await request.json();
    const parsed = alertUpsertSchema.safeParse(body);
    if (!parsed.success) {
      return apiValidationError(formatZodError(parsed.error));
    }

    const { gameId, ...alertOptions } = parsed.data;
    const alertId = upsertPriceAlert(gameId, alertOptions, userId);

    return apiSuccess({ id: alertId, message: 'Alert saved' });
  } catch (error) {
    console.error('[POST /api/alerts]', error);
    return apiError('Failed to create alert');
  }
}
