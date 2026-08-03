/**
 * Allele-frequency primitives for the gene rarity lens (#368).
 *
 * See `docs/design/gene-rarity-lens-v1.md`. The one idea this module
 * exists to enforce: **rarity is a property of an allele, not of a
 * displayed zygosity state.** The grid shows `D` / `R` / `x`, but `x` is
 * not a third value — it is one copy of each allele. Counting the three
 * displayed states as peers misreads a population in both directions: a
 * locus that is 20/22 mixed reports the recessive allele as *absent*
 * when it is one breeding step away in 20 pets.
 *
 * So every pet with a known reading contributes **two alleles**:
 * `D` → (D,D), `R` → (R,R), `x` → (D,R).
 *
 * Pure functions over already-loaded loci. No DB, no Svelte, no colour —
 * the service layer composes these with `loadAllPetLoci`, and the view
 * layer maps buckets to CSS custom properties.
 */

import { GeneType } from '$lib/types/index.js';
import type { PetLoci } from '$lib/utils/petLoci.js';

/** The two real alleles. `x` is one of each; `?` is missing data. */
export type Allele = typeof GeneType.DOMINANT | typeof GeneType.RECESSIVE;

/**
 * Per-locus counts over a population. Deliberately stores *pet* counts
 * rather than pre-divided frequencies: the colour needs a frequency, but
 * bucket 4 needs a carrier count and the tooltip needs the pure/mixed
 * breakdown, and all three derive from these four numbers.
 */
export interface LocusTally {
  /**
   * Pets with a **known** reading at this locus — never the population
   * size. A genome records what was visible when that pet was studied,
   * so a collection built while levelling Genetics holds pets revealed
   * to different depths and this varies per locus.
   */
  knownPets: number;
  /** Pets reading `D` (two dominant alleles each). */
  pureD: number;
  /** Pets reading `R` (two recessive alleles each). */
  pureR: number;
  /** Pets reading `x` (one of each). */
  mixed: number;
}

/** Number of ordinal rarity steps, common (0) → sole carrier (4). */
export const RARITY_LEVELS = 5;

/**
 * Frequency floors for buckets 0–2, descending. A frequency at or above
 * `RARITY_THRESHOLDS[i]` lands in bucket `i`; below the last one lands
 * in bucket 3. Bucket 4 is not a frequency — see `rarityBucket`.
 *
 * Calibrated against a real 37-Horse collection rather than guessed:
 * these produce ~13% of rendered halves taking any tint at all, with
 * roughly 7 cells per pet reaching the top step.
 */
export const RARITY_THRESHOLDS = [0.35, 0.18, 0.07] as const;

/**
 * Minimum known **alleles** (not pets) for a locus to be scored at all.
 * 4 = two pets with a known reading. Below this every present value is
 * trivially near-100% and "rare vs common" has no meaning, so the locus
 * renders as missing data alongside `?`.
 */
export const DEFAULT_MIN_KNOWN_ALLELES = 4;

/**
 * Minimum known **pets** before the sole-carrier step can fire.
 *
 * Without this gate bucket 4 fails the mirror of the problem it was
 * introduced to fix. "Only one carrier" is trivially true when there is
 * almost nobody to carry anything, so an ungated top step gets *louder*
 * as the baseline shrinks — measured at 0.36% of rendered halves at 30
 * pets but 2.7% at 5 and 7.1% at 3. Gating keeps the loudest colour
 * meaning "scarce across a population big enough to say so".
 */
export const SOLE_CARRIER_MIN_PETS = 10;

export interface RarityOptions {
  minKnownAlleles?: number;
  soleCarrierMinPets?: number;
}

const EMPTY_TALLY: LocusTally = { knownPets: 0, pureD: 0, pureR: 0, mixed: 0 };

/**
 * Tally every locus across a population.
 *
 * `?` contributes **nothing** — not to the numerator and not to the
 * denominator. It means the owner's Genetics level had not revealed
 * that gene when the pet was studied, so counting it would make
 * late-reveal loci (whole breeds' gene sets) read as spuriously rare.
 *
 * Loci absent from a pet's map are simply not counted for that pet;
 * there is no synthetic fill, so a locus only ever reflects pets that
 * actually have a reading for it.
 */
