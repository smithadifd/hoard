import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireUserIdFromRequest } from '@/lib/auth-helpers';
import { apiSuccess, apiError, apiUnauthorized, apiValidationError } from '@/lib/utils/api';
import { setSetting } from '@/lib/db/queries';
import { updateOnboardingState } from '@/lib/onboarding/state';

const schema = z.object({
  steamApiKey: z.string().min(1, 'Steam API key is required'),
  steamUserId: z
    .string()
    .regex(/^\d{17}$/, 'Steam User ID must be a 17-digit Steam64 ID'),
});

interface SteamProbeResult {
  ok: boolean;
  gameCount?: number;
  profileVisible?: boolean;
  message?: string;
}

/**
 * Hits the live Steam GetOwnedGames endpoint with the supplied credentials.
 * Returns a normalized result instead of bubbling raw HTTP errors so the
 * wizard can show actionable copy without parsing prose.
 */
async function probeSteam(apiKey: string, userId: string): Promise<SteamProbeResult> {
  const url = new URL('https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/');
  url.searchParams.set('key', apiKey);
  url.searchParams.set('steamid', userId);
  url.searchParams.set('include_appinfo', '0');
  url.searchParams.set('format', 'json');

  let response: Response;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      response = await fetch(url.toString(), { signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Network error';
    return { ok: false, message: `Could not reach Steam: ${msg}` };
  }

  if (response.status === 401 || response.status === 403) {
    return {
      ok: false,
      message: 'Steam rejected the API key. Get a new key at steamcommunity.com/dev/apikey.',
    };
  }
  if (response.status === 400) {
    return {
      ok: false,
      message:
        'Steam returned 400 — double-check the Steam64 ID at steamid.io (17 digits, not your custom URL).',
    };
  }
  if (!response.ok) {
    return {
      ok: false,
      message: `Steam responded with ${response.status} ${response.statusText}.`,
    };
  }

  let data: { response?: { game_count?: number; games?: unknown[] } };
  try {
    data = await response.json();
  } catch {
    return { ok: false, message: 'Steam returned an unparseable response.' };
  }

  // Steam returns an empty `response: {}` when the profile is private.
  if (!data.response?.games) {
    return {
      ok: false,
      profileVisible: false,
      message:
        'Steam returned no games — your profile is likely private. Set Game Details to Public in Steam privacy settings.',
    };
  }

  return {
    ok: true,
    profileVisible: true,
    gameCount: data.response.game_count ?? data.response.games.length,
  };
}

/**
 * POST /api/onboarding/validate-steam
 * Live-check the supplied Steam credentials and, on success, persist them
 * to the settings table and stamp steamConnectedAt.
 */
export async function POST(request: NextRequest) {
  let userId: string;
  try {
    userId = await requireUserIdFromRequest(request);
  } catch {
    return apiUnauthorized();
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiValidationError('Invalid JSON');
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return apiValidationError(parsed.error.issues[0]?.message ?? 'Invalid input');
  }

  const probe = await probeSteam(parsed.data.steamApiKey, parsed.data.steamUserId);
  if (!probe.ok) {
    return apiSuccess(probe);
  }

  try {
    setSetting('steam_api_key', parsed.data.steamApiKey, 'Steam Web API key');
    setSetting('steam_user_id', parsed.data.steamUserId, 'Steam64 ID');
    updateOnboardingState(userId, { steamConnectedAt: new Date().toISOString() });
  } catch (err) {
    console.error('[validate-steam] Failed to persist credentials:', err);
    return apiError('Validation succeeded but saving failed. Please try again.');
  }

  return apiSuccess(probe);
}
