export interface TriageGame {
  id: number;
  steamAppId: number;
  title: string;
  headerImageUrl: string | null;
  developer: string | null;
  reviewScore: number | null;
  reviewDescription: string | null;
  hltbMain: number | null;
  currentPrice: number | null;
  personalInterest: number;
  interestRatedAt: string | null;
  // Post-play enjoyment ("was it worth it?") — used by the 'value' triage view.
  enjoymentRating: number | null;
  enjoymentRatedAt: string | null;
}
