import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { rankBreedingPairs } from '$lib/services/breedingService.js';
import { closeDatabase, initDatabase } from '$lib/services/database.js';
import * as geneService from '$lib/services/geneService.js';
import { safeCullSet } from '$lib/services/geneticQualityService.js';
import { runMigrations } from '$lib/services/migrationService.js';
import * as petService from '$lib/services/petService.js';
import { Gender, GeneType, type Pet } from '$lib/types/index.js';
import { resolveObjective } from '$lib/utils/breedingObjectives.js';
import { suggestPlans } from '$lib/utils/breedingPlan.js';
import { fromGeneId } from '$lib/utils/geneAnalysis.js';
import {
  benefitSlots,
  capability,
  MIN_POPULATION,
  type ScoredGene,
  scoreGroup,
  tallyAlleles,
} from '$lib/utils/geneticQuality.js';
import { loadAllPetLoci, type PetLoci } from '$lib/utils/petLoci.js';

/**
 * The breeding loop a player actually runs: free six slots with the cull
 * walk, breed six pairs under "Reach new ground", stable the foals, repeat.
 *
 * Two properties are asserted over the whole loop, because neither follows
 * from the per-call unit tests:
 *
 *  - **It never gets stuck.** Every round releases exactly the slots asked
 *    for and fills them again, with foal sex a coin toss. A player who keeps
 *    breeding must always be offered a priced release list, never a dead
 *    end — which is the walk's sex floor at work: without it, simulated
 *    runs drained one sex and shrank the stable until nothing could pair.
 *  - **Quality ratchets.** The stable's total capability — the very quantity
 *    the cull walk prices and the reach objective adds to — must end above
 *    where it started and never fall below it. Individual rounds may dip
 *    (a foal is one draw from a distribution), but the loop as a whole is
 *    supposed to compound, and the walk's stated cost must be exactly the
 *    capability that actually left.
 *
 * What is deliberately **not** asserted: that some animal is always free.
 * Once the redundant core is gone, every release costs something and that
 * is the metric being honest, not a defect — the loop is required to reach
 * that regime and keep going through it. Measured on this herd the total
 * climbs steeply while releases are free, then converges once each round's
 * cull cost and reach gain are both around one slot-unit, well below the
 * genome's ceiling because alleles nobody carries cannot be bred into
 * existence. The last test pins down why nothing is free: a foal can lock
 * an allele both parents only carried, leaving all three irreplaceable at
 * once.
 *
 * Runs on the shipped horse gene template with a synthetic herd: a few
 * founders plus their single-draw descendants, so the stable starts with
 * the redundancy a real one has. Seeded, so the run is reproducible.
 */

const SPECIES = 'horse';
const SLOTS = 6;
const ROUNDS = 12;
const FOUNDERS = 6;
const HERD = 31;

interface TemplateGene {
  gene: string;
  effectDominant: string;
  effectRecessive: string;
  appearance?: string;
  breed?: string;
}

const horseDir = resolve('assets/horse');
const template: TemplateGene[] = readdirSync(horseDir)
  .filter((f) => f.endsWith('.json'))
  .sort()
  .flatMap((f) => JSON.parse(readFileSync(resolve(horseDir, f), 'utf-8')) as TemplateGene[]);

/** Chromosome → ordered block letters → gene ids in position order. */
const layout = (() => {
  const chromosomes = new Map<string, Map<string, string[]>>();
  for (const g of template) {
    const pos = fromGeneId(g.gene);
    if (!pos) throw new Error(`bad gene id ${g.gene}`);
    let blocks = chromosomes.get(pos.chromosome);
    if (!blocks) {
      blocks = new Map();
      chromosomes.set(pos.chromosome, blocks);
    }
    let ids = blocks.get(pos.block);
    if (!ids) {
      ids = [];
      blocks.set(pos.block, ids);
    }
    ids[pos.position - 1] = g.gene;
  }
  return chromosomes;
})();

let seed = 20260908;
/** Seeded LCG so the run is reproducible. */
function rnd(): number {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}

function drawAllele(t: GeneType): GeneType {
  if (t === GeneType.MIXED) return rnd() < 0.5 ? GeneType.DOMINANT : GeneType.RECESSIVE;
  return t;
}

/** One Mendelian draw per locus — a foal, not a distribution. */
function drawFoal(sire: PetLoci, dam: PetLoci): PetLoci {
  const out: PetLoci = new Map();
  for (const [geneId, ts] of sire) {
    const td = dam.get(geneId) ?? GeneType.UNKNOWN;
    if (ts === GeneType.UNKNOWN || td === GeneType.UNKNOWN) {
      out.set(geneId, GeneType.UNKNOWN);
      continue;
    }
    const a = drawAllele(ts);
    const b = drawAllele(td);
    out.set(geneId, a === b ? a : GeneType.MIXED);
  }
  return out;
}

/**
 * Per-locus recessive frequency for the founders. Skewed so that at most
 * loci one allele is rare — carried by one or two founders, heterozygous —
 * which is the regime where culling costs something and "Reach new ground"
 * has ground to gain. A uniform frequency gives twelve founder alleles per
 * locus and locks nearly every benefit from the start, leaving nothing for
 * the loop to prove.
 */
