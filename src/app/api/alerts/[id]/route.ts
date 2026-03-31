import { NextRequest } from 'next/server';
import { updatePriceAlert, deletePriceAlert } from '@/lib/db/queries';
import { alertIdSchema, alertUpdateSchema, formatZodError } from '@/lib/validations';
import { requireUserIdFromRequest } from '@/lib/auth-helpers';
import { apiSuccess, apiError, apiUnauthorized, apiValidationError, apiNotFound } from '@/lib/utils/api';

/**
 * PATCH /api/alerts/:id
 * Update an existing price alert.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let userId: string;
  try {
    userId = await requireUserIdFromRequest(request);
  } catch {
    return apiUnauthorized();
  }

  try {
    const { id } = await params;
    const idResult = alertIdSchema.safeParse({ id });
    if (!idResult.success) {
      return apiValidationError('Invalid alert ID');
    }

    const body = await request.json();
    const parsed = alertUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return apiValidationError(formatZodError(parsed.error));
    }

    const updated = updatePriceAlert(idResult.data.id, parsed.data, userId);
    if (!updated) {
      return apiNotFound('Alert');
    }

    return apiSuccess({ message: 'Alert updated' });
  } catch (error) {
    console.error('[PATCH /api/alerts/:id]', error);
    return apiError('Failed to update alert');
  }
}

/**
 * DELETE /api/alerts/:id
 * Delete a price alert.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let userId: string;
  try {
    userId = await requireUserIdFromRequest(request);
  } catch {
    return apiUnauthorized();
  }

  try {
    const { id } = await params;
    const idResult = alertIdSchema.safeParse({ id });
    if (!idResult.success) {
      return apiValidationError('Invalid alert ID');
    }

    const deleted = deletePriceAlert(idResult.data.id, userId);
    if (!deleted) {
      return apiNotFound('Alert');
    }

    return apiSuccess({ message: 'Alert deleted' });
  } catch (error) {
    console.error('[DELETE /api/alerts/:id]', error);
    return apiError('Failed to delete alert');
  }
}
