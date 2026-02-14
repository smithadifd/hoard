import { NextRequest } from 'next/server';
import { getAllSettings, setSetting } from '@/lib/db/queries';
import { settingsUpdateSchema, formatZodError } from '@/lib/validations';
import { requireUserIdFromRequest } from '@/lib/auth-helpers';
import { apiSuccess, apiError, apiUnauthorized, apiValidationError } from '@/lib/utils/api';

/**
 * GET /api/settings
 * Returns all settings as a flat object.
 */
export async function GET(request: NextRequest) {
  try {
    await requireUserIdFromRequest(request);
  } catch {
    return apiUnauthorized();
  }

  try {
    const settings = getAllSettings();
    return apiSuccess(settings);
  } catch (error) {
    console.error('[GET /api/settings]', error);
    return apiError('Failed to fetch settings');
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
    return apiUnauthorized();
  }

  try {
    const body = await request.json();
    const parsed = settingsUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return apiValidationError(formatZodError(parsed.error));
    }

    for (const [key, value] of Object.entries(parsed.data.settings)) {
      setSetting(key, value);
    }

    return apiSuccess({ message: 'Settings saved' });
  } catch (error) {
    console.error('[PUT /api/settings]', error);
    return apiError('Failed to save settings');
  }
}
