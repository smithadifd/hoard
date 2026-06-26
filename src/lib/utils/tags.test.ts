import { describe, it, expect } from 'vitest';
import { curateDisplayTags } from './tags';

describe('curateDisplayTags', () => {
  it('keeps decision-relevant play-mode categories', () => {
    expect(curateDisplayTags(['Single-player', 'Co-op', 'Online PvP'])).toEqual([
      'Single-player',
      'Co-op',
      'Online PvP',
    ]);
  });

  it('drops Steam feature-flag plumbing categories', () => {
    const input = [
      'Single-player',
      'Steam Achievements',
      'Steam Cloud',
      'Family Sharing',
      'Full controller support',
      'Steam Trading Cards',
      'Custom Volume Controls',
      'Captions available',
      'Remote Play on TV',
      'Co-op',
    ];
    expect(curateDisplayTags(input)).toEqual(['Single-player', 'Co-op']);
  });

  it('drops localized (non-English) category variants', () => {
    // Steam appdetails sometimes returns localized category names.
    expect(curateDisplayTags(['Для одного игрока', 'Un jugador', 'Single-player'])).toEqual([
      'Single-player',
    ]);
  });

  it('matches case-insensitively', () => {
    expect(curateDisplayTags(['SINGLE-PLAYER', 'co-op'])).toEqual(['SINGLE-PLAYER', 'co-op']);
  });

  it('de-duplicates while preserving first-seen order', () => {
    expect(curateDisplayTags(['Co-op', 'Single-player', 'co-op'])).toEqual([
      'Co-op',
      'Single-player',
    ]);
  });

  it('returns an empty array when no useful tags are present', () => {
    expect(curateDisplayTags(['Steam Cloud', 'HDR available', 'Stereo Sound'])).toEqual([]);
  });

  it('handles an empty input', () => {
    expect(curateDisplayTags([])).toEqual([]);
  });
});
