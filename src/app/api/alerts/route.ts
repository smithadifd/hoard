import { NextRequest, NextResponse } from 'next/server';
import {
  getAllPriceAlertsWithGames,
  upsertPriceAlert,
} from '@/lib/db/queries';

/**
 * GET /api/alerts
 * List all price alerts with game data.
 * Optional query: ?active=true to filter active-only.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const activeOnly = searchParams.get('active') === 'true';

    let alerts = getAllPriceAlertsWithGames();
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
  try {
    const body = await request.json();
    const { gameId, targetPrice, notifyOnAllTimeLow, notifyOnThreshold } = body;

    if (!gameId || typeof gameId !== 'number') {
      return NextResponse.json(
        { error: 'gameId is required and must be a number' },
        { status: 400 }
      );
    }

    const alertId = upsertPriceAlert(gameId, {
      targetPrice,
      notifyOnAllTimeLow,
      notifyOnThreshold,
    });

    return NextResponse.json({ data: { id: alertId, message: 'Alert saved' } });
  } catch (error) {
    console.error('Failed to create alert:', error);
    return NextResponse.json(
      { error: 'Failed to create alert' },
      { status: 500 }
    );
  }
}
