import { NextRequest, NextResponse } from 'next/server';
import { getAllSettings, setSetting } from '@/lib/db/queries';
import { settingsUpdateSchema, formatZodError } from '@/lib/validations';
import { requireUserIdFromRequest } from '@/lib/auth-helpers';

/**
 * GET /api/settings
 * Returns all settings as a flat object.
 */
export async function GET(request: NextRequest) {
  try {
    await requireUserIdFromRequest(request);
  } catch {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  try {
    const settings = getAllSettings();
    return NextResponse.json({ data: settings });
  } catch (error) {
    console.error('Failed to fetch settings:', error);
    return NextResponse.json(
      { error: 'Failed to fetch settings' },
      { status: 500 }
    );
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
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const parsed = settingsUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: formatZodError(parsed.error) },
        { status: 400 }
      );
    }

    for (const [key, value] of Object.entries(parsed.data.settings)) {
      setSetting(key, value);
    }

    return NextResponse.json({ data: { message: 'Settings saved' } });
  } catch (error) {
    console.error('Failed to save settings:', error);
    return NextResponse.json(
      { error: 'Failed to save settings' },
      { status: 500 }
    );
  }
}
