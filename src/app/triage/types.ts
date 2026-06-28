export interface TriageGame {
  id: number;
  steamAppId: number;
  title: string;
  headerImageUrl: string | null;
  developer: string | null;
  reviewScore: number | null;
  reviewDescription: string | null;
  hltbMain: number | null;
  steamPlaytimeMedian: number | null;
  steamPlaytimeSampleSize: number | null;
  steamPlaytimeMissCount: number | null;
  playtimeSource: 'hltb' | 'steam_reviews';
  currentPrice: number | null;
  personalInterest: number;
  interestRatedAt: string | null;
  // Post-play enjoyment ("was it worth it?") — used by the 'value' triage view.
  enjoymentRating: number | null;
  enjoymentRatedAt: string | null;
}
