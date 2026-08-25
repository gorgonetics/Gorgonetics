import { describe, expect, it } from 'vitest';
import { GeneType } from '$lib/types/index.js';
import {
  type AlleleTally,
  benefitCounts,
  benefitSlots,
  LOCK_BONUS,
  MIN_POPULATION,
  type ScoredGene,
  scorePet,
  supplyTier,
  TIER_WEIGHT,
  tallyAlleles,
  transmissionProbability,
  transmissionWeight,
} from '$lib/utils/geneticQuality.js';
import type { PetLoci } from '$lib/utils/petLoci.js';

const D = GeneType.DOMINANT;
const R = GeneType.RECESSIVE;
const X = GeneType.MIXED;
const Q = GeneType.UNKNOWN;

/** A gene record with only the fields this module reads. */
function gene(
  dominantSign: '+' | '-' | null,
  recessiveSign: '+' | '-' | null,
  dominantAttribute: string | null = 'virility',
  recessiveAttribute: string | null = 'temperament',
): ScoredGene {
  return { dominantSign, recessiveSign, dominantAttribute, recessiveAttribute, breed: '' };
}

/**
 * `01A1` — `Virility− / Temperament+`. The whole of chromosome 01 has this
 * shape and it is the only double-benefit class in the horse gene set, so
 * it earns a named fixture.
 */
const CHR01 = gene('-', '+', 'virility', 'temperament');

function pop(types: GeneType[], geneId = '01A1'): PetLoci[] {
  return types.map((t) => new Map([[geneId, t]]) as PetLoci);
}

function tally(homD: number, carD: number, homR: number, carR: number): AlleleTally {
  return { homD, carD, homR, carR };
}

describe('benefitSlots — what each allele can deliver', () => {
  it('gives chromosome 01 two recessive slots and no dominant slot', () => {
    const slots = benefitSlots(CHR01);
    expect(slots).toEqual([
      { allele: R, kind: 'add', attribute: 'temperament' },
      { allele: R, kind: 'clear', attribute: 'virility' },
    ]);
    expect(benefitCounts(CHR01)).toEqual({ dom: 0, rec: 2 });
  });

  it('files a `clear` against the attribute of the negative being avoided', () => {
    // The recessive allele escapes Virility−, so the benefit is virility's —
    // NOT temperament's, which is what the recessive allele itself expresses.
    const clear = benefitSlots(CHR01).find((s) => s.kind === 'clear');
    expect(clear?.attribute).toBe('virility');
  });

  it('covers the remaining five locus classes', () => {
    expect(benefitCounts(gene('+', null))).toEqual({ dom: 1, rec: 0 });
    expect(benefitCounts(gene(null, '+'))).toEqual({ dom: 0, rec: 1 });
    expect(benefitCounts(gene(null, '-'))).toEqual({ dom: 1, rec: 0 });
    expect(benefitCounts(gene('-', null))).toEqual({ dom: 0, rec: 1 });
    expect(benefitCounts(gene(null, null))).toEqual({ dom: 0, rec: 0 });
  });

  it('treats a both-positive locus as one slot per allele, not a double', () => {
    expect(benefitCounts(gene('+', '+'))).toEqual({ dom: 1, rec: 1 });
  });
});

describe('transmission weight', () => {
  it('is certain for the matching homozygote, half for mixed, zero otherwise', () => {
    expect(transmissionProbability(D, D)).toBe(1);
    expect(transmissionProbability(X, D)).toBe(0.5);
    expect(transmissionProbability(R, D)).toBe(0);
    expect(transmissionProbability(R, R)).toBe(1);
    expect(transmissionProbability(X, R)).toBe(0.5);
    expect(transmissionProbability(D, R)).toBe(0);
  });

  it('passes nothing knowable for `?`', () => {
    expect(transmissionProbability(Q, D)).toBe(0);
    expect(transmissionProbability(Q, R)).toBe(0);
  });

  it('is superlinear at certainty — a homozygote beats two coin flips', () => {
    expect(transmissionWeight(D, D)).toBeGreaterThan(2 * transmissionWeight(X, D));
    expect(transmissionWeight(D, D)).toBe(1 + LOCK_BONUS);
  });
});

describe('tallyAlleles', () => {
  it('counts a homozygote as both homozygous and carrying', () => {
    expect(tallyAlleles(pop([D, R, X])).get('01A1')).toEqual({ homD: 1, carD: 2, homR: 1, carR: 2 });
  });

  it('excludes `?` entirely — it is unrevealed, not absent', () => {
    // Skill-gated visibility is uniform across a collection, so a locus
    // nobody can read must not look like one nobody carries.
    expect(tallyAlleles(pop([D, Q, Q])).get('01A1')).toEqual({ homD: 1, carD: 1, homR: 0, carR: 0 });
  });
});

describe('supplyTier — leave-one-out', () => {
  it('never lets a pet tier its own allele as covered', () => {
    // Sole carrier in a population of one carrier: after removing itself,
    // nothing else supplies the allele.
    expect(supplyTier(tally(0, 1, 0, 0), D, X)).toBe('sole');
    expect(supplyTier(tally(1, 1, 0, 0), D, D)).toBe('sole');
  });

  it('reads `partial` when others carry but none breeds true', () => {
    expect(supplyTier(tally(0, 3, 0, 0), D, X)).toBe('partial');
  });

  it('reads `secured` only when another pet is homozygous', () => {
    expect(supplyTier(tally(1, 3, 0, 0), D, X)).toBe('secured');
    // The only homozygote IS this pet → not secured elsewhere.
    expect(supplyTier(tally(1, 3, 0, 0), D, D)).toBe('partial');
  });

  it('clamps rather than going negative on an inconsistent tally', () => {
    expect(supplyTier(tally(0, 0, 0, 0), D, X)).toBe('sole');
  });
});

