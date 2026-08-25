import { describe, expect, it } from 'vitest';
import { GeneType } from '$lib/types/index.js';
import {
  type AlleleTally,
  benefitCounts,
  benefitSlots,
  capability,
  capabilityShare,
  carries,
  expectedCapabilityGain,
  type GeneticQualityResult,
  hasMeaningfulPopulation,
  liabilityCounts,
  MIN_POPULATION,
  type ScoredGene,
  safeCullOrder,
  scoreGroup,
  scorePet,
  supplyTier,
  TIER_CAPABILITY,
  tallyAlleles,
  transmissionProbability,
} from '$lib/utils/geneticQuality.js';
import type { PetLoci } from '$lib/utils/petLoci.js';

const D = GeneType.DOMINANT;
const R = GeneType.RECESSIVE;
const X = GeneType.MIXED;
const Q = GeneType.UNKNOWN;

function gene(
  dominantSign: '+' | '-' | null,
  recessiveSign: '+' | '-' | null,
  dominantAttribute: string | null = 'virility',
  recessiveAttribute: string | null = 'temperament',
): ScoredGene {
  return { dominantSign, recessiveSign, dominantAttribute, recessiveAttribute, breed: '' };
}

/**
 * `01A1` — `Virility− / Temperament+`. All of chromosome 01 has this shape
 * and it is the only double-benefit class in the horse gene set, so it
 * earns a named fixture.
 */
const CHR01 = gene('-', '+', 'virility', 'temperament');

function pop(types: GeneType[], geneId = '01A1'): PetLoci[] {
  return types.map((t) => new Map([[geneId, t]]) as PetLoci);
}

function tally(homD: number, carD: number, homR: number, carR: number): AlleleTally {
  return { homD, carD, homR, carR };
}

describe('capability — the 2:1 weighting model', () => {
  it('is 1 when the outcome breeds true, 0.5 for carriers only, 0 out of reach', () => {
    expect(capability(1, 3)).toBe(1);
    expect(capability(0, 2)).toBe(0.5);
    expect(capability(0, 0)).toBe(0);
  });

  it('makes a locked allele worth exactly twice a carried one', () => {
    // The entire weighting model, and why no LOCK_BONUS constant exists.
    expect(capability(1, 1) / capability(0, 1)).toBe(2);
  });

  it('agrees with the tier labels it is displayed as', () => {
    expect(TIER_CAPABILITY.sole).toBe(capability(0, 0));
    expect(TIER_CAPABILITY.partial).toBe(capability(0, 1));
    expect(TIER_CAPABILITY.secured).toBe(capability(1, 1));
  });
});

describe('benefitSlots — what each allele can deliver', () => {
  it('gives chromosome 01 two recessive slots and no dominant slot', () => {
    expect(benefitSlots(CHR01)).toEqual([
      { allele: R, kind: 'add', attribute: 'temperament' },
      { allele: R, kind: 'clear', attribute: 'virility' },
    ]);
    expect(benefitCounts(CHR01)).toEqual({ dom: 0, rec: 2 });
  });

  it('files a `clear` against the attribute of the negative being avoided', () => {
    // The recessive allele escapes Virility−, so the benefit is virility's —
    // NOT temperament's, which is what the recessive allele itself expresses.
    expect(benefitSlots(CHR01).find((s) => s.kind === 'clear')?.attribute).toBe('virility');
  });

  it('covers the remaining locus classes', () => {
    expect(benefitCounts(gene('+', null))).toEqual({ dom: 1, rec: 0 });
    expect(benefitCounts(gene(null, '+'))).toEqual({ dom: 0, rec: 1 });
    expect(benefitCounts(gene(null, '-'))).toEqual({ dom: 1, rec: 0 });
    expect(benefitCounts(gene('-', null))).toEqual({ dom: 0, rec: 1 });
    expect(benefitCounts(gene(null, null))).toEqual({ dom: 0, rec: 0 });
    expect(benefitCounts(gene('+', '+'))).toEqual({ dom: 1, rec: 1 });
  });

  it('counts liabilities on the allele that transmits them', () => {
    expect(liabilityCounts(CHR01)).toEqual({ dom: 1, rec: 0 });
    expect(liabilityCounts(gene(null, '-'))).toEqual({ dom: 0, rec: 1 });
    expect(liabilityCounts(gene('+', '+'))).toEqual({ dom: 0, rec: 0 });
  });
});

