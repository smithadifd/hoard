import { describe, it, expect } from 'vitest';
import { parseGameFiltersFromParams } from './filters';

describe('parseGameFiltersFromParams — Value Received filters (R14)', () => {
  it('leaves sortBy unset when absent, so the page default (valueReceived) applies', () => {
    const parsed = parseGameFiltersFromParams({});
    expect(parsed.sortBy).toBeUndefined();
    expect(parsed.sortOrder).toBeUndefined();
  });

  it('lets an explicit sortBy override the page default', () => {
    const parsed = parseGameFiltersFromParams({ sortBy: 'realizedDollarsPerHour', sortOrder: 'asc' });
    expect(parsed.sortBy).toBe('realizedDollarsPerHour');
    expect(parsed.sortOrder).toBe('asc');
  });

  it('parses the rated flag', () => {
    expect(parseGameFiltersFromParams({ rated: 'true' }).rated).toBe(true);
    expect(parseGameFiltersFromParams({ rated: 'false' }).rated).toBe(false);
    expect(parseGameFiltersFromParams({}).rated).toBeUndefined();
  });

  it('parses a valid valueReceivedTier and rejects an invalid one', () => {
    expect(parseGameFiltersFromParams({ valueReceivedTier: 'exceeded' }).valueReceivedTier).toBe('exceeded');
    expect(parseGameFiltersFromParams({ valueReceivedTier: 'unrealized' }).valueReceivedTier).toBe('unrealized');
    expect(parseGameFiltersFromParams({ valueReceivedTier: 'bogus' }).valueReceivedTier).toBeUndefined();
  });
});