describe('scorePet — the chromosome-01 table', () => {
  const genes = { '01A1': CHR01 };
  // A population where every other pet is `D`, so the recessive allele is
  // unsupplied elsewhere and both recessive slots tier `sole`.
  const others = [D, D, D];

  function scoreOf(own: GeneType) {
    const loci = pop([own])[0];
    const tallies = tallyAlleles([loci, ...pop(others)]);
    return scorePet(loci, genes, tallies);
  }

  it('scores a dominant homozygote zero — it can never clear the negative', () => {
    // `D` passes the dominant allele always, so every offspring expresses
    // Virility− and Temperament+ is unreachable. Zero, not negative.
    expect(scoreOf(D).score).toBe(0);
    expect(scoreOf(D).soleSourceSlots).toBe(0);
  });

  it('scores a mixed gene on both counts', () => {
    const r = scoreOf(X);
    expect(r.score).toBeCloseTo(2 * 0.5 * TIER_WEIGHT.sole, 10);
    expect(r.carriedSlots).toBe(2);
    expect(r.lockedSlots).toBe(0);
  });

  it('gives a recessive homozygote the locked double benefit', () => {
    const r = scoreOf(R);
    expect(r.score).toBeCloseTo(2 * (1 + LOCK_BONUS) * TIER_WEIGHT.sole, 10);
    expect(r.lockedSlots).toBe(2);
    expect(r.score).toBeGreaterThan(scoreOf(X).score);
  });

  it('splits the double benefit across both attributes', () => {
    const r = scoreOf(R);
    expect(Object.keys(r.byAttribute).sort()).toEqual(['temperament', 'virility']);
    expect(r.byAttribute.virility).toBeCloseTo(r.byAttribute.temperament, 10);
    expect(r.byAttribute.virility + r.byAttribute.temperament).toBeCloseTo(r.score, 10);
  });
});

describe('scorePet — scoping and exclusions', () => {
  const genes = { '01A1': CHR01, '02B1': gene('+', null) };

  it('ignores `?` loci', () => {
    const loci = new Map([['01A1', Q]]) as PetLoci;
    expect(scorePet(loci, genes, tallyAlleles([loci])).score).toBe(0);
  });

  it('ignores unsigned loci and genes with no record', () => {
    const loci = new Map([
      ['03C1', R],
      ['99Z9', R],
    ]) as PetLoci;
    const all = { ...genes, '03C1': gene(null, null) };
    expect(scorePet(loci, all, tallyAlleles([loci])).score).toBe(0);
  });

  it('honours a breed scope predicate', () => {
    const loci = new Map([
      ['01A1', R],
      ['02B1', D],
    ]) as PetLoci;
    const tallies = tallyAlleles([loci]);
    const unscoped = scorePet(loci, genes, tallies).score;
    const scoped = scorePet(loci, genes, tallies, { scopeToBreed: (g) => g.dominantSign !== '+' }).score;
    expect(scoped).toBeLessThan(unscoped);
  });
});

describe('the marginal term is what finds an outcrossed carrier', () => {
  // This is the regression test for the failure recorded in the design doc:
  // the per-gene rule alone ranks a heterozygous outcrosser BELOW a
  // homozygous inbred core, because it credits a locked allele the same
  // whether the herd already has it locked or not.
  //
  // Ten sibling pets, homozygous-recessive (the good allele) at loci 1–20.
  // One outcrosser is merely `x` at those, but is the sole carrier of the
  // good allele at loci 21–30, where the siblings are all `D` (worth zero).
  const CORE = 10;
  const genes: Record<string, ScoredGene> = {};
  for (let i = 1; i <= 30; i++) genes[`01A${i}`] = CHR01;

  const sibling = (): PetLoci => {
    const m = new Map<string, GeneType>();
    for (let i = 1; i <= 20; i++) m.set(`01A${i}`, R);
    for (let i = 21; i <= 30; i++) m.set(`01A${i}`, D);
    return m as PetLoci;
  };
  const outcrosser = (): PetLoci => {
    const m = new Map<string, GeneType>();
    for (let i = 1; i <= 20; i++) m.set(`01A${i}`, X);
    for (let i = 21; i <= 30; i++) m.set(`01A${i}`, X);
    return m as PetLoci;
  };

  const herd = [...Array.from({ length: CORE }, sibling), outcrosser()];
  const tallies = tallyAlleles(herd);
  const score = (loci: PetLoci, opts = {}) => scorePet(loci, genes, tallies, opts).score;

  it('ranks the outcrosser above the inbred core', () => {
    expect(score(outcrosser())).toBeGreaterThan(score(sibling()));
  });

  it('inverts without the marginal term — the bug this guards', () => {
    const flat = { tierWeight: { sole: 1, partial: 1, secured: 1 } } as const;
    expect(score(outcrosser(), flat)).toBeLessThan(score(sibling(), flat));
  });

  it('holds across the whole lock-bonus range', () => {
    // The calibrated tiers were chosen for exactly this: a lock bonus that
    // could flip the ranking would be untunable later.
    for (const lockBonus of [0, 0.25, 0.5, 1]) {
      expect(score(outcrosser(), { lockBonus })).toBeGreaterThan(score(sibling(), { lockBonus }));
    }
  });

  it('credits the outcrosser as the sole source at the loci the herd lacks', () => {
    expect(scorePet(outcrosser(), genes, tallies).soleSourceSlots).toBe(20);
    expect(scorePet(sibling(), genes, tallies).soleSourceSlots).toBe(0);
  });

  it('keeps a population floor for the degenerate single-pet case', () => {
    expect(MIN_POPULATION).toBeGreaterThan(1);
  });
});
