import { describe, expect, it } from 'vitest';
import { GeneType } from '$lib/types/index.js';
import { computeLocusFrequencies, rarityBucket } from '$lib/utils/geneFrequency.js';
import type { PetLoci } from '$lib/utils/petLoci.js';

const TYPES = [GeneType.DOMINANT, GeneType.RECESSIVE, GeneType.MIXED, GeneType.UNKNOWN];
const LOCI = 1576; // a real horse genome

function makePopulation(pets: number): PetLoci[] {
  let seed = 99;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  return Array.from({ length: pets }, () => {
    const m = new Map<string, GeneType>();
    for (let i = 0; i < LOCI; i++) {
      m.set(`${String(Math.floor(i / 42) + 1).padStart(2, '0')}X${i}`, TYPES[Math.floor(rand() * 4)]);
    }
    return m as PetLoci;
  });
}

describe('rarity baseline cost', () => {
  for (const pets of [37, 200, 500]) {
    it(`tallies ${pets} pets × ${LOCI} loci well inside a frame budget`, () => {
      const pop = makePopulation(pets);
      const t0 = performance.now();
      const loci = computeLocusFrequencies(pop);
      const tallied = performance.now() - t0;

      // Then the per-cell pass the stylesheet builder does: both arms, every locus.
      const t1 = performance.now();
      let seen = 0;
      for (const [geneId, tally] of loci) {
        void geneId;
        if (rarityBucket(tally, GeneType.DOMINANT) !== null) seen++;
        if (rarityBucket(tally, GeneType.RECESSIVE) !== null) seen++;
      }
      const bucketed = performance.now() - t1;

      console.log(
        `  ${pets} pets: tally ${tallied.toFixed(1)}ms, bucket ${bucketed.toFixed(1)}ms, ` +
          `${loci.size} loci, ${seen} rendered halves`,
      );
      expect(loci.size).toBe(LOCI);
      // Generous ceiling: this is a regression guard against accidental
      // O(pets × loci²) work, not a benchmark. A frame is 16ms; the real
      // numbers are far below this.
      expect(tallied + bucketed).toBeLessThan(400);
    });
  }
});
