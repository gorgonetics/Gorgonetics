/**
 * Comparison engine for head-to-head pet comparison.
 */

import { getAllAttributeNames, getAttributeConfig, normalizeSpecies } from '$lib/services/configService.js';
import { getGeneEffectsCached } from '$lib/services/geneService.js';
import { emptyStatsEntry, getPetGeneStats } from '$lib/services/petService.js';
import type {
  AttributeComparisonResult,
  ChromosomeDiff,
  GeneDiffEntry,
  GeneStatsComparisonResult,
  Pet,
} from '$lib/types/index.js';
import { groupLociByChromosome, loadAllPetLoci } from '$lib/utils/petLoci.js';
import { capitalize } from '$lib/utils/string.js';

/**
 * Compare attributes between two same-species pets.
 */
export function compareAttributes(petA: Pet, petB: Pet): AttributeComparisonResult[] {
  const species = normalizeSpecies(petA.species);
  const config = getAttributeConfig(species);
  const attrNames = getAllAttributeNames(species);

  return attrNames.map((attrName) => {
    const info = config.attributes.find((a) => a.key.toLowerCase() === attrName.toLowerCase());
    const key = capitalize(attrName);
    const valA = ((petA as Record<string, unknown>)[attrName] as number) ?? 0;
    const valB = ((petB as Record<string, unknown>)[attrName] as number) ?? 0;
    const diff = valA - valB;

    let winner: 'a' | 'b' | 'tie' = 'tie';
    if (diff > 0) winner = 'a';
    else if (diff < 0) winner = 'b';

    return {
      key,
      name: info?.name ?? key,
      icon: info?.icon ?? '',
      petAValue: valA,
      petBValue: valB,
      diff,
      winner,
    };
  });
}

/** Compare per-attribute gene stats between two same-species pets. */
export async function compareGeneStats(petA: Pet, petB: Pet): Promise<GeneStatsComparisonResult[]> {
  const species = normalizeSpecies(petA.species);
  const [statsA, statsB] = await Promise.all([
    getPetGeneStats(petA.id, species, petA.breed),
    getPetGeneStats(petB.id, species, petB.breed),
  ]);

  const config = getAttributeConfig(species);
  const attrNames = getAllAttributeNames(species);

  return attrNames.map((attrName) => {
    const key = capitalize(attrName);
    const info = config.attributes.find((a) => a.key.toLowerCase() === attrName.toLowerCase());

    return {
      key,
      name: info?.name ?? key,
      icon: info?.icon ?? '',
      petA: statsA.stats[key] ?? emptyStatsEntry(),
      petB: statsB.stats[key] ?? emptyStatsEntry(),
    };
  });
}

/**
 * Compute a chromosome-by-chromosome genome diff between two pets.
 *
 * Reads from the pre-projected `pet_genes` table via the shared
 * `petLoci` utility — no genome JSON parse on the hot path. Both pets
 * must have at least one projected row; a pet missing from the
 * projection is treated as a load failure (same surface as the legacy
 * implementation, which threw when `getPetGenome` returned null).
 */
export async function diffGenomes(
  petA: Pet,
  petB: Pet,
): Promise<{
  diffs: ChromosomeDiff[];
  summary: { totalGenes: number; identicalGenes: number; differentGenes: number; similarityPercent: number };
}> {
  const species = normalizeSpecies(petA.species);
  const [petLociMap, effectsData] = await Promise.all([
    loadAllPetLoci([petA.id, petB.id]),
    getGeneEffectsCached(species),
  ]);

  const lociA = petLociMap.get(petA.id);
  const lociB = petLociMap.get(petB.id);
  if (!lociA || !lociB) {
    throw new Error('Failed to load genome data for comparison');
  }

  const groupedA = groupLociByChromosome(lociA);
  const groupedB = groupLociByChromosome(lociB);
  const effectsDB = effectsData?.effects ?? {};

  // Union of all chromosomes, sorted numerically — same order
  // parseGenomeGenes-driven diff used.
  const allChromosomes = [...new Set([...groupedA.keys(), ...groupedB.keys()])].sort(
    (a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10),
  );

  const diffs: ChromosomeDiff[] = [];
  let totalGenes = 0;
  let identicalGenes = 0;
  let differentGenes = 0;

  for (const chr of allChromosomes) {
    const genesA = groupedA.get(chr) ?? [];
    const genesB = groupedB.get(chr) ?? [];
    const maxLen = Math.max(genesA.length, genesB.length);

    const genes: GeneDiffEntry[] = [];

    for (let i = 0; i < maxLen; i++) {
      const gA = genesA[i] ?? null;
      const gB = genesB[i] ?? null;

      const typeA = gA?.type ?? null;
      const typeB = gB?.type ?? null;
      const isDifferent = typeA !== typeB;
      const geneId = gA?.id ?? gB?.id ?? `${chr}?${i + 1}`;

      let petAEffect: string | undefined;
      let petBEffect: string | undefined;
      if (isDifferent) {
        if (typeA && typeA !== '?' && effectsDB[geneId]) {
          const data = effectsDB[geneId];
          petAEffect = typeA === 'R' ? data.effectRecessive : data.effectDominant;
        }
        if (typeB && typeB !== '?' && effectsDB[geneId]) {
          const data = effectsDB[geneId];
          petBEffect = typeB === 'R' ? data.effectRecessive : data.effectDominant;
        }
      }

      genes.push({
        geneId,
        block: gA?.block ?? gB?.block ?? '?',
        position: gA?.position ?? gB?.position ?? i + 1,
        petAType: typeA as GeneDiffEntry['petAType'],
        petBType: typeB as GeneDiffEntry['petBType'],
        isDifferent,
        petAEffect,
        petBEffect,
      });

      totalGenes++;
      if (isDifferent) differentGenes++;
      else identicalGenes++;
    }

    diffs.push({
      chromosome: chr,
      totalGenes: genes.length,
      identicalGenes: genes.filter((g) => !g.isDifferent).length,
      differentGenes: genes.filter((g) => g.isDifferent).length,
      genes,
    });
  }

  const similarityPercent = totalGenes > 0 ? Math.round((identicalGenes / totalGenes) * 100) : 0;

  return {
    diffs,
    summary: { totalGenes, identicalGenes, differentGenes, similarityPercent },
  };
}
