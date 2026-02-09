import { NextResponse } from 'next/server';
import { getEffectiveConfig } from '@/lib/config';
import { getDiscordClient } from '@/lib/discord/client';
import { requireUserIdFromRequest } from '@/lib/auth-helpers';

/**
 * POST /api/alerts/test
 * Send a test Discord notification to verify webhook configuration.
 */
export async function POST(request: Request) {
  try {
    await requireUserIdFromRequest(request);
  } catch {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  try {
    const config = getEffectiveConfig();

    if (!config.discordWebhookUrl) {
      return NextResponse.json(
        { error: 'Discord webhook URL is not configured. Set it in Settings first.' },
        { status: 400 }
      );
    }

    const discord = getDiscordClient();
    const sent = await discord.send('', [{
      title: 'Hoard Test Notification',
      description: 'Your Discord webhook is configured correctly! Price alerts will appear here when triggered.',
      color: 0x1a9fff, // steam-blue
      footer: { text: 'Hoard - Game Deal Tracker' },
      timestamp: new Date().toISOString(),
    }]);

    if (!sent) {
      return NextResponse.json(
        { error: 'Failed to send test notification. Check your webhook URL.' },
        { status: 500 }
      );
    }

    return NextResponse.json({ data: { sent: true, message: 'Test notification sent!' } });
  } catch (error) {
    console.error('Failed to send test notification:', error);
    return NextResponse.json(
      { error: 'Failed to send test notification' },
      { status: 500 }
    );
  }
}
