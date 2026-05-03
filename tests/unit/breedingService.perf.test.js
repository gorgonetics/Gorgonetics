import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { rankBreedingPairs } from '$lib/services/breedingService.js';
import { closeDatabase, initDatabase } from '$lib/services/database.js';
import * as geneService from '$lib/services/geneService.js';
import { parseGenome } from '$lib/services/genomeParser.js';
import { runMigrations } from '$lib/services/migrationService.js';
import * as petService from '$lib/services/petService.js';
import { Gender } from '$lib/types/index.js';
import { toGeneId } from '$lib/utils/geneAnalysis.js';

/**
 * Worst-case Gorgonetics scale, sized against the real game data:
 * 15 stabled males × 15 stabled females × ~1500 horse loci. Genome
 * structure (48 chromosomes, 4-char blocks, variable per-chromosome
 * length) is taken straight from `data/Genes_SampleHorse.txt` so the
 * loop walks loci in the same shape the production parser produces.
 *
 * This test is a **regression alarm**, not a tight bound — if a future
 * change makes scoring blow past the budget, that is the signal to
 * profile (gene pruning, bit-array encoding, etc.). Do not chase
 * micro-optimisations to bring a passing run lower.
 */

const SAMPLE_HORSE = readFileSync(resolve('data/Genes_SampleHorse.txt'), 'utf-8');
const SAMPLE_GENOME = parseGenome(SAMPLE_HORSE);

const NUM_MALES = 15;
const NUM_FEMALES = 15;
const SCORING_BUDGET_MS = 500;

const ALLELE_CYCLE = ['D', 'R', 'x', 'D', 'R', 'D', 'x', 'R'];
const EFFECTS = ['Toughness+', 'Friendliness+', 'Intelligence-', 'None', 'Ruggedness+', 'Temperament+'];

/**
 * Build a horse genome by reusing the real sample's chromosome/block
 * structure but rewriting each allele based on `seed`. The Entity name
 * is replaced first so the global allele substitution can't accidentally
 * touch it (test names like `M0`/`F0` contain none of D/R/x/?, so the
 * substitution is safe even on the whole file).
 */
function buildHorseGenome(name, seed) {
  const withEntity = SAMPLE_HORSE.replace(/^Entity=.*$/m, `Entity=${name}`);
  let counter = 0;
  return withEntity.replace(/[DRx?]/g, () => {
    const allele = ALLELE_CYCLE[(seed + counter) % ALLELE_CYCLE.length];
    counter++;
    return allele;
  });
}

async function seedHorseGeneTable() {
  // One gene record per locus the real horse genome produces, so every
  // pet_genes row resolves to a parsed-gene record and accumulatePositive
  // exercises the per-attribute breakdown on every iteration.
  let i = 0;
  for (const [chrPadded, genes] of Object.entries(SAMPLE_GENOME.genes)) {
    for (const g of genes) {
      const effect = EFFECTS[i % EFFECTS.length];
      i++;
      await geneService.upsertGene('horse', chrPadded, toGeneId(g), {
        effectDominant: effect,
        effectRecessive: 'None',
        breed: '',
      });
    }
  }
  geneService.clearGeneEffectsCache('horse');
}

async function uploadHorse(name, gender, seed) {
  const result = await petService.uploadPet(buildHorseGenome(name, seed), { name, gender });
  expect(result.status).toBe('success');
  const pet = await petService.getPet(result.pet_id);
  expect(pet).not.toBeNull();
  return pet;
}

describe('rankBreedingPairs — performance regression', () => {
  beforeEach(async () => {
    await closeDatabase();
    await initDatabase();
    await runMigrations();
    geneService.clearGeneEffectsCache();
  });

  it(`scores 15×15 horses (real-genome sized) in under ${SCORING_BUDGET_MS}ms`, async () => {
    const lociPerPet = Object.values(SAMPLE_GENOME.genes).reduce((n, arr) => n + arr.length, 0);

    await seedHorseGeneTable();

    const males = [];
    for (let i = 0; i < NUM_MALES; i++) {
      males.push(await uploadHorse(`M${i}`, Gender.MALE, i * 7 + 1));
    }
    const females = [];
    for (let i = 0; i < NUM_FEMALES; i++) {
      females.push(await uploadHorse(`F${i}`, Gender.FEMALE, i * 11 + 3));
    }

    const start = performance.now();
    const results = await rankBreedingPairs({ species: 'Horse', pets: [...males, ...females] });
    const elapsed = performance.now() - start;

    expect(results).toHaveLength(NUM_MALES * NUM_FEMALES);
    expect(results.some((r) => r.evPositiveTotal > 0)).toBe(true);
    expect(results.every((r) => r.totalLoci === lociPerPet)).toBe(true);

    if (process.env.PERF_LOG) {
      console.log(
        `[perf] rankBreedingPairs ${NUM_MALES}×${NUM_FEMALES} pets, ${lociPerPet} loci/pet → ${elapsed.toFixed(1)}ms`,
      );
    }
    expect(elapsed).toBeLessThan(SCORING_BUDGET_MS);
  }, 30_000);
});