describe('transmission', () => {
  it('is certain for the matching homozygote, half for mixed, zero otherwise', () => {
    expect(transmissionProbability(D, D)).toBe(1);
    expect(transmissionProbability(X, D)).toBe(0.5);
    expect(transmissionProbability(R, D)).toBe(0);
    expect(transmissionProbability(Q, D)).toBe(0);
  });

  it('reports carriage, where `x` carries both', () => {
    expect(carries(X, D)).toBe(true);
    expect(carries(X, R)).toBe(true);
    expect(carries(D, R)).toBe(false);
    expect(carries(Q, D)).toBe(false);
  });
});

describe('tallyAlleles', () => {
  it('counts a homozygote as both homozygous and carrying', () => {
    expect(tallyAlleles(pop([D, R, X])).get('01A1')).toEqual({ homD: 1, carD: 2, homR: 1, carR: 2 });
  });

  it('excludes `?` entirely — it is unrevealed, not absent', () => {
    expect(tallyAlleles(pop([D, Q, Q])).get('01A1')).toEqual({ homD: 1, carD: 1, homR: 0, carR: 0 });
  });
});

describe('supplyTier — leave-one-out', () => {
  it('never lets an animal tier its own allele as covered', () => {
    expect(supplyTier(tally(0, 1, 0, 0), D, X)).toBe('sole');
    expect(supplyTier(tally(1, 1, 0, 0), D, D)).toBe('sole');
  });

  it('reads `partial` when others carry but none breeds true', () => {
    expect(supplyTier(tally(0, 3, 0, 0), D, X)).toBe('partial');
    // The only homozygote IS this animal → not secured elsewhere.
    expect(supplyTier(tally(1, 3, 0, 0), D, D)).toBe('partial');
  });

  it('reads `secured` only when another animal is homozygous', () => {
    expect(supplyTier(tally(1, 3, 0, 0), D, X)).toBe('secured');
  });

  it('clamps rather than going negative on an inconsistent tally', () => {
    expect(supplyTier(tally(0, 0, 0, 0), D, X)).toBe('sole');
  });
});

describe('scorePet — the chromosome-01 table', () => {
  const genes = { '01A1': CHR01 };

  /** Score `own` against a herd of three `D` animals — recessive unsupplied. */
  function againstDominantHerd(own: GeneType) {
    const loci = pop([own])[0];
    return scorePet(loci, genes, tallyAlleles([loci, ...pop([D, D, D])]));
  }

  it('scores a dominant homozygote zero — it can never clear the negative', () => {
    // `D` passes the dominant allele always, so every offspring expresses
    // Virility− and Temperament+ is unreachable.
    const r = againstDominantHerd(D);
    expect(r.atRiskCapability).toBe(0);
    expect(r.soleSourceSlots).toBe(0);
  });

  it('credits a mixed animal as the sole source of both benefits', () => {
    const r = againstDominantHerd(X);
    // Carrier where nobody else carries: capability 0 → 0.5, twice over.
    expect(r.atRiskCapability).toBeCloseTo(2 * 0.5, 10);
    expect(r.soleSourceSlots).toBe(2);
  });

  it('credits a recessive homozygote double — it breeds the pair true', () => {
    const r = againstDominantHerd(R);
    expect(r.atRiskCapability).toBeCloseTo(2 * 1, 10);
    expect(r.atRiskCapability).toBe(2 * againstDominantHerd(X).atRiskCapability);
  });

  it('splits the double benefit across both attributes', () => {
    const r = againstDominantHerd(R);
    expect(Object.keys(r.byAttribute).sort()).toEqual(['temperament', 'virility']);
    expect(r.byAttribute.virility).toBeCloseTo(r.byAttribute.temperament, 10);
    expect(r.byAttribute.virility + r.byAttribute.temperament).toBeCloseTo(r.atRiskCapability, 10);
  });

  it('reports a dominant-negative carrier as liability that leaves with it', () => {
    // Sole carrier of the `D` allele, which at 01A1 is purely a liability.
    const loci = pop([X])[0];
    const r = scorePet(loci, genes, tallyAlleles([loci, ...pop([R, R, R])]));
    expect(r.liabilityAtRisk).toBeCloseTo(0.5, 10);
    // Never folded into the headline.
    expect(r.atRiskCapability).toBe(0);
  });
});

