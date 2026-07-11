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

import { getGeneEffectsCached, getParsedGenesCached, isHorseBreedFiltered } from '$lib/services/geneService.js';
import { compareBlockLetters } from '$lib/services/genomeParser.js';
import type { ChromosomeTrio, GeneTrioEntry, OffspringTrioResult, Pet } from '$lib/types/index.js';
import { GeneType } from '$lib/types/index.js';
import { classifyTrioLocus, offspringDistribution, offspringOutcomeBuckets } from '$lib/utils/breedingGenetics.js';
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
    summary: { totalGenes, gains, risks, lockedIn, unknownLoci },
  };
}
