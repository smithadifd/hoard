import { NextRequest, NextResponse } from 'next/server';
import {
  getAllPriceAlertsWithGames,
  upsertPriceAlert,
} from '@/lib/db/queries';
import { alertUpsertSchema, formatZodError } from '@/lib/validations';
import { requireUserIdFromRequest } from '@/lib/auth-helpers';

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
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const activeOnly = searchParams.get('active') === 'true';

    let alerts = getAllPriceAlertsWithGames(userId);
    if (activeOnly) {
      alerts = alerts.filter((a) => a.isActive);
    }

    return NextResponse.json({ data: alerts });
  } catch (error) {
    console.error('Failed to fetch alerts:', error);
    return NextResponse.json(
      { error: 'Failed to fetch alerts' },
      { status: 500 }
    );
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
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const parsed = alertUpsertSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: formatZodError(parsed.error) },
        { status: 400 }
      );
    }

    const { gameId, ...alertOptions } = parsed.data;
    const alertId = upsertPriceAlert(gameId, alertOptions, userId);

    return NextResponse.json({ data: { id: alertId, message: 'Alert saved' } });
  } catch (error) {
    console.error('Failed to create alert:', error);
    return NextResponse.json(
      { error: 'Failed to create alert' },
      { status: 500 }
    );
  }
}