describe('scorePet — irreplaceability, not abundance', () => {
  const genes = { '01A1': CHR01 };

  it('scores zero when everything it supplies is available elsewhere', () => {
    // Four `R` animals: each is redundant, so nothing is lost by any one going.
    const herd = pop([R, R, R, R]);
    const tallies = tallyAlleles(herd);
    expect(scorePet(herd[0], genes, tallies).atRiskCapability).toBe(0);
  });

  it('credits the sole animal that can breed a shared allele true', () => {
    // Three carriers plus one homozygote: only the homozygote breeds it true.
    const herd = pop([R, X, X, X]);
    const tallies = tallyAlleles(herd);
    const homozygote = scorePet(herd[0], genes, tallies);
    const carrier = scorePet(herd[1], genes, tallies);
    expect(homozygote.atRiskCapability).toBeCloseTo(2 * 0.5, 10);
    expect(homozygote.soleLockSlots).toBe(2);
    expect(carrier.atRiskCapability).toBe(0);
  });
});

describe('scorePet — scoping and exclusions', () => {
  const genes = { '01A1': CHR01, '02B1': gene('+', null) };

  it('ignores `?` loci', () => {
    const loci = new Map([['01A1', Q]]) as PetLoci;
    expect(scorePet(loci, genes, tallyAlleles([loci])).atRiskCapability).toBe(0);
  });

  it('ignores unsigned loci and genes with no record', () => {
    const loci = new Map([
      ['03C1', R],
      ['99Z9', R],
    ]) as PetLoci;
    const all = { ...genes, '03C1': gene(null, null) };
    expect(scorePet(loci, all, tallyAlleles([loci])).atRiskCapability).toBe(0);
  });

  it('honours a breed scope predicate', () => {
    const loci = new Map([
      ['01A1', R],
      ['02B1', D],
    ]) as PetLoci;
    const tallies = tallyAlleles([loci]);
    const unscoped = scorePet(loci, genes, tallies).atRiskCapability;
    const scoped = scorePet(loci, genes, tallies, {
      scopeToBreed: (g) => g.dominantSign !== '+',
    }).atRiskCapability;
    expect(scoped).toBeLessThan(unscoped);
  });
});

describe('the marginal measure is what finds an outcrossed carrier', () => {
  // Regression for the failure recorded in the design doc §3: an absolute
  // benefit score ranks a heterozygous outcrosser BELOW a homozygous inbred
  // core, because it credits a locked allele the same whether the herd
  // already has it locked or not.
  //
  // Ten homozygous siblings, good allele locked at loci 1–20. One
  // outcrosser is merely `x` there, but is the only animal carrying the
  // good allele at loci 21–30, where the siblings are all `D` (worthless).
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
    for (let i = 1; i <= 30; i++) m.set(`01A${i}`, X);
    return m as PetLoci;
  };

  const herd = [...Array.from({ length: 10 }, sibling), outcrosser()];
  const tallies = tallyAlleles(herd);

  it('ranks the outcrosser above the inbred core', () => {
    const out = scorePet(outcrosser(), genes, tallies);
    const sib = scorePet(sibling(), genes, tallies);
    expect(out.atRiskCapability).toBeGreaterThan(sib.atRiskCapability);
  });

  it('scores the redundant siblings at exactly zero — the cull list', () => {
    // Ten identical animals: none of them is irreplaceable.
    expect(scorePet(sibling(), genes, tallies).atRiskCapability).toBe(0);
  });

  it('credits the outcrosser only where the herd actually lacks the allele', () => {
    // Loci 21–30 only: 10 loci × 2 benefit slots × 0.5 (sole carrier).
    const out = scorePet(outcrosser(), genes, tallies);
    expect(out.soleSourceSlots).toBe(20);
    expect(out.atRiskCapability).toBeCloseTo(20 * 0.5, 10);
  });

  it('gives the outcrosser the whole share of irreplaceable capability', () => {
    const scored: [number, GeneticQualityResult][] = herd.map((loci, i) => [i, scorePet(loci, genes, tallies)]);
    const share = capabilityShare(scored);
    expect(share.get(10)).toBeCloseTo(100, 10);
    expect(share.get(0)).toBe(0);
  });

  it('reports zero share for every animal when nothing is irreplaceable', () => {
    const redundant = pop([R, R, R]);
    const t = tallyAlleles(redundant);
    const scored: [number, GeneticQualityResult][] = redundant.map((l, i) => [i, scorePet(l, genes, t)]);
    expect([...capabilityShare(scored).values()]).toEqual([0, 0, 0]);
  });

  it('keeps a population floor for the degenerate single-animal case', () => {
    expect(MIN_POPULATION).toBeGreaterThan(1);
  });
});

