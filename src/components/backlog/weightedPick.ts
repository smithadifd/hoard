import type { EnrichedGame } from '@/types';

export function weightedPick(games: EnrichedGame[]): EnrichedGame {
  const weights = games.map((g) => {
    let w = 1;
    w *= g.personalInterest ?? 3; // Interest: 1-5x
    if (g.dealScore && g.dealScore >= 70) w *= 1.5; // Good deal bonus
    return w;
  });
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  let random = Math.random() * totalWeight;
  for (let i = 0; i < games.length; i++) {
    random -= weights[i];
    if (random <= 0) return games[i];
  }
  return games[games.length - 1];
}
