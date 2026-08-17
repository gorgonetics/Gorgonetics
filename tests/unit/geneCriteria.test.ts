import { describe, expect, it } from 'vitest';
import { GeneType } from '$lib/types/index.js';
import {
  type AttributeCriterion,
  attributeMatchCounts,
  classifyAgainstCriteria,
  evaluateAttribute,
  type GeneCriterion,
  type KnownGeneType,
  lociSatisfyCriteria,
  normalizeCriterion,
  stateMatches,
} from '$lib/utils/geneCriteria.js';
import type { PetLoci } from '$lib/utils/petLoci.js';

const loci = (entries: Record<string, GeneType>): PetLoci => new Map(Object.entries(entries));

describe('stateMatches — the 4×4 semantic core (§2/§3)', () => {
  const states = [GeneType.DOMINANT, GeneType.RECESSIVE, GeneType.MIXED, GeneType.UNKNOWN] as const;
  // One row per allow-set shape from §2, expected per pet reading D, R, x, ?.
  const table: [readonly KnownGeneType[], boolean[]][] = [
    [[GeneType.RECESSIVE], [false, true, false, false]], // pure recessive
    [
      [GeneType.RECESSIVE, GeneType.MIXED],
      [false, true, true, false],
    ], // carries R
    [
      [GeneType.DOMINANT, GeneType.MIXED],
      [true, false, true, false],
    ], // expresses D
    [[GeneType.DOMINANT], [true, false, false, false]], // pure dominant
  ];

  it.each(table)('allow=%j', (allow, expected) => {
    states.forEach((state, i) => {
      expect(stateMatches(state, allow), `state=${state}`).toBe(expected[i]);
    });
  });

  it('? never matches, even a set allowing all three real states', () => {
    expect(stateMatches(GeneType.UNKNOWN, [GeneType.DOMINANT, GeneType.RECESSIVE, GeneType.MIXED])).toBe(false);
  });

  it('an absent reading behaves as ?', () => {
    expect(stateMatches(undefined, [GeneType.DOMINANT, GeneType.RECESSIVE, GeneType.MIXED])).toBe(false);
  });

  it('the express/carry distinction: {R,x} matches an x pet, {R} does not', () => {
    expect(stateMatches(GeneType.MIXED, [GeneType.RECESSIVE, GeneType.MIXED])).toBe(true);
    expect(stateMatches(GeneType.MIXED, [GeneType.RECESSIVE])).toBe(false);
  });
});

const attr = (over: Partial<AttributeCriterion> = {}): AttributeCriterion => ({
  kind: 'attribute',
  attribute: 'Toughness',
  want: 'carries',
  loci: [
    { geneId: '01A1', allow: [GeneType.RECESSIVE, GeneType.MIXED] },
    { geneId: '01A2', allow: [GeneType.RECESSIVE, GeneType.MIXED] },
    { geneId: '01A3', allow: [GeneType.DOMINANT, GeneType.MIXED] },
  ],
  min: 2,
  ...over,
});