describe('expectedCapabilityGain — the breeding side', () => {
  const dist = (D_: number, x: number, R_: number) => ({ D: D_, x, R: R_, unknown: 0 });

  it('credits nothing when the herd already breeds the outcome true', () => {
    // The inert-`missing`-tier problem in reverse: no double-counting of
    // what the stable can already do reliably.
    expect(expectedCapabilityGain(dist(0, 0, 1), CHR01, tally(0, 4, 2, 4))).toBe(0);
  });

  it('credits a foal that locks in an allele the herd only carries', () => {
    // base 0.5 → foal homozygous gives 1. Two slots at 01A1.
    expect(expectedCapabilityGain(dist(0, 0, 1), CHR01, tally(0, 4, 0, 4))).toBeCloseTo(2 * 0.5, 10);
  });

  it('credits a foal that reaches an allele nothing in the herd carries', () => {
    // base 0 → homozygous foal gives 1, heterozygous gives 0.5.
    expect(expectedCapabilityGain(dist(0.25, 0.5, 0.25), CHR01, tally(4, 4, 0, 0))).toBeCloseTo(
      2 * (0.25 * 1 + 0.5 * 0.5),
      10,
    );
  });

  it('never credits the allele that carries no benefit', () => {
    // At 01A1 the dominant allele has no benefit slot, so dominant mass
    // cannot earn anything however the herd looks.
    expect(expectedCapabilityGain(dist(1, 0, 0), CHR01, tally(0, 0, 0, 0))).toBe(0);
  });

  it('is monotone in the probability of the useful genotype', () => {
    const t = tally(4, 4, 0, 0);
    const low = expectedCapabilityGain(dist(0.5, 0.5, 0), CHR01, t);
    const mid = expectedCapabilityGain(dist(0.25, 0.5, 0.25), CHR01, t);
    const high = expectedCapabilityGain(dist(0, 0, 1), CHR01, t);
    expect(low).toBeLessThan(mid);
    expect(mid).toBeLessThan(high);
  });
});

describe('scoreGroup', () => {
  const genes = { '01A1': CHR01 };

  it('scores every animal against the group it was given', () => {
    const herd = pop([R, D, D]);
    const byPet = new Map(herd.map((l, i) => [i, l]));
    const scored = scoreGroup(byPet, genes, [0, 1, 2]);
    // The lone R is the sole source of both benefits at 01A1.
    expect(scored.get(0)?.atRiskCapability).toBeCloseTo(2, 10);
    expect(scored.get(1)?.atRiskCapability).toBe(0);
  });

  it('re-bases the tally when the group shrinks', () => {
    // Two R animals are mutually redundant; alone, one is irreplaceable.
    const herd = pop([R, R, D]);
    const byPet = new Map(herd.map((l, i) => [i, l]));
    expect(scoreGroup(byPet, genes, [0, 1, 2]).get(0)?.atRiskCapability).toBe(0);
    expect(scoreGroup(byPet, genes, [0, 2]).get(0)?.atRiskCapability).toBeCloseTo(2, 10);
  });

  it('scores an animal with no projected loci as empty rather than omitting it', () => {
    const scored = scoreGroup(new Map(), genes, [7]);
    expect(scored.get(7)).toEqual({
      atRiskCapability: 0,
      soleSourceSlots: 0,
      soleLockSlots: 0,
      liabilityAtRisk: 0,
      byAttribute: {},
    });
  });
});

