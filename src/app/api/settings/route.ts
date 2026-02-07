import { NextRequest, NextResponse } from 'next/server';
import { getAllSettings, setSetting } from '@/lib/db/queries';

/**
 * GET /api/settings
 * Returns all settings as a flat object.
 */
export async function GET() {
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
    const body = await request.json();
    const entries: Record<string, string> = body.settings;

    if (!entries || typeof entries !== 'object') {
      return NextResponse.json(
        { error: 'Expected { settings: { key: value } }' },
        { status: 400 }
      );
    }

    const allowedKeys = [
      'steam_api_key',
      'steam_user_id',
      'itad_api_key',
      'discord_webhook_url',
    ];

    for (const [key, value] of Object.entries(entries)) {
      if (!allowedKeys.includes(key)) continue;
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
