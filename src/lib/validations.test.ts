import { describe, it, expect } from 'vitest';
import {
  gameFiltersSchema,
  gameIdSchema,
  gameUpdateSchema,
  interestSchema,
  alertUpsertSchema,
  alertUpdateSchema,
  alertIdSchema,
  settingsUpdateSchema,
  syncTriggerSchema,
  searchParamsToObject,
  formatZodError,
} from './validations';

describe('searchParamsToObject', () => {
  it('converts URLSearchParams to plain object', () => {
    const params = new URLSearchParams('foo=bar&baz=qux');
    const result = searchParamsToObject(params);
    expect(result).toEqual({ foo: 'bar', baz: 'qux' });
  });

  it('returns empty object for no params', () => {
    const params = new URLSearchParams();
    const result = searchParamsToObject(params);
    expect(result).toEqual({});
  });
});

describe('formatZodError', () => {
  it('formats errors with field paths', () => {
    const result = gameIdSchema.safeParse({ id: 'abc' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const msg = formatZodError(result.error);
      expect(msg).toContain('id');
    }
  });

  it('joins multiple errors with semicolons', () => {
    const result = interestSchema.safeParse({ gameId: -1, interest: 0 });
    expect(result.success).toBe(false);
    if (!result.success) {
      const msg = formatZodError(result.error);
      expect(msg).toContain(';');
    }
  });
});

describe('gameFiltersSchema', () => {
  it('accepts valid filters', () => {
    const result = gameFiltersSchema.safeParse({
      search: 'Cyberpunk',
      view: 'library',
      sortBy: 'price',
      sortOrder: 'desc',
      page: '2',
      pageSize: '12',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.search).toBe('Cyberpunk');
      expect(result.data.view).toBe('library');
      expect(result.data.sortBy).toBe('price');
      expect(result.data.page).toBe(2);
      expect(result.data.pageSize).toBe(12);
    }
  });

  it('applies defaults for missing fields', () => {
    const result = gameFiltersSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sortBy).toBe('title');
      expect(result.data.sortOrder).toBe('asc');
      expect(result.data.page).toBe(1);
      expect(result.data.pageSize).toBe(24);
    }
  });

  it('coerces string numbers to numbers', () => {
    const result = gameFiltersSchema.safeParse({ page: '3', pageSize: '50', minReview: '70' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(3);
      expect(result.data.pageSize).toBe(50);
      expect(result.data.minReview).toBe(70);
    }
  });

  it('transforms boolean strings', () => {
    const result = gameFiltersSchema.safeParse({ owned: 'true', onSale: 'false' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.owned).toBe(true);
      expect(result.data.onSale).toBe(false);
    }
  });

  it('rejects page < 1', () => {
    const result = gameFiltersSchema.safeParse({ page: '0' });
    expect(result.success).toBe(false);
  });

  it('rejects pageSize > 100', () => {
    const result = gameFiltersSchema.safeParse({ pageSize: '101' });
    expect(result.success).toBe(false);
  });

  it('rejects search strings > 200 chars', () => {
    const result = gameFiltersSchema.safeParse({ search: 'a'.repeat(201) });
    expect(result.success).toBe(false);
  });

  it('rejects invalid sortBy value', () => {
    const result = gameFiltersSchema.safeParse({ sortBy: 'invalid' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid view value', () => {
    const result = gameFiltersSchema.safeParse({ view: 'invalid' });
    expect(result.success).toBe(false);
  });
});

describe('gameIdSchema', () => {
  it('accepts valid integer ID', () => {
    const result = gameIdSchema.safeParse({ id: '42' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.id).toBe(42);
  });

  it('rejects non-numeric ID', () => {
    const result = gameIdSchema.safeParse({ id: 'abc' });
    expect(result.success).toBe(false);
  });

  it('rejects zero', () => {
    const result = gameIdSchema.safeParse({ id: '0' });
    expect(result.success).toBe(false);
  });

  it('rejects negative numbers', () => {
    const result = gameIdSchema.safeParse({ id: '-5' });
    expect(result.success).toBe(false);
  });
});

describe('gameUpdateSchema', () => {
  it('accepts valid partial update', () => {
    const result = gameUpdateSchema.safeParse({ personalInterest: 4, isWatchlisted: true });
    expect(result.success).toBe(true);
  });

  it('accepts empty object', () => {
    const result = gameUpdateSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('rejects interest out of range (too high)', () => {
    const result = gameUpdateSchema.safeParse({ personalInterest: 6 });
    expect(result.success).toBe(false);
  });

  it('rejects interest out of range (too low)', () => {
    const result = gameUpdateSchema.safeParse({ personalInterest: 0 });
    expect(result.success).toBe(false);
  });

  it('rejects notes too long', () => {
    const result = gameUpdateSchema.safeParse({ notes: 'a'.repeat(2001) });
    expect(result.success).toBe(false);
  });

  it('rejects negative priceThreshold', () => {
    const result = gameUpdateSchema.safeParse({ priceThreshold: -1 });
    expect(result.success).toBe(false);
  });
});

describe('interestSchema', () => {
  it('accepts valid payload', () => {
    const result = interestSchema.safeParse({ gameId: 1, interest: 5 });
    expect(result.success).toBe(true);
  });

  it('rejects missing gameId', () => {
    const result = interestSchema.safeParse({ interest: 3 });
    expect(result.success).toBe(false);
  });

  it('rejects interest below 1', () => {
    const result = interestSchema.safeParse({ gameId: 1, interest: 0 });
    expect(result.success).toBe(false);
  });

  it('rejects interest above 5', () => {
    const result = interestSchema.safeParse({ gameId: 1, interest: 6 });
    expect(result.success).toBe(false);
  });
});

describe('alertUpsertSchema', () => {
  it('accepts valid full payload', () => {
    const result = alertUpsertSchema.safeParse({
      gameId: 42,
      targetPrice: 9.99,
      notifyOnAllTimeLow: true,
      notifyOnThreshold: false,
    });
    expect(result.success).toBe(true);
  });

  it('requires gameId', () => {
    const result = alertUpsertSchema.safeParse({ targetPrice: 10 });
    expect(result.success).toBe(false);
  });

  it('rejects negative targetPrice', () => {
    const result = alertUpsertSchema.safeParse({ gameId: 1, targetPrice: -5 });
    expect(result.success).toBe(false);
  });

  it('rejects non-integer gameId', () => {
    const result = alertUpsertSchema.safeParse({ gameId: 1.5 });
    expect(result.success).toBe(false);
  });

  it('accepts minimal payload (gameId only)', () => {
    const result = alertUpsertSchema.safeParse({ gameId: 1 });
    expect(result.success).toBe(true);
  });
});

describe('alertUpdateSchema', () => {
  it('accepts partial updates', () => {
    const result = alertUpdateSchema.safeParse({ isActive: false });
    expect(result.success).toBe(true);
  });

  it('accepts empty object', () => {
    const result = alertUpdateSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('rejects targetPrice > 10000', () => {
    const result = alertUpdateSchema.safeParse({ targetPrice: 10001 });
    expect(result.success).toBe(false);
  });
});

describe('alertIdSchema', () => {
  it('coerces string to number', () => {
    const result = alertIdSchema.safeParse({ id: '5' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.id).toBe(5);
  });

  it('rejects zero', () => {
    const result = alertIdSchema.safeParse({ id: '0' });
    expect(result.success).toBe(false);
  });
});

describe('settingsUpdateSchema', () => {
  it('accepts all allowed keys', () => {
    const result = settingsUpdateSchema.safeParse({
      settings: {
        steam_api_key: 'abc123',
        steam_user_id: '76561198000000000',
        itad_api_key: 'itad-key',
        discord_webhook_url: 'https://discord.com/api/webhooks/123/abc',
        discord_ops_webhook_url: 'https://discord.com/api/webhooks/456/def',
        scoring_weights: '{"priceWeight": 0.3}',
        scoring_thresholds: '{}',
        alert_throttle_hours: '24',
      },
    });
    expect(result.success).toBe(true);
  });

  it('accepts partial keys (not all enum keys required)', () => {
    const result = settingsUpdateSchema.safeParse({
      settings: { steam_api_key: 'abc123' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects unknown keys', () => {
    const result = settingsUpdateSchema.safeParse({
      settings: { unknown_key: 'value' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects values exceeding max length', () => {
    const result = settingsUpdateSchema.safeParse({
      settings: { steam_api_key: 'a'.repeat(5001) },
    });
    expect(result.success).toBe(false);
  });

  it('accepts empty settings object', () => {
    const result = settingsUpdateSchema.safeParse({ settings: {} });
    expect(result.success).toBe(true);
  });
});

describe('syncTriggerSchema', () => {
  it('accepts valid sync types', () => {
    for (const type of ['library', 'wishlist', 'prices', 'hltb', 'reviews']) {
      const result = syncTriggerSchema.safeParse({ type });
      expect(result.success).toBe(true);
    }
  });

  it('rejects invalid sync type', () => {
    const result = syncTriggerSchema.safeParse({ type: 'invalid' });
    expect(result.success).toBe(false);
  });
});
