import { beforeEach, describe, expect, it } from 'vitest';
import { rankBreedingPairs } from '$lib/services/breedingService.js';
import { closeDatabase, initDatabase } from '$lib/services/database.js';
import * as geneService from '$lib/services/geneService.js';
import { runMigrations } from '$lib/services/migrationService.js';
import * as petService from '$lib/services/petService.js';
import { Gender } from '$lib/types/index.js';

/**
 * Worst-case Gorgonetics scale: 15 stabled males × 15 stabled females ×
 * ~1500 horse loci = 225 pairs × 1500 locus-comparisons each.
 *
 * This test is a **regression alarm**, not a tight bound — if a future
 * change makes scoring blow past the budget, that is the signal to
 * profile (gene pruning, bit-array encoding, etc.). Do not chase
 * micro-optimisations to bring a passing run lower.
 */

const NUM_MALES = 15;
const NUM_FEMALES = 15;
const NUM_CHROMOSOMES = 30;
const ALLELES_PER_CHROMOSOME = 50; // 30 × 50 = 1500 loci per pet
const SCORING_BUDGET_MS = 500;

const ALLELE_CYCLE = ['D', 'R', 'x', 'D', 'R', 'D', 'x', 'R'];

function buildAlleles(seed) {
  let s = '';
  for (let i = 0; i < ALLELES_PER_CHROMOSOME; i++) {
    s += ALLELE_CYCLE[(seed + i) % ALLELE_CYCLE.length];
  }
  return s;
}

function buildHorseGenome(name, seed) {
  const lines = [`[Overview]`, 'Format=1.0', 'Character=PerfTester', `Entity=${name}`, 'Genome=Horse', '', '[Genes]'];
  for (let chr = 1; chr <= NUM_CHROMOSOMES; chr++) {
    lines.push(`${chr}=${buildAlleles(seed + chr)}`);
  }
  return lines.join('\n');
}

async function seedHorseGeneTable() {
  // Mix of attribute and neutral effects so the per-attribute breakdown
  // exercises the accumulator without making every locus equivalent.
  const effects = ['Toughness+', 'Friendliness+', 'Intelligence-', 'None', 'Ruggedness+'];
  for (let chr = 1; chr <= NUM_CHROMOSOMES; chr++) {
    for (let pos = 0; pos < ALLELES_PER_CHROMOSOME; pos++) {
      const block = String.fromCharCode(65 + Math.floor(pos / 10));
      const within = (pos % 10) + 1;
      const chrStr = String(chr).padStart(2, '0');
      const geneId = `${chrStr}${block}${within}`;
      const effect = effects[(chr + pos) % effects.length];
      await geneService.upsertGene('horse', chrStr, geneId, {
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

  it(`scores 15×15 horses with ~1500 loci each in under ${SCORING_BUDGET_MS}ms`, async () => {
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
    // Sanity: at least one pair scored a non-zero positive total — the
    // loop is doing real work, not skipping every locus.
    expect(results.some((r) => r.evPositiveTotal > 0)).toBe(true);
    expect(results.some((r) => r.totalLoci > 0)).toBe(true);

    console.log(
      `[perf] rankBreedingPairs ${NUM_MALES}×${NUM_FEMALES} pets, ${NUM_CHROMOSOMES * ALLELES_PER_CHROMOSOME} loci/pet → ${elapsed.toFixed(1)}ms`,
    );
    expect(elapsed).toBeLessThan(SCORING_BUDGET_MS);
  }, 30_000);
});
