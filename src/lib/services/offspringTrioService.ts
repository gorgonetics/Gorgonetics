/**
 * Trio (Father / Offspring / Mother) genome engine.
 *
 * Computes a per-locus, chromosome-grouped view of a single breeding
 * pair: each parent's concrete allele plus the offspring's probabilistic
 * outcome and a gain/risk verdict. Loci are paired by `gene_id` (not by
 * positional index) so parents with differing projected loci stay aligned
 * — a locus present in only one parent treats the other as unknown, which
 * `offspringDistribution` already collapses to an unknown offspring.
 * Composes the pure genetics in `breedingGenetics` for the middle row.
 */

import { accumulatePositive, buildPoolCoverage, type PoolCoverage } from '$lib/services/breedingService.js';
import { getGeneEffectsCached, getParsedGenesCached, isHorseBreedFiltered } from '$lib/services/geneService.js';
import { compareBlockLetters } from '$lib/services/genomeParser.js';
import type {
  ChromosomeTrio,
  GeneTrioEntry,
  OffspringTrioResult,
  Pet,
  TrioLocusContributions,
} from '$lib/types/index.js';
import { Gender, GeneType } from '$lib/types/index.js';
import { classifyTrioLocus, offspringDistribution, offspringOutcomeBuckets } from '$lib/utils/breedingGenetics.js';
import {
  type AlleleTally,
  type BenefitWeight,
  breedReachFor,
  expectedCapabilityGain,
  tallyAlleles,
  tallyFor,
} from '$lib/utils/geneticQuality.js';
import { type ChromosomeLocus, groupLociByChromosome, loadAllPetLoci } from '$lib/utils/petLoci.js';
import { capitalize } from '$lib/utils/string.js';
import { normalizeSpecies } from './configService.js';

interface GeneEffectColumns {
  effectDominant?: string | null;
  effectRecessive?: string | null;
}

/**
 * The human effect string a parent expresses given its allele. Unknown
 * (`?`) or absent alleles express nothing knowable → undefined.
 */
function parentEffect(type: GeneType, effects: GeneEffectColumns | undefined): string | undefined {
  if (!effects || type === GeneType.UNKNOWN) return undefined;
  return (type === GeneType.RECESSIVE ? effects.effectRecessive : effects.effectDominant) ?? undefined;
}

/**
 * Ordered union of two parents' loci for one chromosome, keyed by
 * `gene_id`. Each entry pairs the father's and mother's allele at that
 * locus (`null` when that parent has no row). Ordered canonically by
 * block then position so the grid renders the same layout as the 2-pet
 * genome diff.
 */
function pairLociById(
  genesF: ChromosomeLocus[],
  genesM: ChromosomeLocus[],
): { locus: ChromosomeLocus; father: ChromosomeLocus | null; mother: ChromosomeLocus | null }[] {
  const byIdF = new Map(genesF.map((g) => [g.id, g]));
  const byIdM = new Map(genesM.map((g) => [g.id, g]));
  const union = [...genesF];
  for (const g of genesM) {
    if (!byIdF.has(g.id)) union.push(g);
  }
  union.sort((a, b) => {
    const blockCmp = compareBlockLetters(a.block, b.block);
    return blockCmp !== 0 ? blockCmp : a.position - b.position;
  });
  return union.map((locus) => ({
    locus,
    father: byIdF.get(locus.id) ?? null,
    mother: byIdM.get(locus.id) ?? null,
  }));
}

export interface OffspringTrioOptions {
  /** Canonical or display species — passed through `normalizeSpecies`. */
  species: string;
  /** Player-selected offspring breed; drives `isHorseBreedFiltered` for horses. */
  offspringBreed?: string;
  /**
   * The candidate pool the pair was ranked against — **the same list**, the
   * parents included.
   *
   * `Quality` and `Pool gain` are not properties of the pairing: both ask
   * what the *rest of the stable* can already breed, so attributing them to
   * loci needs the pool that produced them. Pass a different list and the
   * trio will honestly explain a score the breeding table never showed.
   * Omit it and those two contribution lenses are simply not offered.
   */
  pool?: readonly Pet[];
  /** Breed-lock weight for `Quality`; mirrors `rankBreedingPairs`. */
  breedLockWeight?: number;
}

/** Nothing to attribute — the shape every locus falls back to. */
const NO_CONTRIBUTION: Readonly<TrioLocusContributions> = Object.freeze({
  positive: 0,
  poolGain: 0,
  capability: 0,
});

/** The pool-derived state the additive scores are attributed against. */
interface PoolContext {
  coverage: PoolCoverage;
  tallies: Map<string, AlleleTally>;
  weight: BenefitWeight | undefined;
}

/**
 * Load the candidate pool and derive exactly what `rankBreedingPairs`
 * derives from it: per-slot coverage, allele tallies and the breed-reach
 * weight. A second `pet_genes` pass over animals the ranking already read,
 * accepted because it happens once when the player opens the trio, not per
 * pair.
 */
async function loadPoolContext(
  pool: readonly Pet[],
  parsedGenes: Parameters<typeof buildPoolCoverage>[1],
  species: string,
  offspringBreed: string | undefined,
  breedLockWeight: number | undefined,
): Promise<PoolContext> {
  // Same gate as `rankBreedingPairs`, which only ever loads the animals it
  // pairs. `Gender` is a TypeScript union, not a database constraint, so a row
  // with anything else in the column would otherwise feed this view's coverage
  // and tallies but not the ranking's — and the two totals would stop
  // reconciling, which is the one thing this pool is here to guarantee.
  const paired = pool.filter((p) => p.gender === Gender.MALE || p.gender === Gender.FEMALE);
  const poolLoci = await loadAllPetLoci(paired.map((p) => p.id));
  return {
    coverage: buildPoolCoverage(poolLoci.values(), parsedGenes, species, offspringBreed),
    tallies: tallyAlleles(poolLoci.values()),
    weight: breedReachFor(parsedGenes, offspringBreed, breedLockWeight),
  };
}

