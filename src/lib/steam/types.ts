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

export interface SteamSearchResult {
  appId: number;
  name: string;
  tinyImage: string | null;
  price: { initial: number; final: number; discountPercent: number } | null;
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

// A single review from the paginated /appreviews endpoint. Only the playtime
// fields we sample are typed; the full payload has many more.
export interface SteamReview {
  recommendationid: string;
  author: {
    steamid: string;
    playtime_forever: number; // minutes, total
    playtime_at_review?: number; // minutes, at the time the review was written
  };
}

// Paginated /appreviews response (num_per_page > 0). `cursor` is the token for
// the next page; it must be URL-encoded when passed back.
export interface SteamReviewPage {
  success: number;
  cursor?: string;
  reviews?: SteamReview[];
}