export function computeLocusFrequencies(byPet: Iterable<PetLoci>): Map<string, LocusTally> {
  const out = new Map<string, LocusTally>();
  for (const loci of byPet) {
    for (const [geneId, type] of loci) {
      if (type !== GeneType.DOMINANT && type !== GeneType.RECESSIVE && type !== GeneType.MIXED) {
        continue;
      }
      let tally = out.get(geneId);
      if (!tally) {
        tally = { knownPets: 0, pureD: 0, pureR: 0, mixed: 0 };
        out.set(geneId, tally);
      }
      tally.knownPets += 1;
      if (type === GeneType.DOMINANT) tally.pureD += 1;
      else if (type === GeneType.RECESSIVE) tally.pureR += 1;
      else tally.mixed += 1;
    }
  }
  return out;
}

/**
 * Frequency of one allele: copies of it over `2 × knownPets`.
 *
 * `frequency(D) + frequency(R) === 1` always holds, which is why the
 * lens is driven by one scalar per locus and why at most one allele can
 * sit below 50%.
 *
 * Returns 0 for an unmeasured locus; callers must gate on `isMeasurable`
 * rather than reading meaning into that.
 */
export function alleleFrequency(tally: LocusTally, allele: Allele): number {
  if (tally.knownPets === 0) return 0;
  const copies = allele === GeneType.DOMINANT ? 2 * tally.pureD + tally.mixed : 2 * tally.pureR + tally.mixed;
  return copies / (2 * tally.knownPets);
}

/**
 * Pets carrying at least one copy of an allele. A mixed pet carries
 * both, so it counts toward each — which is the point: it is the sole
 * source of a scarce recessive that no other pet has, and nothing else
 * in the app can show that (`x` expresses dominant).
 */
export function alleleCarriers(tally: LocusTally, allele: Allele): number {
  return allele === GeneType.DOMINANT ? tally.pureD + tally.mixed : tally.pureR + tally.mixed;
}

/** Whether a locus has enough known alleles to be scored at all. */
export function isMeasurable(tally: LocusTally, opts: RarityOptions = {}): boolean {
  const minKnown = opts.minKnownAlleles ?? DEFAULT_MIN_KNOWN_ALLELES;
  return 2 * tally.knownPets >= minKnown;
}

/**
 * Map a locus + allele onto an ordinal rarity step, 0 (common) → 4
 * (sole carrier). Returns `null` when the locus is below the minimum
 * sample and should render as missing data.
 *
 * **Bucket 4 is a carrier count, not a frequency, and is tested first.**
 * A fixed frequency floor is unreachable on small baselines — a single
 * mixed carrier sits at `1/(2N)`, so a `< 0.02` rule only ever fires
 * above 25 pets, i.e. the loudest step silently would not exist for most
 * players. Counting carriers also fixes an ordering wart: by frequency
 * alone a *pure* sole carrier (2 copies) reads as less rare than a
 * *mixed* one (1 copy), despite being the better breeding source.
 *
 * Consequence, deliberate: **the result is not monotonic in frequency.**
 * A sole carrier outranks a higher-frequency cell. Any property test
 * asserting monotonicity must hold `carriers` above 1 first.
 */
export function rarityBucket(tally: LocusTally, allele: Allele, opts: RarityOptions = {}): number | null {
  if (!isMeasurable(tally, opts)) return null;

  const carriers = alleleCarriers(tally, allele);

  // An allele NOBODY carries is absent, not scarce: there is nothing to
  // obtain, so it recedes to the common centre rather than screaming at the
  // rare end (frequency 0 would otherwise fall through to the lowest band).
  //
  // Unreachable in the per-pet view — the pet is always in its own population,
  // so a rendered cell is by construction a carrier — but the genome map has no
  // pet and scores every locus, where it is 12.9% of them.
  if (carriers === 0) return 0;

  const soleMin = opts.soleCarrierMinPets ?? SOLE_CARRIER_MIN_PETS;
  if (carriers === 1 && tally.knownPets >= soleMin) {
    return RARITY_LEVELS - 1;
  }

  const freq = alleleFrequency(tally, allele);
  for (let i = 0; i < RARITY_THRESHOLDS.length; i++) {
    if (freq >= RARITY_THRESHOLDS[i]) return i;
  }
  return RARITY_THRESHOLDS.length;
}

/** Convenience: the tally for a locus, or an all-zero tally if absent. */
export function tallyFor(tallies: Map<string, LocusTally>, geneId: string): LocusTally {
  return tallies.get(geneId) ?? EMPTY_TALLY;
}
