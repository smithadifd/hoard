import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/alerts
 * List all price alerts.
 */
export async function GET() {
  try {
    // TODO Phase 5: Fetch alerts from database
    return NextResponse.json({ data: [] });
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
 * Create a new price alert.
 */
export async function POST(request: NextRequest) {
  try {
    const _body = await request.json();

    // TODO Phase 5: Create alert in database

    return NextResponse.json({
      data: { message: 'Alert creation not yet implemented' },
    });
  } catch (error) {
    console.error('Failed to create alert:', error);
    return NextResponse.json(
      { error: 'Failed to create alert' },
      { status: 500 }
    );
  }
}
