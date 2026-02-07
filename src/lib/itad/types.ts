/**
 * IsThereAnyDeal API v2 type definitions.
 * Docs: https://docs.isthereanydeal.com/
 */

export interface ITADGame {
  id: string;
  slug: string;
  title: string;
  type: string | null;
  mature: boolean;
}

export interface ITADMoney {
  amount: number;
  amountInt: number;
  currency: string;
}

export interface ITADShop {
  id: number;
  name: string;
}

// ============================================
// /games/lookup/v1
// ============================================

/** GET response: single lookup result */
export interface ITADGameLookup {
  found: boolean;
  game: ITADGame;
}

/** POST response: batch lookup — array of results aligned to input */
export interface ITADLookupResult {
  found: boolean;
  game: ITADGame;
}

// ============================================
// /games/overview/v2
// ============================================

/** POST /games/overview/v2 — full response envelope */
export interface ITADOverviewResponse {
  prices: ITADOverviewPrice[];
  bundles: unknown[];
}

/** A single game's overview pricing entry */
export interface ITADOverviewPrice {
  id: string;
  current?: {
    shop: ITADShop;
    price: ITADMoney;
    regular: ITADMoney;
    cut: number;
    voucher: unknown | null;
    flag: unknown | null;
    drm: Array<{ id: number; name: string }>;
    platforms: Array<{ id: number; name: string }>;
    timestamp: string;
    expiry: string | null;
    url: string;
  };
  lowest?: {
    shop: ITADShop;
    price: ITADMoney;
    regular: ITADMoney;
    cut: number;
    timestamp: string;
  };
  bundled: number;
  urls: {
    game: string;
  };
}

// ============================================
// /deals/v2
// ============================================

export interface ITADDeal {
  id: string;
  slug: string;
  title: string;
  type: string | null;
  deal: {
    shop: ITADShop;
    price: ITADMoney;
    regular: ITADMoney;
    cut: number;
    voucher: string | null;
    storeLow: ITADMoney | null;
    historyLow: ITADMoney | null;
    flag: string | null;
    drm: string[];
    platforms: string[];
    timestamp: string;
    expiry: string | null;
    url: string;
  };
}

// ============================================
// /games/search/v1
// ============================================

export interface ITADSearchResult {
  id: string;
  slug: string;
  title: string;
  type: string | null;
  mature: boolean;
}

// ============================================
// /games/prices/v3
// ============================================

export interface ITADPricesV3Game {
  id: string;
  historyLow?: {
    all?: ITADMoney;
    y1?: ITADMoney;
    m3?: ITADMoney;
  };
  deals: ITADPriceEntry[];
}

export interface ITADPriceEntry {
  shop: ITADShop;
  price: ITADMoney;
  regular: ITADMoney;
  cut: number;
  voucher: unknown | null;
  storeLow: ITADMoney | null;
  flag: unknown | null;
  drm: Array<{ id: number; name: string }>;
  platforms: Array<{ id: number; name: string }>;
  timestamp: string;
  expiry: string | null;
  url: string;
}
