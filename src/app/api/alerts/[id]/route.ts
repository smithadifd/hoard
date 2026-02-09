import { NextRequest, NextResponse } from 'next/server';
import { updatePriceAlert, deletePriceAlert } from '@/lib/db/queries';
import { alertIdSchema, alertUpdateSchema, formatZodError } from '@/lib/validations';
import { requireUserIdFromRequest } from '@/lib/auth-helpers';

/**
 * PATCH /api/alerts/:id
 * Update an existing price alert.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireUserIdFromRequest(request);
  } catch {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  try {
    const { id } = await params;
    const idResult = alertIdSchema.safeParse({ id });
    if (!idResult.success) {
      return NextResponse.json({ error: 'Invalid alert ID' }, { status: 400 });
    }

    const body = await request.json();
    const parsed = alertUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: formatZodError(parsed.error) },
        { status: 400 }
      );
    }

    const updated = updatePriceAlert(idResult.data.id, parsed.data);
    if (!updated) {
      return NextResponse.json({ error: 'Alert not found' }, { status: 404 });
    }

    return NextResponse.json({ data: { message: 'Alert updated' } });
  } catch (error) {
    console.error('Failed to update alert:', error);
    return NextResponse.json(
      { error: 'Failed to update alert' },
      { status: 500 }
    );
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
  try {
    await requireUserIdFromRequest(request);
  } catch {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  try {
    const { id } = await params;
    const idResult = alertIdSchema.safeParse({ id });
    if (!idResult.success) {
      return NextResponse.json({ error: 'Invalid alert ID' }, { status: 400 });
    }

    const deleted = deletePriceAlert(idResult.data.id);
    if (!deleted) {
      return NextResponse.json({ error: 'Alert not found' }, { status: 404 });
    }

    return NextResponse.json({ data: { message: 'Alert deleted' } });
  } catch (error) {
    console.error('Failed to delete alert:', error);
    return NextResponse.json(
      { error: 'Failed to delete alert' },
      { status: 500 }
    );
  }
}
