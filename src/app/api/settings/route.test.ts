import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, PUT } from './route';

// Mock auth helper
vi.mock('@/lib/auth-helpers', () => ({
  requireUserIdFromRequest: vi.fn().mockResolvedValue('test-user-id'),
}));

vi.mock('@/lib/db/queries', () => ({
  getAllSettings: vi.fn(),
  setSetting: vi.fn(),
}));

import { getAllSettings, setSetting } from '@/lib/db/queries';
const mockGetAll = vi.mocked(getAllSettings);
const mockSetSetting = vi.mocked(setSetting);

function createRequest(url: string, init?: RequestInit): NextRequest {
  return new NextRequest(new URL(url, 'http://localhost:3000'), init);
}

describe('GET /api/settings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns non-secret settings as-is', async () => {
    mockGetAll.mockReturnValue({
      steam_user_id: '76561198000000000',
      alert_throttle_hours: '24',
    });

    const res = await GET(createRequest('/api/settings'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.steam_user_id).toBe('76561198000000000');
    expect(body.data.alert_throttle_hours).toBe('24');
  });

  it('redacts secret values and reports them as configured booleans', async () => {
    mockGetAll.mockReturnValue({
      steam_api_key: 'key123',
      itad_api_key: 'itad456',
      discord_webhook_url: 'https://discord.com/api/webhooks/123',
      steam_user_id: '76561198000000000',
    });

    const res = await GET(createRequest('/api/settings'));
    const body = await res.json();

    expect(res.status).toBe(200);
    // Raw secret values must never be echoed back.
    expect(body.data.steam_api_key).toBeUndefined();
    expect(body.data.itad_api_key).toBeUndefined();
    expect(body.data.discord_webhook_url).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain('key123');
    expect(JSON.stringify(body)).not.toContain('itad456');
    // Configured-ness is surfaced without the value.
    expect(body.data._secrets.steam_api_key).toBe(true);
    expect(body.data._secrets.itad_api_key).toBe(true);
    expect(body.data._secrets.discord_webhook_url).toBe(true);
    expect(body.data._secrets.discord_ops_webhook_url).toBe(false);
    // Non-secret values still pass through.
    expect(body.data.steam_user_id).toBe('76561198000000000');
  });
});

describe('PUT /api/settings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('saves valid settings', async () => {
    const res = await PUT(createRequest('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        settings: {
          steam_api_key: 'new-key',
          steam_user_id: '76561198000000000',
          itad_api_key: 'itad-key',
          discord_webhook_url: 'https://discord.com/api/webhooks/123',
          discord_ops_webhook_url: '',
          scoring_weights: '{}',
          scoring_thresholds: '{}',
          alert_throttle_hours: '24',
        },
      }),
    }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.message).toBe('Settings saved');
    expect(mockSetSetting).toHaveBeenCalledWith('steam_api_key', 'new-key');
  });

  it('returns 400 for unknown settings key', async () => {
    const res = await PUT(createRequest('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        settings: { unknown_key: 'value' },
      }),
    }));

    expect(res.status).toBe(400);
    expect(mockSetSetting).not.toHaveBeenCalled();
  });

  it('returns 400 for invalid body structure', async () => {
    const res = await PUT(createRequest('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ not_settings: true }),
    }));

    expect(res.status).toBe(400);
  });

  it('returns 500 when setSetting throws', async () => {
    mockSetSetting.mockImplementation(() => { throw new Error('DB error'); });

    const res = await PUT(createRequest('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        settings: {
          steam_api_key: 'key',
          steam_user_id: 'id',
          itad_api_key: 'itad',
          discord_webhook_url: 'https://discord.com/api/webhooks/123/abc',
          discord_ops_webhook_url: '',
          scoring_weights: '{}',
          scoring_thresholds: '{}',
          alert_throttle_hours: '24',
        },
      }),
    }));

    expect(res.status).toBe(500);
  });
});
