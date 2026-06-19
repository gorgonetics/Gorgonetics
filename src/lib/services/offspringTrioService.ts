/**
 * Trio (Father / Offspring / Mother) genome engine.
 *
 * Computes a per-locus, chromosome-grouped view of a single breeding
 * pair: each parent's concrete allele plus the offspring's probabilistic
 * outcome and a gain/risk verdict. Structurally mirrors
 * `comparisonService.diffGenomes` (positional, index-aligned walk over
 * the pre-projected `pet_genes` rows) but for three rows, and composes
 * the pure genetics in `breedingGenetics` for the offspring middle row.
 */

import { getGeneEffectsCached, getParsedGenesCached, isHorseBreedFiltered } from '$lib/services/geneService.js';
import type { ChromosomeTrio, GeneTrioEntry, OffspringTrioResult, Pet } from '$lib/types/index.js';
import { GeneType } from '$lib/types/index.js';
import { classifyTrioLocus, offspringDistribution } from '$lib/utils/breedingGenetics.js';
import { groupLociByChromosome, loadAllPetLoci } from '$lib/utils/petLoci.js';
import { capitalize } from '$lib/utils/string.js';
import { normalizeSpecies } from './configService.js';

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
 * missing from the projection is treated as a load failure, matching
 * `diffGenomes`.
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
    const genesF = groupedF.get(chr) ?? [];
    const genesM = groupedM.get(chr) ?? [];
    const maxLen = Math.max(genesF.length, genesM.length);
    const genes: GeneTrioEntry[] = [];
    let chrGains = 0;
    let chrRisks = 0;

    for (let i = 0; i < maxLen; i++) {
      const gF = genesF[i] ?? null;
      const gM = genesM[i] ?? null;
      const geneId = gF?.id ?? gM?.id ?? `${chr}?${i + 1}`;
      const gd = parsedGenes[geneId];

      // Skip loci locked to another breed — keeps the trio consistent
      // with the breeding ranking the player picked the pair from.
      if (isHorseBreedFiltered(species, opts.offspringBreed, gd?.breed)) continue;

      const fatherType = (gF?.type ?? GeneType.UNKNOWN) as GeneType;
      const motherType = (gM?.type ?? GeneType.UNKNOWN) as GeneType;
      const dist = offspringDistribution(fatherType, motherType);
      const cls = classifyTrioLocus(fatherType, motherType, dist, gd);

      const effects = effectsDB[geneId];
      const attribute = gd?.dominantAttribute ?? gd?.recessiveAttribute ?? undefined;

      genes.push({
        geneId,
        block: gF?.block ?? gM?.block ?? '?',
        position: gF?.position ?? gM?.position ?? i + 1,
        fatherType: (gF?.type ?? null) as GeneType | null,
        motherType: (gM?.type ?? null) as GeneType | null,
        dist,
        verdict: cls.verdict,
        source: cls.source,
        lockedIn: cls.lockedIn,
        pPositive: cls.pPositive,
        pNegative: cls.pNegative,
        attribute: attribute ? capitalize(attribute) : undefined,
        fatherEffect: effects
          ? fatherType === GeneType.RECESSIVE
            ? effects.effectRecessive
            : effects.effectDominant
          : undefined,
        motherEffect: effects
          ? motherType === GeneType.RECESSIVE
            ? effects.effectRecessive
            : effects.effectDominant
          : undefined,
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

    chromosomes.push({ chromosome: chr, totalGenes: genes.length, gains: chrGains, risks: chrRisks, genes });
  }

  return {
    chromosomes,
    summary: { totalGenes, gains, risks, lockedIn, unknownLoci },
  };
}