/**
 * Build the trio view for one (father × mother) pair.
 *
 * Both parents must have at least one projected `pet_genes` row; a parent
 * missing from the projection is treated as a load failure.
 */
export async function computeOffspringTrio(
  father: Pet,
  mother: Pet,
  opts: OffspringTrioOptions,
): Promise<OffspringTrioResult> {
  const species = normalizeSpecies(opts.species);
  const [petLociMap, effectsData, parsedGenes] = await Promise.all([
    loadAllPetLoci([father.id, mother.id]),
    getGeneEffectsCached(species),
    getParsedGenesCached(species),
  ]);

  // Sequential on purpose: coverage and tallies are keyed off the parsed gene
  // records, so there is nothing to overlap with.
  const poolCtx = opts.pool?.length
    ? await loadPoolContext(opts.pool, parsedGenes, species, opts.offspringBreed, opts.breedLockWeight)
    : null;

  const lociF = petLociMap.get(father.id);
  const lociM = petLociMap.get(mother.id);
  if (!lociF || !lociM) {
    throw new Error('Failed to load genome data for trio view');
  }

  const groupedF = groupLociByChromosome(lociF);
  const groupedM = groupLociByChromosome(lociM);
  const effectsDB = effectsData?.effects ?? {};

  const allChromosomes = [...new Set([...groupedF.keys(), ...groupedM.keys()])].sort(
    (a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10),
  );

  const chromosomes: ChromosomeTrio[] = [];
  let totalGenes = 0;
  let gains = 0;
  let risks = 0;
  let lockedIn = 0;
  let unknownLoci = 0;

  for (const chr of allChromosomes) {
    const genes: GeneTrioEntry[] = [];
    let chrGains = 0;
    let chrRisks = 0;

    for (const { locus, father: gF, mother: gM } of pairLociById(groupedF.get(chr) ?? [], groupedM.get(chr) ?? [])) {
      const geneId = locus.id;
      const gd = parsedGenes[geneId];

      // Skip loci locked to another breed — keeps the trio consistent
      // with the breeding ranking the player picked the pair from.
      if (isHorseBreedFiltered(species, opts.offspringBreed, gd?.breed)) continue;

      const fatherType = (gF?.type ?? GeneType.UNKNOWN) as GeneType;
      const motherType = (gM?.type ?? GeneType.UNKNOWN) as GeneType;
      const dist = offspringDistribution(fatherType, motherType);
      const cls = classifyTrioLocus(fatherType, motherType, dist, gd);

      // Per-locus share of the additive scores. `accumulatePositive` is the
      // ranking's own slot arithmetic; the two records it fills are the
      // per-attribute breakdown and its variance, neither of which the trio
      // shows, so they are scratch.
      let contributions = NO_CONTRIBUTION as TrioLocusContributions;
      if (gd) {
        const { total, weighted } = accumulatePositive(dist, gd, poolCtx?.coverage.get(geneId), {}, {});
        contributions = {
          positive: total,
          // Without a pool there is no coverage tier, and `accumulatePositive`
          // would fall back to the `missing` weight — inventing a gap rather
          // than reporting one. Report nothing instead.
          poolGain: poolCtx ? weighted : 0,
          capability: poolCtx
            ? expectedCapabilityGain(dist, gd, tallyFor(poolCtx.tallies, geneId)) *
              (poolCtx.weight ? poolCtx.weight(gd) : 1)
            : 0,
        };
      }

      const effects = effectsDB[geneId];
      // A single attribute label only makes sense when both sides agree (or one
      // side has no attribute). When the dominant and recessive effects target
      // different attributes — common in the shipped horse templates — any
      // single label would mislabel some genotypes, so leave it undefined.
      const domAttr = gd?.dominantAttribute ?? null;
      const recAttr = gd?.recessiveAttribute ?? null;
      const attribute = domAttr && recAttr && domAttr !== recAttr ? null : (domAttr ?? recAttr);

      genes.push({
        geneId,
        block: locus.block,
        position: locus.position,
        fatherType: (gF?.type ?? null) as GeneType | null,
        motherType: (gM?.type ?? null) as GeneType | null,
        dist,
        buckets: offspringOutcomeBuckets(fatherType, motherType, dist, gd),
        verdict: cls.verdict,
        source: cls.source,
        lockedIn: cls.lockedIn,
        pPositive: cls.pPositive,
        pNegative: cls.pNegative,
        contributions,
        attribute: attribute ? capitalize(attribute) : undefined,
        fatherEffect: parentEffect(fatherType, effects),
        motherEffect: parentEffect(motherType, effects),
      });

      totalGenes++;
      if (cls.verdict === 'gain') {
        gains++;
        chrGains++;
        if (cls.lockedIn) lockedIn++;
      } else if (cls.verdict === 'risk') {
        risks++;
        chrRisks++;
      }
      if (dist.unknown === 1) unknownLoci++;
    }

    // A chromosome whose every locus was breed-filtered contributes no rows;
    // drop it so the grid doesn't render an empty chromosome header.
    if (genes.length > 0) {
      chromosomes.push({ chromosome: chr, totalGenes: genes.length, gains: chrGains, risks: chrRisks, genes });
    }
  }

  return {
    chromosomes,
    summary: { totalGenes, gains, risks, lockedIn, unknownLoci, poolScored: poolCtx !== null },
  };
}
