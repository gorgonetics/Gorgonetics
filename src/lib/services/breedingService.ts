/**
 * Breeding Assistant scoring engine.
 *
 * Composes the per-locus genetics primitives (`offspringDistribution`,
 * `positiveExpressionProbability`) across every (Male × Female) pair in
 * the input set, returning per-pair EVs the UI can sort and present.
 *
 * Reads from the pre-projected `pet_genes` table — no genome JSON parse
 * on the hot path — and from the cached parsed-effect columns on the
 * `genes` table.
 */

import type { AlleleDistribution, BreedingPairResult, GeneType, Pet } from '$lib/types/index.js';
import { Gender, GeneType as GT } from '$lib/types/index.js';
import { offspringDistribution } from '$lib/utils/breedingGenetics.js';
import { capitalize } from '$lib/utils/string.js';
import { getAllAttributeNames, normalizeSpecies } from './configService.js';
import { getDb } from './database.js';
import { getParsedGenesCached, isHorseBreedFiltered, type ParsedGeneRecord } from './geneService.js';

export interface RankBreedingPairsOptions {
  /** Canonical or display species — passed through `normalizeSpecies`. */
  species: string;
  /**
   * Player-selected offspring breed. For horses, drives `isHorseBreedFiltered`
   * to skip breed-locked-to-other-breed loci. Optional / ignored for
   * species without breeds.
   */
  offspringBreed?: string;
  /**
   * Pre-filtered candidate parents (caller is expected to pass only
   * stabled, same-species pets). The service splits by gender and ranks
   * every M × F pair; same-gender or empty inputs return [].
   */
  pets: Pet[];
}

type PetLoci = Map<string, GeneType>;

/**
 * Single bulk read of `pet_genes` for the union of input pet ids. One
 * round-trip instead of N — at the worst-case 30 pets this is the
 * difference between 30 selects and 1.
 */
async function loadAllPetLoci(petIds: number[]): Promise<Map<number, PetLoci>> {
  const map = new Map<number, PetLoci>();
  if (petIds.length === 0) return map;
  const db = getDb();
  const placeholders = petIds.map((_, i) => `$id${i}`).join(', ');
  const params: Record<string, unknown> = {};
  petIds.forEach((id, i) => {
    params[`id${i}`] = id;
  });
  const rows = await db.select<{ pet_id: number; gene_id: string; gene_type: string }[]>(
    `SELECT pet_id, gene_id, gene_type FROM pet_genes WHERE pet_id IN (${placeholders})`,
    params,
  );
  for (const row of rows) {
    let loci = map.get(row.pet_id);
    if (!loci) {
      loci = new Map();
      map.set(row.pet_id, loci);
    }
    loci.set(row.gene_id, row.gene_type as GeneType);
  }
  return map;
}

/**
 * Add this locus's contribution to the per-attribute positive-expression
 * tally. Returns the total positive mass added across all attributes so
 * the caller can keep an aggregate without re-summing the record.
 */
function accumulatePositive(dist: AlleleDistribution, gd: ParsedGeneRecord, into: Record<string, number>): number {
  let total = 0;
  if (gd.dominantSign === '+' && gd.dominantAttribute) {
    const p = dist.D + dist.x;
    if (p > 0) {
      const key = capitalize(gd.dominantAttribute);
      into[key] = (into[key] ?? 0) + p;
      total += p;
    }
  }
  if (gd.recessiveSign === '+' && gd.recessiveAttribute) {
    const p = dist.R;
    if (p > 0) {
      const key = capitalize(gd.recessiveAttribute);
      into[key] = (into[key] ?? 0) + p;
      total += p;
    }
  }
  return total;
}

function emptyAttributeBreakdown(attrNames: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const a of attrNames) out[a] = 0;
  return out;
}

function scorePair(
  male: Pet,
  female: Pet,
  mLoci: PetLoci,
  fLoci: PetLoci,
  parsedGenes: Record<string, ParsedGeneRecord>,
  offspringBreed: string | undefined,
  species: string,
  attrNames: readonly string[],
): BreedingPairResult {
  const evPositiveByAttribute = emptyAttributeBreakdown(attrNames);
  let evMixed = 0;
  let evUnknown = 0;
  let evPositiveTotal = 0;
  let totalLoci = 0;

  // Walk the male's loci first; the female's set-difference is handled
  // in a second pass below. In well-formed same-species inputs both maps
  // hold identical key sets (genome files always emit one row per
  // position, even for unknown alleles) — the second pass is defensive
  // for partially-imported genomes.
  for (const [geneId, t1] of mLoci) {
    const gd = parsedGenes[geneId];
    if (isHorseBreedFiltered(species, offspringBreed, gd?.breed)) continue;
    const t2 = fLoci.get(geneId) ?? GT.UNKNOWN;
    const dist = offspringDistribution(t1, t2);
    evMixed += dist.x;
    evUnknown += dist.unknown;
    totalLoci++;
    if (gd) evPositiveTotal += accumulatePositive(dist, gd, evPositiveByAttribute);
  }
  for (const [geneId, t2] of fLoci) {
    if (mLoci.has(geneId)) continue;
    const gd = parsedGenes[geneId];
    if (isHorseBreedFiltered(species, offspringBreed, gd?.breed)) continue;
    const dist = offspringDistribution(GT.UNKNOWN, t2);
    evMixed += dist.x;
    evUnknown += dist.unknown;
    totalLoci++;
    // One parent unknown → distribution is full-unknown, P(positive) = 0.
  }

  return { male, female, evMixed, evPositiveByAttribute, evPositiveTotal, evUnknown, totalLoci };
}

/**
 * Rank every (Male × Female) pair in the candidate set by their expected
 * offspring scores. Returns results in deterministic male-then-female
 * input order; the UI is responsible for sorting by whichever column
 * the player picks.
 */
export async function rankBreedingPairs(opts: RankBreedingPairsOptions): Promise<BreedingPairResult[]> {
  const males = opts.pets.filter((p) => p.gender === Gender.MALE);
  const females = opts.pets.filter((p) => p.gender === Gender.FEMALE);
  if (males.length === 0 || females.length === 0) return [];

  const species = normalizeSpecies(opts.species);
  const ids = [...males.map((p) => p.id), ...females.map((p) => p.id)];
  const [petLociMap, parsedGenes] = await Promise.all([loadAllPetLoci(ids), getParsedGenesCached(species)]);

  const attrNames = getAllAttributeNames(species).map(capitalize);
  const empty: PetLoci = new Map();
  const results: BreedingPairResult[] = [];

  for (const m of males) {
    const mLoci = petLociMap.get(m.id) ?? empty;
    for (const f of females) {
      const fLoci = petLociMap.get(f.id) ?? empty;
      results.push(scorePair(m, f, mLoci, fLoci, parsedGenes, opts.offspringBreed, species, attrNames));
    }
  }

  return results;
}
