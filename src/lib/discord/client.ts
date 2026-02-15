/**
 * Discord Webhook Client
 *
 * Sends formatted notifications to a Discord channel via webhooks.
 * Used for price alerts when a watched game hits a target price.
 */

import { getEffectiveConfig } from '../config';

interface DiscordEmbed {
  title: string;
  description?: string;
  url?: string;
  color?: number;
  fields?: Array<{
    name: string;
    value: string;
    inline?: boolean;
  }>;
  thumbnail?: {
    url: string;
  };
  footer?: {
    text: string;
  };
  timestamp?: string;
}

export class DiscordClient {
  /**
   * Get the webhook URL fresh from config (DB settings override env vars).
   * Read at send-time so changes in Settings take effect immediately.
   */
  private getWebhookUrl(): string {
    return getEffectiveConfig().discordWebhookUrl;
  }

  /**
   * Get the ops webhook URL. Falls back to main webhook if not configured.
   */
  private getOpsWebhookUrl(): string {
    const config = getEffectiveConfig();
    return config.discordOpsWebhookUrl || config.discordWebhookUrl;
  }

  /**
   * Send a raw webhook message to a specific URL.
   */
  private async sendToUrl(webhookUrl: string, content: string, embeds?: DiscordEmbed[]): Promise<boolean> {
    if (!webhookUrl) {
      console.warn('Discord webhook URL not configured, skipping notification');
      return false;
    }

    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, embeds }),
      });

      return response.ok;
    } catch (error) {
      console.error('Discord notification failed:', error);
      return false;
    }
  }

  /**
   * Send a raw webhook message to the main (deals) channel.
   */
  async send(content: string, embeds?: DiscordEmbed[]): Promise<boolean> {
    return this.sendToUrl(this.getWebhookUrl(), content, embeds);
  }

  /**
   * Send a raw webhook message to the ops channel.
   */
  async sendToOps(content: string, embeds?: DiscordEmbed[]): Promise<boolean> {
    return this.sendToUrl(this.getOpsWebhookUrl(), content, embeds);
  }

  /**
   * Send a price alert notification.
   */
  async sendPriceAlert(game: {
    title: string;
    headerImageUrl?: string;
    currentPrice: number;
    regularPrice: number;
    historicalLow: number;
    discountPercent: number;
    store: string;
    storeUrl: string;
    dollarsPerHour?: number;
    reviewDescription?: string;
  }): Promise<boolean> {
    const isFree = game.currentPrice === 0;
    const isAllTimeLow = game.currentPrice <= game.historicalLow;

    let prefix: string;
    let color: number;
    if (isFree) {
      prefix = '🎁 FREE GAME';
      color = 0x9333ea; // Purple for free
    } else if (isAllTimeLow) {
      prefix = '🏆 ALL-TIME LOW';
      color = 0x22c55e; // Green for ATL
    } else {
      prefix = '💰 Deal Alert';
      color = 0xeab308; // Yellow otherwise
    }

    const embed: DiscordEmbed = {
      title: `${prefix}: ${game.title}`,
      url: game.storeUrl,
      color,
      fields: [
        {
          name: 'Price',
          value: isFree
            ? `~~$${game.regularPrice.toFixed(2)}~~ → **FREE** (-100%)`
            : `~~$${game.regularPrice.toFixed(2)}~~ → **$${game.currentPrice.toFixed(2)}** (-${game.discountPercent}%)`,
          inline: true,
        },
        {
          name: 'Historical Low',
          value: `$${game.historicalLow.toFixed(2)}`,
          inline: true,
        },
        {
          name: 'Store',
          value: game.store,
          inline: true,
        },
      ],
      thumbnail: game.headerImageUrl ? { url: game.headerImageUrl } : undefined,
      footer: { text: 'Hoard - Game Deal Tracker' },
      timestamp: new Date().toISOString(),
    };

    // Add optional fields
    if (game.dollarsPerHour !== undefined) {
      embed.fields!.push({
        name: '$/Hour',
        value: `$${game.dollarsPerHour.toFixed(2)}/hr`,
        inline: true,
      });
    }

    if (game.reviewDescription) {
      embed.fields!.push({
        name: 'Reviews',
        value: game.reviewDescription,
        inline: true,
      });
    }

    return this.send('', [embed]);
  }

  /**
   * Send an operational alert (sync failures, startup, etc.).
   */
  async sendOperationalAlert(alert: {
    title: string;
    description: string;
    color?: number;
    fields?: Array<{ name: string; value: string; inline?: boolean }>;
  }): Promise<boolean> {
    const embed: DiscordEmbed = {
      title: alert.title,
      description: alert.description,
      color: alert.color ?? 0xef4444, // Red by default
      fields: alert.fields,
      footer: { text: 'Hoard - Operations' },
      timestamp: new Date().toISOString(),
    };

    return this.sendToOps('', [embed]);
  }

  /**
   * Send a backup status notification.
   * Only sends on failure by default to avoid notification fatigue.
   */
  async sendBackupNotification(result: {
    success: boolean;
    fileSize?: number;
    error?: string;
    backupCount?: number;
  }): Promise<boolean> {
    if (result.success) {
      // Skip success notifications — only failures are worth alerting
      return true;
    }

    const embed: DiscordEmbed = {
      title: '\u26a0\ufe0f Backup Failed',
      description: result.error || 'Unknown error during database backup',
      color: 0xef4444, // Red
      fields: [],
      footer: { text: 'Hoard - Operations' },
      timestamp: new Date().toISOString(),
    };

    return this.sendToOps('', [embed]);
  }
}

// Singleton instance
let discordClient: DiscordClient | null = null;

export function getDiscordClient(): DiscordClient {
  if (!discordClient) {
    discordClient = new DiscordClient();
  }
  return discordClient;
}
