import { describe, expect, it } from 'vitest';
import { GeneType } from '$lib/types/index.js';
import { computeLocusFrequencies, rarityBucket, SOLE_CARRIER_MIN_PETS } from '$lib/utils/geneFrequency.js';
import { groupNeverSeenByChromosome, neverSeenAlleles } from '$lib/utils/neverSeen.js';
import type { PetLoci } from '$lib/utils/petLoci.js';
import type { RarityBucketSource } from '$lib/utils/rarityCSS.js';

const D = GeneType.DOMINANT;
const R = GeneType.RECESSIVE;
const X = GeneType.MIXED;
const Q = GeneType.UNKNOWN;

/** A lookup over real tallies, so the gate in `rarityBucket` is exercised too. */
function lookupOver(pets: Record<string, GeneType>[]): RarityBucketSource {
  const tallies = computeLocusFrequencies(pets.map((p) => new Map(Object.entries(p)) as PetLoci));
  return {
    bucketOf: (geneId, allele) => {
      const tally = tallies.get(geneId);
      return tally ? rarityBucket(tally, allele) : null;
    },
  };
}

const herd = (n: number, loci: Record<string, GeneType>) => Array.from({ length: n }, () => ({ ...loci }));

describe('neverSeenAlleles', () => {
  it('names the allele no pet carries, and only that one', () => {
    const lookup = lookupOver(herd(SOLE_CARRIER_MIN_PETS, { '01A1': D, '01A2': R }));
    const out = neverSeenAlleles(['01A1', '01A2'], lookup);
    expect(out.get('01A1')).toBe(R);
    expect(out.get('01A2')).toBe(D);
  });

  it('skips a locus where both alleles are carried', () => {
    const pets = [...herd(SOLE_CARRIER_MIN_PETS - 1, { '01A1': D }), { '01A1': X }];
    expect(neverSeenAlleles(['01A1'], lookupOver(pets)).size).toBe(0);
  });

  it('skips a locus that is `?` on every pet — unrevealed is not absent', () => {
    const lookup = lookupOver(herd(SOLE_CARRIER_MIN_PETS, { '01A1': Q }));
    expect(neverSeenAlleles(['01A1'], lookup).size).toBe(0);
  });

  it('applies the same population gate as the rarity map', () => {
    const lookup = lookupOver(herd(SOLE_CARRIER_MIN_PETS - 1, { '01A1': D }));
    expect(neverSeenAlleles(['01A1'], lookup).size).toBe(0);
  });

  it('looks only at the gene ids it is given', () => {
    const lookup = lookupOver(herd(SOLE_CARRIER_MIN_PETS, { '01A1': D, '01A2': D }));
    expect([...neverSeenAlleles(['01A2'], lookup).keys()]).toEqual(['01A2']);
  });
});

describe('groupNeverSeenByChromosome', () => {
  it('lists one line per chromosome in genome order, block letters before AA', () => {
    const alleles = new Map([
      ['10A1', R],
      ['02AA1', D],
      ['02B2', R],
      ['02B10', D],
      ['02B1', D],
    ] as const);
    expect(groupNeverSeenByChromosome(alleles)).toEqual([
      {
        chromosome: '02',
        alleles: [
          { geneId: '02B1', slot: 'B1', allele: D },
          { geneId: '02B2', slot: 'B2', allele: R },
          { geneId: '02B10', slot: 'B10', allele: D },
          { geneId: '02AA1', slot: 'AA1', allele: D },
        ],
      },
      { chromosome: '10', alleles: [{ geneId: '10A1', slot: 'A1', allele: R }] },
    ]);
  });

  it('drops ids that do not parse and returns nothing for no alleles', () => {
    expect(groupNeverSeenByChromosome(new Map([['bogus', R]]))).toEqual([]);
    expect(groupNeverSeenByChromosome(new Map())).toEqual([]);
  });
});