const founderRecessiveFrequency: number[] = template.map(() => {
  const u = rnd();
  if (u < 0.4) return 0.04 + 0.08 * rnd();
  if (u < 0.8) return 0.88 + 0.08 * rnd();
  return 0.2 + 0.6 * rnd();
});

/** A founder: independent loci at the frequencies above. */
function randomFounder(): PetLoci {
  const out: PetLoci = new Map();
  template.forEach((g, i) => {
    const pR = founderRecessiveFrequency[i];
    const a = rnd() < pR ? GeneType.RECESSIVE : GeneType.DOMINANT;
    const b = rnd() < pR ? GeneType.RECESSIVE : GeneType.DOMINANT;
    out.set(g.gene, a === b ? a : GeneType.MIXED);
  });
  return out;
}

/** Serialise loci in the game's genome-file layout so `uploadPet` parses it. */
function genomeText(name: string, loci: PetLoci): string {
  const lines: string[] = [];
  for (const [chromosome, blocks] of layout) {
    const letters = [...blocks.keys()].sort((a, b) => a.length - b.length || a.localeCompare(b));
    const text = letters.map((l) => (blocks.get(l) ?? []).map((id) => loci.get(id) ?? '?').join('')).join(' ');
    lines.push(`${chromosome}=       ${text}`);
  }
  return `[Overview]\nFormat=v1.0\nCharacter=Tester\nEntity=${name}\nGenome=Horse\n\n[Genes]\n${lines.join('\n')}\n`;
}

async function stable(): Promise<Pet[]> {
  const { items } = await petService.getAllPets();
  return items.filter((p) => p.stabled && p.species.toLowerCase() === SPECIES);
}

async function upload(name: string, gender: Gender, loci: PetLoci): Promise<number> {
  const result = await petService.uploadPet(genomeText(name, loci), { name, gender });
  expect(result.status, result.message).toBe('success');
  return result.pet_id as number;
}

/** Total capability of a set of animals: the quantity the cull walk prices. */
function totalCapability(lociByPet: Iterable<PetLoci>, genes: Record<string, ScoredGene>): number {
  const tallies = tallyAlleles(lociByPet);
  let total = 0;
  for (const [geneId, gene] of Object.entries(genes)) {
    const tally = tallies.get(geneId);
    if (!tally) continue;
    for (const slot of benefitSlots(gene)) {
      const hom = slot.allele === GeneType.DOMINANT ? tally.homD : tally.homR;
      const car = slot.allele === GeneType.DOMINANT ? tally.carD : tally.carR;
      total += capability(hom, car);
    }
  }
  return total;
}

async function stableCapability(pets: readonly Pet[], genes: Record<string, ScoredGene>): Promise<number> {
  const loci = await loadAllPetLoci(pets.map((p) => p.id));
  return totalCapability(loci.values(), genes);
}

