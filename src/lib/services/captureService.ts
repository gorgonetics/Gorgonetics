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

import { loadRarityLookup, populationForTier } from '#lib/services/frequencyService.js';
import { Gender, type Pet } from '#lib/types/index.js';
import {
  type CaptureAdvice,
  captureAdvice,
  type HuntTarget,
  huntTargets,
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
  /** Every benefit allele the stable cannot breed: the hunt list. */
  targets: HuntTarget[];
  /** The advice if the wild animal is of each sex. */
  advice: Record<Gender, CaptureAdvice>;
}

export interface AssessWildOptions {
  wild: Pet;
  /** The whole roster; the stabled animals of the wild animal's species are taken from it. */
  pets: readonly Pet[];
  focusBreed?: string;
  breedLockWeight?: number;
}

export async function assessWildPet(opts: AssessWildOptions): Promise<CaptureAssessment> {
  const species = normalizeSpecies(opts.wild.species);
  const pool = opts.pets.filter((p) => p.stabled && !p.wild && normalizeSpecies(p.species) === species);
  const [loci, parsed, effects, lookup] = await Promise.all([
    loadAllPetLoci([...pool.map((p) => p.id), opts.wild.id]),
    getParsedGenesCached(species),
    getGeneEffectsCached(species),
    loadRarityLookup(populationForTier('stabled', opts.pets), species),
  ]);
  const genes = parsed as Readonly<Record<string, ScoredGene>>;
  const wildLoci: PetLoci = loci.get(opts.wild.id) ?? new Map();
  const scoredPool = pool.filter((p) => loci.has(p.id));

  const targets = huntTargets(lociBySex(scoredPool, loci), genes, { focusBreed: opts.focusBreed });
  // The never-seen allele at each locus, kept where this animal carries it.
  const unseen = withDeclaredEffect(neverSeenAlleles(wildLoci.keys(), lookup), effects?.effects ?? {});
  const neverSeen = [...unseen]
    .filter(([geneId, allele]) => {
      const type = wildLoci.get(geneId);
      return type !== undefined && carries(type, allele);
    })
    .map(([geneId, allele]) => ({ geneId, allele }));

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
      neverSeen,
      quality: meaningful && weakest !== null ? { share: shares.get(opts.wild.id) ?? 0, weakest } : null,
    });
  };

  return {
    stableSize: scoredPool.length,
    targets,
    advice: { [Gender.MALE]: adviceFor(Gender.MALE), [Gender.FEMALE]: adviceFor(Gender.FEMALE) } as Record<
      Gender,
      CaptureAdvice
    >,
  };
}