describe('evaluateAttribute — threshold arithmetic (§10)', () => {
  it('a pet matching exactly min passes; min - 1 fails', () => {
    const c = attr();
    const exactly = loci({ '01A1': GeneType.RECESSIVE, '01A2': GeneType.MIXED, '01A3': GeneType.RECESSIVE });
    expect(evaluateAttribute(c, exactly)).toMatchObject({ matched: 2, satisfied: true });
    const oneShy = loci({ '01A1': GeneType.RECESSIVE, '01A2': GeneType.DOMINANT, '01A3': GeneType.RECESSIVE });
    expect(evaluateAttribute(c, oneShy)).toMatchObject({ matched: 1, satisfied: false });
  });

  it('min = total (the unusable conjunction) still evaluates correctly', () => {
    const c = attr({ min: 3 });
    const perfect = loci({ '01A1': GeneType.RECESSIVE, '01A2': GeneType.MIXED, '01A3': GeneType.DOMINANT });
    expect(evaluateAttribute(c, perfect).satisfied).toBe(true);
    const almost = loci({ '01A1': GeneType.RECESSIVE, '01A2': GeneType.MIXED, '01A3': GeneType.RECESSIVE });
    expect(evaluateAttribute(c, almost).satisfied).toBe(false);
  });

  it('a vacuous min ≤ 0 reads satisfied (non-UI-reachable, kept total — §8)', () => {
    expect(evaluateAttribute(attr({ min: 0 }), loci({})).satisfied).toBe(true);
    expect(evaluateAttribute(attr({ min: 0 }), undefined).satisfied).toBe(true);
  });

  it('unrevealed loci stay in the denominator and never count as matches (§10)', () => {
    const c = attr({ min: 1 });
    const halfStudied = loci({ '01A1': GeneType.RECESSIVE, '01A2': GeneType.UNKNOWN });
    const ev = evaluateAttribute(c, halfStudied);
    // 01A2 reads ?, 01A3 has no row — both are unrevealed, total stays 3.
    expect(ev).toMatchObject({ matched: 1, total: 3, unrevealed: 2, satisfied: true });
  });

  it('a realistic 124-locus expansion evaluates correctly, not a 3-locus toy', () => {
    const big = attr({
      loci: Array.from({ length: 124 }, (_, i) => ({
        geneId: `G${i}`,
        allow: [GeneType.RECESSIVE, GeneType.MIXED] as KnownGeneType[],
      })),
      min: 62,
    });
    const reading: Record<string, GeneType> = {};
    for (let i = 0; i < 124; i++) reading[`G${i}`] = i < 62 ? GeneType.MIXED : GeneType.DOMINANT;
    expect(evaluateAttribute(big, loci(reading))).toMatchObject({ matched: 62, total: 124, satisfied: true });
  });
});

describe('lociSatisfyCriteria — AND across criteria (§4)', () => {
  const criteria: GeneCriterion[] = [
    { kind: 'locus', geneId: '01A1', allow: [GeneType.RECESSIVE] },
    { kind: 'locus', geneId: '01A2', allow: [GeneType.DOMINANT] },
    attr({ loci: [{ geneId: '01A3', allow: [GeneType.RECESSIVE, GeneType.MIXED] }], min: 1 }),
  ];

  it('a pet satisfying 2 of 3 fails; order is irrelevant', () => {
    const twoOfThree = loci({ '01A1': GeneType.RECESSIVE, '01A2': GeneType.DOMINANT, '01A3': GeneType.DOMINANT });
    expect(lociSatisfyCriteria(twoOfThree, criteria)).toBe(false);
    expect(lociSatisfyCriteria(twoOfThree, [...criteria].reverse())).toBe(false);
    const all = loci({ '01A1': GeneType.RECESSIVE, '01A2': GeneType.DOMINANT, '01A3': GeneType.MIXED });
    expect(lociSatisfyCriteria(all, criteria)).toBe(true);
    expect(lociSatisfyCriteria(all, [...criteria].reverse())).toBe(true);
  });

  it('a pet missing from the loci map entirely fails without throwing (§8)', () => {
    expect(lociSatisfyCriteria(undefined, criteria)).toBe(false);
  });
});