describe('breeding loop: cull six, breed six under Reach new ground, repeat', () => {
  let genes: Record<string, ScoredGene>;

  beforeAll(async () => {
    await closeDatabase();
    await initDatabase();
    await runMigrations();
    geneService.clearGeneEffectsCache();
    for (const g of template) {
      const pos = fromGeneId(g.gene);
      await geneService.upsertGene(SPECIES, pos?.chromosome ?? '01', g.gene, {
        effectDominant: g.effectDominant,
        effectRecessive: g.effectRecessive,
        appearance: g.appearance,
        breed: g.breed,
      });
    }
    geneService.clearGeneEffectsCache(SPECIES);
    genes = await geneService.getParsedGenesCached(SPECIES);

    // Founders, then descendants of random founder pairs, so the herd starts
    // with the sibling redundancy a real stable has.
    const founders: PetLoci[] = [];
    for (let i = 0; i < FOUNDERS; i++) {
      const loci = randomFounder();
      founders.push(loci);
      await upload(`Founder ${i + 1}`, i % 2 === 0 ? Gender.MALE : Gender.FEMALE, loci);
    }
    for (let i = FOUNDERS; i < HERD; i++) {
      const a = founders[Math.floor(rnd() * FOUNDERS)];
      const b = founders[Math.floor(rnd() * FOUNDERS)];
      await upload(`Kin ${i + 1}`, i % 2 === 0 ? Gender.MALE : Gender.FEMALE, drawFoal(a, b));
    }
  }, 120_000);

  it('never gets stuck and ratchets total capability upward', async () => {
    const reach = resolveObjective('reach');
    expect(reach).not.toBeNull();

    const initial = await stable();
    expect(initial).toHaveLength(HERD);
    const f0 = await stableCapability(initial, genes);
    const series = [f0];
    let pricedRounds = 0;
    let nextName = 0;

    for (let round = 1; round <= ROUNDS; round++) {
      const before = await stable();
      const fBefore = await stableCapability(before, genes);

      // Free the slots. The walk must always deliver the count asked for
      // while the population is above the floor, priced when not free.
      const plan = await safeCullSet({ species: SPECIES, pets: before, slots: SLOTS });
      expect(plan.releases, `round ${round}: releases`).toHaveLength(SLOTS);
      // The sex floor: what is left must still form the pairs the slots are for.
      expect(plan.after.pairs, `round ${round}: pairs left`).toBeGreaterThanOrEqual(SLOTS);
      if (plan.totalCost > 0) pricedRounds++;
      for (const r of plan.releases) await petService.updatePet(r.pet.id, { stabled: false });

      // The stated cost is exactly the capability that left — the walk's
      // sequential pricing is honest against the real total.
      const afterCull = await stable();
      expect(afterCull).toHaveLength(HERD - SLOTS);
      const fAfterCull = await stableCapability(afterCull, genes);
      expect(fBefore - fAfterCull, `round ${round}: priced cost`).toBeCloseTo(plan.totalCost, 9);

      // Breed under Reach new ground — the objective built on the same
      // capability function the walk just priced.
      const ranked = await rankBreedingPairs({ species: SPECIES, pets: afterCull });
      const [best] = suggestPlans({ ranked, slots: SLOTS, score: reach?.score });
      expect(best?.pairs, `round ${round}: plan`).toHaveLength(SLOTS);

      const parentLoci = await loadAllPetLoci(afterCull.map((p) => p.id));
      for (const pair of best.pairs) {
        const sire = parentLoci.get(pair.male.id);
        const dam = parentLoci.get(pair.female.id);
        expect(sire && dam).toBeTruthy();
        // Foal sex is a coin toss, as in the game. What keeps the loop
        // pairable is the walk's sex floor, not luck.
        const gender = rnd() < 0.5 ? Gender.MALE : Gender.FEMALE;
        await upload(`Foal ${++nextName}`, gender, drawFoal(sire as PetLoci, dam as PetLoci));
      }

      // Adding animals can only add capability; the stable is back to size.
      const after = await stable();
      expect(after).toHaveLength(HERD);
      const fAfter = await stableCapability(after, genes);
      expect(fAfter, `round ${round}: breeding lost capability`).toBeGreaterThanOrEqual(fAfterCull);
      series.push(fAfter);
    }

    // Improving or converging: never below the start, and above it by the end.
    for (const [i, f] of series.entries()) expect(f, `after round ${i}`).toBeGreaterThanOrEqual(f0);
    expect(series[series.length - 1]).toBeGreaterThan(f0);

    // The run must have reached the regime the player sees after a few
    // rounds — releases that cost something — and kept going through it.
    // A herd that stays free throughout has proved nothing about the loop.
    expect(pricedRounds).toBeGreaterThan(0);

    // Bounded above by the genome: one unit per benefit slot.
    const ceiling = Object.values(genes).reduce((n, g) => n + benefitSlots(g).length, 0);
    for (const f of series) expect(f).toBeLessThanOrEqual(ceiling);
    expect(HERD - SLOTS).toBeGreaterThan(MIN_POPULATION);
  }, 300_000);
});

describe('why a breeding round can leave nothing free', () => {
  /**
   * The intuition "a foal carries nothing its parents lack, so either a
   * parent or the foal is redundant" holds per allele and fails per animal.
   * Zygosity is capability: a foal that draws the recessive from both
   * heterozygous parents *locks* an allele the stable could only carry, and
   * each parent keeps an allele at some other locus the foal did not
   * inherit. All three then cost something.
   */
  const recessivePositive: ScoredGene = {
    dominantSign: null,
    recessiveSign: '+',
    dominantAttribute: null,
    recessiveAttribute: 'toughness',
    breed: '',
  };
  const genes: Record<string, ScoredGene> = { L1: recessivePositive, L2: recessivePositive, L3: recessivePositive };
  const D = GeneType.DOMINANT;
  const R = GeneType.RECESSIVE;
  const x = GeneType.MIXED;
  const animal = (l1: GeneType, l2: GeneType, l3: GeneType): PetLoci =>
    new Map([
      ['L1', l1],
      ['L2', l2],
      ['L3', l3],
    ]);

  it('a foal that locks a carried allele leaves sire, dam and foal all irreplaceable', () => {
    const lociByPet = new Map<number, PetLoci>([
      [1, animal(x, x, D)], // sire: carries R at L1 and L2
      [2, animal(x, D, x)], // dam: carries R at L1 and L3
      [3, animal(R, D, D)], // foal: a legal draw — R from each parent at L1, D elsewhere
      [4, animal(D, D, D)],
      [5, animal(D, D, D)],
    ]);
    const scores = scoreGroup(lociByPet, genes, [1, 2, 3, 4, 5]);
    // Foal: only animal that breeds L1 true; parents merely carry it.
    expect(scores.get(3)?.soleLockSlots).toBe(1);
    // Sire: sole carrier of L2's recessive; dam: sole carrier of L3's.
    expect(scores.get(1)?.soleSourceSlots).toBe(1);
    expect(scores.get(2)?.soleSourceSlots).toBe(1);
    for (const id of [1, 2, 3]) expect(scores.get(id)?.atRiskCapability).toBeGreaterThan(0);
    // The fillers are what "free" looks like.
    expect(scores.get(4)?.atRiskCapability).toBe(0);
  });
});
