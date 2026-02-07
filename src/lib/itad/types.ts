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

export interface ITADPrice {
  price: {
    amount: number;
    amountInt: number;
    currency: string;
  };
  regular: {
    amount: number;
    amountInt: number;
    currency: string;
  };
  cut: number; // Discount percentage
}

export interface ITADDeal {
  id: string;
  slug: string;
  title: string;
  type: string | null;
  deal: {
    shop: ITADShop;
    price: ITADPrice;
    regular: ITADPrice;
    cut: number;
    voucher: string | null;
    storeLow: ITADPrice | null;
    historyLow: ITADHistoricalLow | null;
    flag: string | null;
    drm: string[];
    platforms: string[];
    timestamp: string;
    expiry: string | null;
    url: string;
  };
}

export interface ITADShop {
  id: number;
  name: string;
}

export interface ITADHistoricalLow {
  amount: number;
  amountInt: number;
  currency: string;
  shop: ITADShop;
  timestamp: string;
}

export interface ITADGameLookup {
  found: boolean;
  game: ITADGame;
}

export interface ITADOverview {
  id: string;
  price?: ITADPrice;
  lowest?: ITADHistoricalLow;
  bundled: number;
  urls: {
    game: string;
  };
}

export interface ITADSearchResult {
  id: string;
  slug: string;
  title: string;
  type: string | null;
  mature: boolean;
}
