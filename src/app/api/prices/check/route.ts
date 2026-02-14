import { requireUserIdFromRequest } from '@/lib/auth-helpers';
import { apiSuccess, apiError, apiUnauthorized } from '@/lib/utils/api';

/**
 * POST /api/prices/check
 * Triggers a price check for watched/wishlisted games via ITAD.
 */
export async function POST(request: Request) {
  try {
    await requireUserIdFromRequest(request);
  } catch {
    return apiUnauthorized();
  }

  try {
    // TODO Phase 2: Implement price checking
    // 1. Get all watchlisted/wishlisted game ITAD IDs
    // 2. Batch fetch current prices from ITAD
    // 3. Store price snapshots
    // 4. Check against alert thresholds
    // 5. Send Discord notifications for triggered alerts

    return apiSuccess({ message: 'Price check not yet implemented' });
  } catch (error) {
    console.error('[POST /api/prices/check]', error);
    return apiError('Price check failed');
  }
}
