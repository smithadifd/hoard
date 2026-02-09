import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DiscordClient } from './client';

// Mock getEffectiveConfig
vi.mock('../config', () => ({
  getEffectiveConfig: vi.fn(),
}));

import { getEffectiveConfig } from '../config';
const mockGetConfig = vi.mocked(getEffectiveConfig);

describe('DiscordClient', () => {
  let client: DiscordClient;

  beforeEach(() => {
    client = new DiscordClient();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  describe('send', () => {
    it('returns false when webhook URL not configured', async () => {
      mockGetConfig.mockReturnValue({ discordWebhookUrl: '' } as never);

      const result = await client.send('test message');
      expect(result).toBe(false);
    });

    it('POSTs to webhook URL with correct payload', async () => {
      mockGetConfig.mockReturnValue({
        discordWebhookUrl: 'https://discord.com/api/webhooks/123/abc',
      } as never);

      const mockFetch = vi.spyOn(global, 'fetch').mockResolvedValue(
        new Response(null, { status: 204 })
      );

      const result = await client.send('hello', [{ title: 'Test', color: 0x00ff00 }]);
      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://discord.com/api/webhooks/123/abc',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1]!.body as string);
      expect(body.content).toBe('hello');
      expect(body.embeds).toHaveLength(1);
      expect(body.embeds[0].title).toBe('Test');
    });

    it('returns false on network error', async () => {
      mockGetConfig.mockReturnValue({
        discordWebhookUrl: 'https://discord.com/api/webhooks/123/abc',
      } as never);

      vi.spyOn(global, 'fetch').mockRejectedValue(new Error('Network error'));

      const result = await client.send('test');
      expect(result).toBe(false);
    });

    it('returns false on non-200 response', async () => {
      mockGetConfig.mockReturnValue({
        discordWebhookUrl: 'https://discord.com/api/webhooks/123/abc',
      } as never);

      vi.spyOn(global, 'fetch').mockResolvedValue(
        new Response(null, { status: 429 })
      );

      const result = await client.send('test');
      expect(result).toBe(false);
    });
  });

  describe('sendPriceAlert', () => {
    beforeEach(() => {
      mockGetConfig.mockReturnValue({
        discordWebhookUrl: 'https://discord.com/api/webhooks/123/abc',
      } as never);
    });

    it('sends correct embed for ATL deal', async () => {
      const mockFetch = vi.spyOn(global, 'fetch').mockResolvedValue(
        new Response(null, { status: 204 })
      );

      await client.sendPriceAlert({
        title: 'Test Game',
        currentPrice: 5.99,
        regularPrice: 29.99,
        historicalLow: 5.99,
        discountPercent: 80,
        store: 'Steam',
        storeUrl: 'https://store.steampowered.com/app/123',
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1]!.body as string);
      const embed = body.embeds[0];
      expect(embed.title).toContain('ALL-TIME LOW');
      expect(embed.color).toBe(0x22c55e); // Green
    });

    it('sends correct embed for free game', async () => {
      const mockFetch = vi.spyOn(global, 'fetch').mockResolvedValue(
        new Response(null, { status: 204 })
      );

      await client.sendPriceAlert({
        title: 'Free Game',
        currentPrice: 0,
        regularPrice: 19.99,
        historicalLow: 4.99,
        discountPercent: 100,
        store: 'Steam',
        storeUrl: 'https://store.steampowered.com/app/456',
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1]!.body as string);
      const embed = body.embeds[0];
      expect(embed.title).toContain('FREE GAME');
      expect(embed.color).toBe(0x9333ea); // Purple
      expect(embed.fields[0].value).toContain('FREE');
    });

    it('sends correct embed for threshold deal', async () => {
      const mockFetch = vi.spyOn(global, 'fetch').mockResolvedValue(
        new Response(null, { status: 204 })
      );

      await client.sendPriceAlert({
        title: 'Deal Game',
        currentPrice: 14.99,
        regularPrice: 29.99,
        historicalLow: 9.99,
        discountPercent: 50,
        store: 'GOG',
        storeUrl: 'https://gog.com/game/123',
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1]!.body as string);
      const embed = body.embeds[0];
      expect(embed.title).toContain('Deal Alert');
      expect(embed.color).toBe(0xeab308); // Yellow
    });

    it('includes $/hr field when provided', async () => {
      const mockFetch = vi.spyOn(global, 'fetch').mockResolvedValue(
        new Response(null, { status: 204 })
      );

      await client.sendPriceAlert({
        title: 'Game',
        currentPrice: 10,
        regularPrice: 20,
        historicalLow: 10,
        discountPercent: 50,
        store: 'Steam',
        storeUrl: 'https://store.steampowered.com/app/1',
        dollarsPerHour: 2.50,
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1]!.body as string);
      const fields = body.embeds[0].fields;
      const dollarField = fields.find((f: { name: string }) => f.name === '$/Hour');
      expect(dollarField).toBeDefined();
      expect(dollarField.value).toBe('$2.50/hr');
    });
  });

  describe('sendBackupNotification', () => {
    it('skips success notifications', async () => {
      const result = await client.sendBackupNotification({ success: true });
      expect(result).toBe(true);
    });

    it('sends failure notifications', async () => {
      mockGetConfig.mockReturnValue({
        discordWebhookUrl: 'https://discord.com/api/webhooks/123/abc',
      } as never);

      const mockFetch = vi.spyOn(global, 'fetch').mockResolvedValue(
        new Response(null, { status: 204 })
      );

      await client.sendBackupNotification({ success: false, error: 'Disk full' });

      const body = JSON.parse(mockFetch.mock.calls[0][1]!.body as string);
      const embed = body.embeds[0];
      expect(embed.title).toContain('Backup Failed');
      expect(embed.color).toBe(0xef4444); // Red
    });
  });
});
