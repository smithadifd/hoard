import { getEffectiveConfig } from '@/lib/config';
import { getDiscordClient } from '@/lib/discord/client';
import { requireUserIdFromRequest } from '@/lib/auth-helpers';
import { apiSuccess, apiError, apiUnauthorized, apiValidationError } from '@/lib/utils/api';

/**
 * POST /api/alerts/test
 * Send a test Discord notification to verify webhook configuration.
 */
export async function POST(request: Request) {
  try {
    await requireUserIdFromRequest(request);
  } catch {
    return apiUnauthorized();
  }

  try {
    const config = getEffectiveConfig();

    if (!config.discordWebhookUrl) {
      return apiValidationError('Discord webhook URL is not configured. Set it in Settings first.');
    }

    const discord = getDiscordClient();
    const sent = await discord.send('', [{
      title: 'Hoard Test Notification',
      description: 'Your Discord webhook is configured correctly! Price alerts will appear here when triggered.',
      color: 0xF59E0B, // primary amber
      footer: { text: 'Hoard - Game Deal Tracker' },
      timestamp: new Date().toISOString(),
    }]);

    if (!sent) {
      return apiError('Failed to send test notification. Check your webhook URL.');
    }

    return apiSuccess({ sent: true, message: 'Test notification sent!' });
  } catch (error) {
    console.error('[POST /api/alerts/test]', error);
    return apiError('Failed to send test notification');
  }
}
