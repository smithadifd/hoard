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

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);

    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, embeds }),
        signal: controller.signal,
      });

      return response.ok;
    } catch (error) {
      console.error('Discord notification failed:', error);
      return false;
    } finally {
      clearTimeout(timer);
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
    dealScore?: number;
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

    if (game.dealScore !== undefined) {
      const rating = game.dealScore >= 85 ? 'Excellent' : game.dealScore >= 70 ? 'Great' : game.dealScore >= 55 ? 'Good' : 'Okay';
      embed.fields!.push({
        name: 'Deal Score',
        value: `${game.dealScore}/100 (${rating})`,
        inline: true,
      });
    }

    return this.send('', [embed]);
  }

  /**
   * Send a digest of games still sitting at their known all-time low.
   * Condenses multiple "still at ATL" games into a single compact embed.
   */
  async sendAtlDigest(games: Array<{
    title: string;
    currentPrice: number;
    regularPrice: number;
    discountPercent: number;
    store: string;
    storeUrl: string;
  }>): Promise<boolean> {
    if (games.length === 0) return true;

    const MAX_DESCRIPTION_LENGTH = 4000;
    const lines: string[] = [];
    for (const game of games) {
      const price = game.currentPrice === 0
        ? '**FREE**'
        : `~~$${game.regularPrice.toFixed(2)}~~ **$${game.currentPrice.toFixed(2)}** (-${game.discountPercent}%)`;
      lines.push(`[${game.title}](${game.storeUrl}) — ${price} @ ${game.store}`);
    }

    // Chunk into multiple embeds if description exceeds safe limit
    const embeds: DiscordEmbed[] = [];
    const chunks: string[][] = [];
    let currentLines: string[] = [];
    let currentLength = 0;

    for (const line of lines) {
      if (currentLength + line.length + 1 > MAX_DESCRIPTION_LENGTH && currentLines.length > 0) {
        chunks.push(currentLines);
        currentLines = [];
        currentLength = 0;
      }
      currentLines.push(line);
      currentLength += line.length + 1; // +1 for newline
    }
    if (currentLines.length > 0) {
      chunks.push(currentLines);
    }

    for (let i = 0; i < chunks.length; i++) {
      embeds.push(this.buildDigestEmbed(chunks[i], games.length, chunks.length > 1 ? i + 1 : undefined, chunks.length > 1 ? chunks.length : undefined));
    }

    return this.send('', embeds);
  }

  private buildDigestEmbed(lines: string[], totalCount: number, part?: number, totalParts?: number): DiscordEmbed {
    const suffix = part && totalParts ? ` (part ${part}/${totalParts})` : '';
    return {
      title: `Still at All-Time Low (${totalCount} game${totalCount === 1 ? '' : 's'})${suffix}`,
      description: lines.join('\n'),
      color: 0x6b7280, // Gray — distinct from green "new ATL"
      footer: { text: 'Hoard — These games remain at their historical low price' },
      timestamp: new Date().toISOString(),
    };
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
   * Send a release notification when a tracked game launches.
   */
  async sendReleaseNotification(game: {
    title: string;
    steamAppId: number;
    headerImageUrl?: string;
    releaseDate?: string;
    reviewDescription?: string;
  }): Promise<boolean> {
    const storeUrl = `https://store.steampowered.com/app/${game.steamAppId}`;

    const embed: DiscordEmbed = {
      title: `🎮 Released: ${game.title}`,
      description: `**${game.title}** is now available!`,
      url: storeUrl,
      color: 0x3b82f6, // Blue for releases
      fields: [
        {
          name: 'Store Page',
          value: `[Steam](${storeUrl})`,
          inline: true,
        },
      ],
      thumbnail: game.headerImageUrl ? { url: game.headerImageUrl } : undefined,
      footer: { text: 'Hoard - Game Deal Tracker' },
      timestamp: new Date().toISOString(),
    };

    if (game.releaseDate) {
      embed.fields!.push({
        name: 'Release Date',
        value: game.releaseDate,
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
