import { NextResponse } from 'next/server';
import { requireUserIdFromRequest } from '@/lib/auth-helpers';

/**
 * POST /api/prices/check
 * Triggers a price check for watched/wishlisted games via ITAD.
 */
export async function POST(request: Request) {
  try {
    await requireUserIdFromRequest(request);
  } catch {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  try {
    // TODO Phase 2: Implement price checking
    // 1. Get all watchlisted/wishlisted game ITAD IDs
    // 2. Batch fetch current prices from ITAD
    // 3. Store price snapshots
    // 4. Check against alert thresholds
    // 5. Send Discord notifications for triggered alerts

    return NextResponse.json({
      data: { message: 'Price check not yet implemented' },
    });
  } catch (error) {
    console.error('Price check failed:', error);
    return NextResponse.json(
      { error: 'Price check failed' },
      { status: 500 }
    );
  }
}
