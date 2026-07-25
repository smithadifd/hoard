import { describe, it, expect } from 'vitest';
import { cleanSearchTitle, normalizeGameTitle, similarity } from './match';

describe('cleanSearchTitle', () => {
  it.each([
    ['strips trademark/copyright symbols', 'Half-Life™ 2®©', 'Half-Life 2'],
    ["keeps apostrophes within words", "Assassin's Creed", "Assassin's Creed"],
    ['keeps hyphens within words', 'Spider-Man', 'Spider-Man'],
    // Punctuation: colons/exclamation marks/commas become spaces, then collapse.
    ['replaces punctuation (colon + exclamation) with collapsed spaces', "Assassin's Creed: Valhalla!", "Assassin's Creed Valhalla"],
    ['replaces commas and periods with collapsed spaces', 'Tom Clancy\'s, The Division.', "Tom Clancy's The Division"],
    ['collapses repeated internal whitespace', 'Portal    2', 'Portal 2'],
    ['trims leading/trailing whitespace', '  Half-Life 2  ', 'Half-Life 2'],
    // Empty / edge inputs
    ['returns empty string for empty input', '', ''],
    ['returns empty string for a symbols-only input', '™®©!!!', ''],
    ['leaves a plain alphanumeric title untouched', 'Half-Life 2', 'Half-Life 2'],
  ])('%s: %j -> %j', (_label, input, expected) => {
    expect(cleanSearchTitle(input)).toBe(expected);
  });
});

describe('normalizeGameTitle', () => {
  it.each([
    // Docstring-documented examples
    [
      'strips a GOTY suffix + trailing year',
      'The Elder Scrolls IV: Oblivion Game of the Year Edition (2009)',
      'The Elder Scrolls IV: Oblivion',
    ],
    ['strips trailing "Legacy"', 'Grand Theft Auto V Legacy', 'Grand Theft Auto V'],
    [
      'strips a "(Classic, YYYY)" parenthetical',
      'Star Wars: Battlefront 2 (Classic, 2005)',
      'Star Wars: Battlefront 2',
    ],

    // Subtitles: a colon-separated subtitle is content, not noise — must survive.
    ['keeps a colon subtitle, only strips the trailing edition suffix', 'The Witcher 3: Wild Hunt - Game of the Year Edition', 'The Witcher 3: Wild Hunt'],
    ['keeps a colon subtitle with no edition suffix untouched', 'Mass Effect: Legendary Edition', 'Mass Effect'], // "Legendary Edition" is itself a stripped suffix
    ['keeps an em-dash subtitle intact when no suffix follows', 'Middle-earth: Shadow of War', 'Middle-earth: Shadow of War'],

    // Roman numerals: must never be mistaken for an edition/version keyword.
    ['leaves a bare roman numeral title untouched', 'Civilization VI', 'Civilization VI'],
    ['leaves "Final Fantasy VII" untouched (no edition suffix)', 'Final Fantasy VII', 'Final Fantasy VII'],
    ['does NOT strip "Remake" (near-miss: only Remaster/Remastered are stripped)', 'Final Fantasy VII Remake', 'Final Fantasy VII Remake'],

    // Casing: the edition-suffix match is case-insensitive.
    ['strips a lowercase "special edition" suffix', 'Skyrim special edition', 'Skyrim'],
    ['strips a mixed-case "Deluxe EDITION" suffix', 'Doom Deluxe EDITION', 'Doom'],
    ['strips "GOTY" without the word "Edition" following it', 'Borderlands 2 GOTY', 'Borderlands 2'],

    // Edition-keyword coverage (each stripped with the "Edition" word attached).
    ['strips "Enhanced Edition"', 'Baldur\'s Gate Enhanced Edition', "Baldur's Gate"],
    ['strips "Ultimate Edition"', 'Street Fighter V Ultimate Edition', 'Street Fighter V'],
    ['strips "Complete Edition"', 'The Witcher 2 Complete Edition', 'The Witcher 2'],
    ['strips "Definitive Edition"', 'Age of Empires II Definitive Edition', 'Age of Empires II'],
    ['strips "Anniversary Edition"', 'Diablo II Anniversary Edition', 'Diablo II'],
    ["strips \"Director's Cut\"", "Death Stranding Director's Cut", 'Death Stranding'],
    ["strips \"Directors Cut\" (no apostrophe)", 'Fahrenheit Directors Cut', 'Fahrenheit'],

    // Near-miss: a parenthetical that is NOT a year must survive untouched — the
    // year-strip regex requires a 4-digit number inside the trailing parens.
    ['does NOT strip a non-year trailing parenthetical', 'Half-Life 2 (Complete)', 'Half-Life 2 (Complete)'],
    // Near-miss: "Legacy" only strips as a trailing word, not mid-title/leading.
    ['does NOT strip "Legacy" when it is not trailing', 'Legacy of Kain: Soul Reaver', 'Legacy of Kain: Soul Reaver'],
    // Near-miss: a 3-digit or 5-digit parenthetical number is not a year and must not be stripped.
    ['does NOT strip a non-4-digit parenthetical number', 'Sim Racing (99)', 'Sim Racing (99)'],

    // Combined: year-strip then edition-strip both apply, in sequence.
    ['strips both a trailing year and an edition suffix together', 'Deus Ex Game of the Year Edition (2000)', 'Deus Ex'],
  ])('%s: %j -> %j', (_label, input, expected) => {
    expect(normalizeGameTitle(input)).toBe(expected);
  });
});

describe('similarity', () => {
  it.each([
    ['identical strings score 1', 'Half-Life 2', 'Half-Life 2', 1],
    ['case-insensitive: differing case still scores 1', 'HALF-LIFE 2', 'half-life 2', 1],
    ['both-empty strings score 1 (equal-by-identity, not a real match)', '', '', 1],
    ['one empty string scores 0', 'Half-Life 2', '', 0],
    ['the other empty string scores 0', '', 'Half-Life 2', 0],
    ['completely disjoint character sets score 0', 'abc', 'xyz', 0],
  ])('%s: similarity(%j, %j) === %j', (_label, a, b, expected) => {
    expect(similarity(a, b)).toBe(expected);
  });

  it('scores a near-miss (same franchise, different entry) below a perfect match', () => {
    const target = 'bioshock';
    const exact = similarity(target, 'bioshock');
    const nearMiss = similarity(target, 'bioshock 2');
    expect(exact).toBe(1);
    expect(nearMiss).toBeLessThan(exact);
    expect(nearMiss).toBeGreaterThan(0);
  });

  it('ranks an unrelated title lower than a near-miss so the real match would win a top-N search', () => {
    const target = 'the witcher 3 wild hunt';
    const nearMiss = similarity(target, 'the witcher 2 assassins of kings');
    const unrelated = similarity(target, 'stardew valley');
    expect(nearMiss).toBeGreaterThan(unrelated);
  });

  it('is symmetric (order of arguments does not change the score)', () => {
    expect(similarity('portal', 'portal 2')).toBe(similarity('portal 2', 'portal'));
  });

  it('computes the documented character-overlap ratio for a known pair', () => {
    // 'ab' vs 'ba': both characters match (order-independent overlap count = 2),
    // ratio = 2*matches / (len(a) + len(b)) = 2*2 / (2+2) = 1.
    expect(similarity('ab', 'ba')).toBe(1);
    // 'ab' vs 'ac': one shared character ('a'), ratio = 2*1 / (2+2) = 0.5.
    expect(similarity('ab', 'ac')).toBe(0.5);
  });
});
