/**
 * The Capture tab's reading of one wild animal (#367): the DB-aware side of
 * `utils/captureAdvice`.
 *
 * Everything is measured against the stabled animals of the wild animal's
 * species, as the roster's Quality column is, so the two cannot disagree
 * about what the stable already holds. The advice is computed for both sexes:
 * the player reads the sex in the game, and a recessive allele is worth
 * something only to the sex that lacks it.
 */

import { magnitudesForBreed, rankBreedingPairs } from '#lib/services/breedingService.js';
import { loadRarityLookup, populationForTier } from '#lib/services/frequencyService.js';
import { attributeMagnitudesFor } from '#lib/services/studyService.js';
import { type BreedingPairResult, Gender, type Pet } from '#lib/types/index.js';
import { type AttributeMagnitudes, EMPTY_MAGNITUDES, hasMagnitudes } from '#lib/utils/attributePoints.js';
import {
  type BreedingComparison,
  type CaptureAdvice,
  captureAdvice,
  type HuntTarget,
  huntTargets,
  onAttributes,
  targetsSupplied,
} from '#lib/utils/captureAdvice.js';
import {
  breedReachFor,
  capabilityShare,
  carries,
  hasMeaningfulPopulation,
  type ScoredGene,
  scoreGroup,
} from '#lib/utils/geneticQuality.js';
import { neverSeenAlleles, withDeclaredEffect } from '#lib/utils/neverSeen.js';
import { loadAllPetLoci, type PetLoci } from '#lib/utils/petLoci.js';
import { normalizeSpecies } from './configService.js';
import { getGeneEffectsCached, getParsedGenesCached } from './geneService.js';
import { lociBySex } from './geneticQualityService.js';

export interface CaptureAssessment {
  /** Stabled animals of the species the wild animal was read against. */
  stableSize: number;
  /** Every benefit allele the stable cannot breed, on the wanted attributes: the hunt list. */
  targets: HuntTarget[];
  /** The same on every attribute, so a pin outside the wanted ones can be told met or not. */
  allTargets: HuntTarget[];
  /** The advice if the wild animal is of each sex. */
  advice: Record<Gender, CaptureAdvice>;
}

export interface AssessWildOptions {
  wild: Pet;
  /** The whole roster; the stabled animals of the wild animal's species are taken from it. */
  pets: readonly Pet[];
  focusBreed?: string;
  breedLockWeight?: number;
  /** Pinned hunt alleles, as `pinKey`s. Only these trigger a capture. */
  pins?: ReadonlySet<string>;
  /** Attributes the player breeds for; empty or omitted for all. */
  wanted?: ReadonlySet<string>;
}

/**
 * A foal's expected attribute total over the wanted attributes (all, when none
 * is wanted): points where measured, net effects otherwise. The ranking counts
 * negatives per attribute only in points, so in effects a wanted-attribute
 * total counts the positives alone.
 */
function foalTotal(pair: BreedingPairResult, unit: BreedingComparison['unit'], wanted: ReadonlySet<string>): number {
  const counts = (attribute: string) => wanted.size === 0 || wanted.has(attribute.toLowerCase());
  const sum = (byAttribute: Record<string, number>) =>
    Object.entries(byAttribute).reduce((total, [attribute, v]) => (counts(attribute) ? total + v : total), 0);
  if (unit === 'points') return sum(pair.evPointsByAttribute ?? {});
  return wanted.size === 0 ? pair.evPositiveTotal - pair.evNegativeTotal : sum(pair.evPositiveByAttribute);
}

