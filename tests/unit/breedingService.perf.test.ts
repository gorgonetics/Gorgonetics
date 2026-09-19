import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { rankBreedingPairs } from '$lib/services/breedingService.js';
import { closeDatabase, initDatabase } from '$lib/services/database.js';
import * as geneService from '$lib/services/geneService.js';
import { parseGenome } from '$lib/services/genomeParser.js';
import { runMigrations } from '$lib/services/migrationService.js';
import * as petService from '$lib/services/petService.js';
import { Gender, type Pet } from '$lib/types/index.js';
import { type AttributeMagnitudes, buildAttributeMagnitudes } from '$lib/utils/attributePoints.js';
import type { AttributeStudy, StudyFinding } from '$lib/utils/attributeStudy.js';
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
/**
 * Generous headroom on purpose: a typical run is well under half this, but
 * shared CI runners jitter (a 500ms bound flaked at ~502ms). This is a
 * regression alarm — it should fire when scoring roughly doubles, not on
 * runner noise.
 *
 * **Raised from 1000ms when the Genetic Quality Score landed.** That change
 * added four per-pair measures to the same locus walk (capability gain,
 * positive and negative variance, per-attribute variance), so the cost went
 * up for a reason rather than by accident. Measured locally over four runs:
 * ~373ms mean, 344–419ms spread. CI on the same commit read 1014ms against
 * the old 1000ms bound — a 1.4% overshoot on a runner ~3x slower than the
 * dev machine, which is the boundary flake this comment already warned
 * about, not a doubling.
 *
 * A `WeakMap` cache over the per-gene benefit slots was tried as the
 * alternative to raising this and abandoned: repeated runs showed no gain
 * outside the ±40ms noise, so it was pure added complexity.
 *
 * 1500ms keeps the alarm's purpose intact — it still fires if scoring
 * doubles again from here.
 */
const SCORING_BUDGET_MS = 1500;

const ALLELE_CYCLE = ['D', 'R', 'x', 'D', 'R', 'D', 'x', 'R'];
const EFFECTS = ['Toughness+', 'Friendliness+', 'Intelligence-', 'None', 'Ruggedness+', 'Temperament+'];

/**
 * Build a horse genome by reusing the real sample's chromosome/block
 * structure but rewriting each allele based on `seed`. The Entity name
 * is replaced first so the global allele substitution can't accidentally
 * touch it (test names like `M0`/`F0` contain none of D/R/x/?, so the
 * substitution is safe even on the whole file).
 */
function buildHorseGenome(name: string, seed: number) {
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

/**
 * A magnitude for *every* locus the gene table declares — the worst case for
 * the points pass, since a slot the study has not reached costs one map miss
 * and nothing else. The same cycle `seedHorseGeneTable` uses, so the two
 * agree on which attribute each locus lands on.
 */
function fullMagnitudeTable(): AttributeMagnitudes {
  const byAttribute = new Map<string, StudyFinding[]>();
  let i = 0;
  for (const genes of Object.values(SAMPLE_GENOME.genes)) {
    for (const g of genes) {
      const effect = EFFECTS[i % EFFECTS.length];
      i++;
      if (effect === 'None') continue;
      const attribute = effect.slice(0, -1).toLowerCase();
      const gene = toGeneId(g);
      const findings = byAttribute.get(attribute) ?? [];
      findings.push({
        gene,
        expression: 'dominant',
        attribute,
        magnitude: effect.endsWith('-') ? -((i % 4) + 1) : (i % 5) + 1,
        tier: 'direct',
        depth: 0,
        support: 2,
        dissent: 0,
        witnesses: [],
      });
      byAttribute.set(attribute, findings);
    }
  }
  return buildAttributeMagnitudes(
    [...byAttribute].map(
      ([attribute, findings]): AttributeStudy => ({
        attribute,
        slots: findings.length,
        findings,
        contradictions: [],
        geneDoubts: [],
        validation: { tested: 0, exact: 0, stabledTested: 0, stabledExact: 0 },
        contributors: NUM_MALES + NUM_FEMALES,
      }),
    ),
  );
}

async function uploadHorse(name: string, gender: Gender, seed: number): Promise<Pet> {
  const result = await petService.uploadPet(buildHorseGenome(name, seed), { name, gender });
  expect(result.status).toBe('success');
  const pet = await petService.getPet(result.pet_id!);
  expect(pet).not.toBeNull();
  return pet as Pet;
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

  it(`stays inside the same budget with every slot measured`, async () => {
    // The points pass walks the same loci the count pass does, so a table
    // that knows every slot is the ceiling on what it can cost. Same budget:
    // if scoring in points is dear enough to need its own, that is a design
    // problem, not a number to raise.
    await seedHorseGeneTable();
    const males = [];
    for (let i = 0; i < NUM_MALES; i++) males.push(await uploadHorse(`M${i}`, Gender.MALE, i * 7 + 1));
    const females = [];
    for (let i = 0; i < NUM_FEMALES; i++) females.push(await uploadHorse(`F${i}`, Gender.FEMALE, i * 11 + 3));
    const pets = [...males, ...females];
    const magnitudes = fullMagnitudeTable();

    const start = performance.now();
    const results = await rankBreedingPairs({ species: 'Horse', pets, magnitudes });
    const elapsed = performance.now() - start;

    expect(results).toHaveLength(NUM_MALES * NUM_FEMALES);
    expect(results.some((r) => (r.evPointsByAttribute?.Toughness ?? 0) !== 0)).toBe(true);

    if (process.env.PERF_LOG) {
      console.log(`[perf] rankBreedingPairs with full magnitudes → ${elapsed.toFixed(1)}ms`);
    }
    expect(elapsed).toBeLessThan(SCORING_BUDGET_MS);
  }, 30_000);
});