describe('classifyAgainstCriteria — exclusion causes (§3/§8)', () => {
  const criteria: GeneCriterion[] = [{ kind: 'locus', geneId: '01A1', allow: [GeneType.RECESSIVE] }];

  it('distinguishes match / not-revealed / no-match / not-imported', () => {
    expect(classifyAgainstCriteria(loci({ '01A1': GeneType.RECESSIVE }), criteria)).toBe('match');
    expect(classifyAgainstCriteria(loci({ '01A1': GeneType.UNKNOWN }), criteria)).toBe('not-revealed');
    expect(classifyAgainstCriteria(loci({}), criteria)).toBe('not-revealed');
    expect(classifyAgainstCriteria(loci({ '01A1': GeneType.DOMINANT }), criteria)).toBe('no-match');
    expect(classifyAgainstCriteria(undefined, criteria)).toBe('not-imported');
  });

  it('attribute criteria use the could-pass-if-studied rule (§3)', () => {
    const c = [attr({ min: 2 })];
    // matched 1, unrevealed 1 → 1 + 1 ≥ 2, re-studying could flip it.
    const couldPass = loci({ '01A1': GeneType.RECESSIVE, '01A2': GeneType.UNKNOWN, '01A3': GeneType.RECESSIVE });
    expect(classifyAgainstCriteria(couldPass, c)).toBe('not-revealed');
    // matched 1, unrevealed 0 → definite non-match even if fully studied.
    const definite = loci({ '01A1': GeneType.RECESSIVE, '01A2': GeneType.DOMINANT, '01A3': GeneType.RECESSIVE });
    expect(classifyAgainstCriteria(definite, c)).toBe('no-match');
  });

  it('a definite fail on any criterion dominates a could-study-out on another', () => {
    const c: GeneCriterion[] = [
      { kind: 'locus', geneId: '01A1', allow: [GeneType.RECESSIVE] }, // will read ?
      { kind: 'locus', geneId: '01A2', allow: [GeneType.RECESSIVE] }, // will definitively fail
    ];
    expect(classifyAgainstCriteria(loci({ '01A1': GeneType.UNKNOWN, '01A2': GeneType.DOMINANT }), c)).toBe('no-match');
  });

  it('verdicts partition the candidates: counts sum to the population (§10)', () => {
    const c = [attr({ min: 2 })];
    const population: (PetLoci | undefined)[] = [
      loci({ '01A1': GeneType.RECESSIVE, '01A2': GeneType.MIXED, '01A3': GeneType.DOMINANT }), // match
      loci({ '01A1': GeneType.RECESSIVE, '01A2': GeneType.UNKNOWN, '01A3': GeneType.RECESSIVE }), // not-revealed
      loci({ '01A1': GeneType.DOMINANT, '01A2': GeneType.DOMINANT, '01A3': GeneType.RECESSIVE }), // no-match
      undefined, // not-imported
    ];
    const tally = { match: 0, 'not-revealed': 0, 'no-match': 0, 'not-imported': 0 };
    for (const p of population) tally[classifyAgainstCriteria(p, c)]++;
    expect(tally).toEqual({ match: 1, 'not-revealed': 1, 'no-match': 1, 'not-imported': 1 });
    expect(Object.values(tally).reduce((a, b) => a + b, 0)).toBe(population.length);
  });
});

describe('attributeMatchCounts — the roster column (§5a)', () => {
  it('reports per-attribute counts and skips locus criteria', () => {
    const criteria: GeneCriterion[] = [{ kind: 'locus', geneId: '01A9', allow: [GeneType.DOMINANT] }, attr({ min: 1 })];
    const counts = attributeMatchCounts(criteria, loci({ '01A1': GeneType.RECESSIVE }));
    expect([...counts.keys()]).toEqual(['Toughness']);
    expect(counts.get('Toughness')).toMatchObject({ matched: 1, total: 3, unrevealed: 2 });
  });
});

describe('normalizeCriterion (§2/§8)', () => {
  it('drops an all-states locus criterion — it is not a filter', () => {
    expect(
      normalizeCriterion({
        kind: 'locus',
        geneId: '01A1',
        allow: [GeneType.DOMINANT, GeneType.RECESSIVE, GeneType.MIXED],
      }),
    ).toBeNull();
  });

  it('keeps an empty allow set — it matches nothing, not everything', () => {
    const c = normalizeCriterion({ kind: 'locus', geneId: '01A1', allow: [] });
    expect(c).not.toBeNull();
    expect(lociSatisfyCriteria(loci({ '01A1': GeneType.DOMINANT }), [c as GeneCriterion])).toBe(false);
  });

  it('clamps attribute min to [1, loci count] and drops empty expansions', () => {
    const clampedLow = normalizeCriterion(attr({ min: 0 })) as AttributeCriterion;
    expect(clampedLow.min).toBe(1);
    const clampedHigh = normalizeCriterion(attr({ min: 99 })) as AttributeCriterion;
    expect(clampedHigh.min).toBe(3);
    expect(normalizeCriterion(attr({ loci: [] }))).toBeNull();
  });
});
