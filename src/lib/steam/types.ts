/**
 * Steam Web API type definitions.
 * Docs: https://developer.valvesoftware.com/wiki/Steam_Web_API
 */

export interface SteamOwnedGame {
  appid: number;
  name: string;
  playtime_forever: number; // minutes
  playtime_2weeks?: number; // minutes
  img_icon_url: string;
  has_community_visible_stats: boolean;
  playtime_windows_forever: number;
  playtime_mac_forever: number;
  playtime_linux_forever: number;
  rtime_last_played: number; // Unix timestamp
}

export interface SteamOwnedGamesResponse {
  response: {
    game_count: number;
    games: SteamOwnedGame[];
  };
}

/**
 * Response from IWishlistService/GetWishlist/v1.
 * The old wishlistdata endpoint was deprecated — this is the replacement.
 * Only returns appid, priority, and date_added per item (no metadata).
 */
export interface SteamWishlistResponse {
  response: {
    items: SteamWishlistEntry[];
  };
}

export interface SteamWishlistEntry {
  appid: number;
  priority: number;
  date_added: number; // Unix timestamp
}

/**
 * @deprecated Old wishlistdata endpoint types — kept for reference.
 */
export interface SteamWishlistItem {
  name: string;
  capsule: string;
  review_score: number;
  review_desc: string;
  reviews_total: string;
  reviews_percent: number;
  release_date: string;
  release_string: string;
  platform_icons: string;
  subs: SteamWishlistSub[];
  type: string;
  screenshots: string[];
  review_css: string;
  priority: number;
  added: number;
  background: string;
  rank: number;
  tags: string[];
  is_free_game: boolean;
  win: number;
  mac: number;
  linux: number;
}

export interface SteamWishlistSub {
  id: number;
  discount_block: string;
  discount_pct: number;
  price: string;
}

export interface SteamAppDetails {
  success: boolean;
  data: {
    type: string;
    name: string;
    steam_appid: number;
    required_age: number;
    is_free: boolean;
    detailed_description: string;
    about_the_game: string;
    short_description: string;
    header_image: string;
    capsule_image: string;
    website: string;
    developers: string[];
    publishers: string[];
    price_overview?: {
      currency: string;
      initial: number;
      final: number;
      discount_percent: number;
      initial_formatted: string;
      final_formatted: string;
    };
    categories?: Array<{ id: number; description: string }>;
    genres?: Array<{ id: string; description: string }>;
    release_date: {
      coming_soon: boolean;
      date: string;
    };
    metacritic?: {
      score: number;
      url: string;
    };
  };
}

export interface SteamReviewSummary {
  success: number;
  query_summary: {
    num_reviews: number;
    review_score: number;
    review_score_desc: string;
    total_positive: number;
    total_negative: number;
    total_reviews: number;
  };
}