/** The median of a non-empty list. */
function median(values: number[]): number {
  const sorted = [...values].sort((x, y) => x - y);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Rank every pairing of the stable with the animal added, as the Breed tab
 * ranks them, and compare the animal as a parent with each stabled animal of
 * the sex given: a parent's value is its median foal over its partners.
 * Stabled parents are valued on the stable as it is: the animal is of their
 * sex, so it is never their partner.
 */
async function compareBreeding(
  wild: Pet,
  sex: Gender,
  pool: readonly Pet[],
  species: string,
  opts: {
    offspringBreed?: string;
    breedLockWeight?: number;
    magnitudes: AttributeMagnitudes;
    wanted: ReadonlySet<string>;
  },
): Promise<BreedingComparison | null> {
  const pairs = await rankBreedingPairs({
    species,
    pets: [...pool, { ...wild, gender: sex, stabled: true }],
    offspringBreed: opts.offspringBreed,
    breedLockWeight: opts.breedLockWeight,
    magnitudes: opts.magnitudes,
  });
  if (pairs.length === 0) return null;
  const unit: BreedingComparison['unit'] = hasMagnitudes(opts.magnitudes) ? 'points' : 'effects';
  const parentOf = (pair: BreedingPairResult) => (sex === Gender.MALE ? pair.male : pair.female);
  /** Each parent of this sex: its foal totals, one per partner. */
  const foals = new Map<number, { name: string; totals: number[] }>();
  for (const pair of pairs) {
    const parent = parentOf(pair);
    const entry = foals.get(parent.id) ?? { name: parent.name, totals: [] };
    entry.totals.push(foalTotal(pair, unit, opts.wanted));
    foals.set(parent.id, entry);
  }
  const own = foals.get(wild.id);
  let weakest: BreedingComparison['weakest'] = null;
  for (const [id, { name, totals }] of foals) {
    if (id === wild.id) continue;
    const total = median(totals);
    if (weakest === null || total < weakest.total) weakest = { total, name };
  }
  return { unit, withIt: own ? { total: median(own.totals), partners: own.totals.length } : null, weakest };
}

export async function assessWildPet(opts: AssessWildOptions): Promise<CaptureAssessment> {
  const species = normalizeSpecies(opts.wild.species);
  const pool = opts.pets.filter((p) => p.stabled && !p.wild && normalizeSpecies(p.species) === species);
  // The study solve is the slow part on a session's first open, so it starts
  // with the other reads rather than after them.
  const [loci, parsed, effects, lookup, known] = await Promise.all([
    loadAllPetLoci([...pool.map((p) => p.id), opts.wild.id]),
    getParsedGenesCached(species),
    getGeneEffectsCached(species),
    loadRarityLookup(populationForTier('stabled', opts.pets), species),
    attributeMagnitudesFor(species).catch(() => EMPTY_MAGNITUDES),
  ]);
  const genes = parsed as Readonly<Record<string, ScoredGene>>;
  const wildLoci: PetLoci = loci.get(opts.wild.id) ?? new Map();
  const scoredPool = pool.filter((p) => loci.has(p.id));

  const targets = huntTargets(lociBySex(scoredPool, loci), genes, { focusBreed: opts.focusBreed });
  const pins = opts.pins ?? new Set<string>();
  const wanted = opts.wanted ?? new Set<string>();
  // The never-seen allele at each locus, kept where this animal carries it.
  const unseen = withDeclaredEffect(neverSeenAlleles(wildLoci.keys(), lookup), effects?.effects ?? {});
  const neverSeen = [...unseen]
    .filter(([geneId, allele]) => {
      const type = wildLoci.get(geneId);
      return type !== undefined && carries(type, allele);
    })
    .map(([geneId, allele]) => ({ geneId, allele }));

  const offspringBreed = opts.focusBreed || undefined;
  const magnitudes = await magnitudesForBreed(known, species, offspringBreed);
  const breedingOpts = { offspringBreed, breedLockWeight: opts.breedLockWeight, magnitudes, wanted };
  const [maleBreeding, femaleBreeding] = await Promise.all([
    compareBreeding(opts.wild, Gender.MALE, scoredPool, species, breedingOpts),
    compareBreeding(opts.wild, Gender.FEMALE, scoredPool, species, breedingOpts),
  ]);
  const breedingFor = (sex: Gender) => (sex === Gender.MALE ? maleBreeding : femaleBreeding);

  const meaningful = hasMeaningfulPopulation(scoredPool.length + 1);
  const weight = breedReachFor(genes, opts.focusBreed, opts.breedLockWeight);
  const ids = [...scoredPool.map((p) => p.id), opts.wild.id];
  const adviceFor = (sex: Gender): CaptureAdvice => {
    const sexes = new Map<number, Gender>(scoredPool.map((p) => [p.id, p.gender]));
    sexes.set(opts.wild.id, sex);
    const shares = capabilityShare(scoreGroup(loci, genes, ids, { weight, sex: sexes }));
    let weakest: { id: number; name: string; share: number } | null = null;
    for (const pet of scoredPool) {
      const share = shares.get(pet.id) ?? 0;
      if (weakest === null || share < weakest.share) weakest = { id: pet.id, name: pet.name, share };
    }
    return captureAdvice({
      supplied: targetsSupplied(wildLoci, sex, targets),
      pins,
      wanted,
      neverSeen,
      quality: meaningful && weakest !== null ? { share: shares.get(opts.wild.id) ?? 0, weakest } : null,
      breeding: breedingFor(sex),
    });
  };

  return {
    stableSize: scoredPool.length,
    targets: onAttributes(targets, wanted),
    allTargets: targets,
    advice: { [Gender.MALE]: adviceFor(Gender.MALE), [Gender.FEMALE]: adviceFor(Gender.FEMALE) } as Record<
      Gender,
      CaptureAdvice
    >,
  };
}
