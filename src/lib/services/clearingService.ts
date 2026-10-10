/**
 * Chromosome clearing for a stable: who is closest, which crosses can give a
 * clear foal, and which two-step routes get there when no cross can. The
 * arithmetic is in `utils/chromosomeClearing`.
 */
import { Gender, type Pet } from '$lib/types/index.js';
import {
  type AnimalStatus,
  allelesToGo,
  animalStatus,
  type BridgeClearing,
  bridgeClearing,
  chromosomeTargets,
  closerThan,
  type Homozygote,
  type PairClearing,
  pairClearing,
} from '$lib/utils/chromosomeClearing.js';
import { loadAllPetLoci, type PetLoci } from '$lib/utils/petLoci.js';
import { normalizeSpecies } from './configService.js';
import { getParsedGenesCached } from './geneService.js';

export interface ClearingPlan {
  /** Per locus, the genotype to reach, in gene order. */
  targets: Array<[string, Homozygote]>;
  /** Every animal, closest first. */
  animals: Array<{ pet: Pet; toGo: number } & AnimalStatus>;
  /**
   * Per gender, alleles to go of the closest animal: what a foal of that
   * gender has to beat to be progress. `null` with no animal of that gender.
   */
  best: Record<Gender, number | null>;
  /**
   * The gender line further from clear: a base needs both, and the weaker
   * line is the one holding it back.
   */
  behind: Gender;
  /** Single crosses, those likeliest to move the line that is behind first. */
  pairs: Array<{ sire: Pet; dam: Pet; pCloser: Record<Gender, number> } & PairClearing>;
  /** Two-step routes, fewest foals first. */
  routes: Array<{ sire: Pet; dam: Pet; partner: Pet } & BridgeClearing>;
}

export interface PlanClearingOptions {
  /** Animals to breed from: stabled, of one species. */
  pets: readonly Pet[];
  species: string;
  /** Chromosome number as in gene ids, e.g. `01`. */
  chromosome: string;
  limit?: number;
}

export async function planClearing(opts: PlanClearingOptions): Promise<ClearingPlan> {
  const started = performance.now();
  const limit = opts.limit ?? 8;
  const species = normalizeSpecies(opts.species);
  const pets = opts.pets.filter((p) => normalizeSpecies(p.species) === species);
  const [lociById, genes] = await Promise.all([loadAllPetLoci(pets.map((p) => p.id)), getParsedGenesCached(species)]);
  const targets = chromosomeTargets(genes, opts.chromosome);
  const empty: PetLoci = new Map();
  const lociOf = (p: Pet) => lociById.get(p.id) ?? empty;

  const animals = pets
    .map((pet) => {
      const status = animalStatus(lociOf(pet), targets);
      return { pet, toGo: allelesToGo(status), ...status };
    })
    .sort((a, b) => a.toGo - b.toGo || a.blocked.length - b.blocked.length || a.pet.name.localeCompare(b.pet.name));
  const bestOf = (g: Gender) => animals.find((a) => a.pet.gender === g)?.toGo ?? null;
  const best = { [Gender.MALE]: bestOf(Gender.MALE), [Gender.FEMALE]: bestOf(Gender.FEMALE) } as Record<
    Gender,
    number | null
  >;
  const behind = (best[Gender.MALE] ?? -1) >= (best[Gender.FEMALE] ?? -1) ? Gender.MALE : Gender.FEMALE;
  const other = behind === Gender.MALE ? Gender.FEMALE : Gender.MALE;
  // With no animal of a gender yet, any foal of it is progress.
  const beats = (toGo: number[], g: Gender) => {
    const b = best[g];
    return b === null ? 1 : closerThan(toGo, b);
  };

  const sires = pets.filter((p) => p.gender === Gender.MALE);
  const dams = pets.filter((p) => p.gender === Gender.FEMALE);

  const pairs: ClearingPlan['pairs'] = [];
  for (const sire of sires) {
    for (const dam of dams) {
      const pair = pairClearing(lociOf(sire), lociOf(dam), targets);
      pairs.push({
        sire,
        dam,
        pCloser: {
          [Gender.MALE]: beats(pair.toGo, Gender.MALE),
          [Gender.FEMALE]: beats(pair.toGo, Gender.FEMALE),
        } as Record<Gender, number>,
        ...pair,
      });
    }
  }
  // Progress first: a clear foal is many generations off for most stables,
  // and each generation is won by the foal closer than anything you have.
  pairs.sort(
    (a, b) =>
      b.pCloser[behind] - a.pCloser[behind] ||
      b.pCloser[other] - a.pCloser[other] ||
      b.pClear - a.pClear ||
      b.expected - a.expected,
  );

  // Every stabled pair, then their foal to any stabled animal of the other
  // gender — the first pair's own parents included, which is a backcross.
  const routes: ClearingPlan['routes'] = [];
  for (const sire of sires) {
    for (const dam of dams) {
      for (const partner of pets) {
        const route = bridgeClearing(lociOf(sire), lociOf(dam), lociOf(partner), targets);
        if (Number.isFinite(route.foals)) routes.push({ sire, dam, partner, ...route });
      }
    }
  }
  routes.sort((a, b) => a.foals - b.foals || b.pClear - a.pClear);

  console.info(
    `clearing chromosome ${opts.chromosome}: ${targets.size} loci, ${pets.length} animals, ${routes.length} routes, ${Math.round(performance.now() - started)} ms`,
  );
  return {
    targets: [...targets],
    animals,
    best,
    behind,
    pairs: pairs.slice(0, limit),
    routes: routes.slice(0, limit),
  };
}