describe('safeCullOrder — the non-additivity fix', () => {
  const genes = { '01A1': CHR01 };

  /** Seven animals: two mutual carriers of the good allele, five without. */
  function pairedRedundancy() {
    const herd = pop([X, X, D, D, D, D, D]);
    return { byPet: new Map(herd.map((l, i) => [i, l])), ids: [0, 1, 2, 3, 4, 5, 6] };
  }

  it('never releases both members of a mutually-redundant pair', () => {
    const { byPet, ids } = pairedRedundancy();
    // Individually every animal scores zero — the trap a sorted column sets.
    const scored = scoreGroup(byPet, genes, ids);
    expect([...scored.values()].every((r) => r.atRiskCapability === 0)).toBe(true);

    const released = safeCullOrder(byPet, genes, ids).releasable.map((s) => s.id);
    // At most one of the two carriers (ids 0, 1) may go.
    expect(released.filter((id) => id === 0 || id === 1)).toHaveLength(1);
  });

  it('leaves the herd able to reach everything it could before', () => {
    const { byPet, ids } = pairedRedundancy();
    const released = new Set(safeCullOrder(byPet, genes, ids).releasable.map((s) => s.id));
    const survivors = ids.filter((id) => !released.has(id));
    // Some survivor still carries the recessive good allele.
    expect(survivors.some((id) => byPet.get(id)?.get('01A1') === X)).toBe(true);
  });

  it('stops at the population floor rather than emptying the stable', () => {
    const { byPet, ids } = pairedRedundancy();
    const { releasable } = safeCullOrder(byPet, genes, ids);
    expect(ids.length - releasable.length).toBe(MIN_POPULATION);
  });

  it('reports what the next release would cost when nothing is free', () => {
    // Four animals, each the only carrier at a different locus: no free move.
    const g: Record<string, ScoredGene> = {};
    for (let i = 1; i <= 4; i++) g[`01A${i}`] = CHR01;
    const byPet = new Map<number, PetLoci>();
    for (let i = 0; i < 4; i++) {
      const m = new Map<string, GeneType>();
      for (let j = 1; j <= 4; j++) m.set(`01A${j}`, j === i + 1 ? X : D);
      byPet.set(i, m as PetLoci);
    }
    const result = safeCullOrder(byPet, g, [0, 1, 2, 3]);
    expect(result.releasable).toEqual([]);
    expect(result.nextCost).toBeCloseTo(2 * 0.5, 10);
  });

  it('prefers releasing the animal that also clears the most liability', () => {
    // Five `R` animals plus one `x`. Everything the `x` supplies in benefit
    // terms is secured by the others, but it is the *only* carrier of the
    // dominant allele — pure liability at 01A1 — so releasing it is both
    // free and actively useful.
    const herd = pop([R, R, R, R, R, X]);
    const byPet = new Map(herd.map((l, i) => [i, l]));
    const first = safeCullOrder(byPet, genes, [0, 1, 2, 3, 4, 5]).releasable[0];
    expect(first.id).toBe(5);
    expect(first.liabilityRemoved).toBeCloseTo(0.5, 10);
    expect(first.cost).toBe(0);
  });

  it('counts no liability as removed when others still carry it', () => {
    // Four `D` animals: releasing one leaves the negative allele behind, so
    // nothing is cleared. `liabilityAtRisk` means "leaves with it", not
    // "this animal has it".
    const herd = pop([R, D, D, D, D]);
    const byPet = new Map(herd.map((l, i) => [i, l]));
    const scored = scoreGroup(byPet, genes, [0, 1, 2, 3, 4]);
    expect(scored.get(1)?.liabilityAtRisk).toBe(0);
  });
});

describe('hasMeaningfulPopulation', () => {
  it('gates on the floor, where almost everything tiers sole', () => {
    expect(hasMeaningfulPopulation(MIN_POPULATION)).toBe(true);
    expect(hasMeaningfulPopulation(MIN_POPULATION - 1)).toBe(false);
  });
});
