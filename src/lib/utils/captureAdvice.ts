/**
 * Capture or let go: the advice for one wild animal (#367).
 *
 * A capture starts a cooldown, stable space is small, and a wild animal's own
 * attributes are usually poor, so it is worth a capture only for what it
 * would pass on. Two things trigger a capture:
 *
 *  - **A pinned hunt allele** — the player pins the alleles they want from
 *    the hunt list, and the animal carries one the stable still lacks for
 *    its sex.
 *  - **A better parent** — across its stabled partners, its median foal has
 *    a higher expected total on the wanted attributes than the weakest
 *    stabled parent of its sex. It would earn the place of that animal, not beat the stable's best
 *    pair. One generation only: a wild animal's negatives weigh on its first
 *    foals, so this is a strict test.
 *
 * Everything else is shown as information, because with a small stable nearly
 * every animal brings something:
 *
 *  - **Needed** — a benefit allele the stable cannot breed: no stabled animal
 *    carries it, or, for a recessive, no stabled animal of this sex. These
 *    make the hunt list the pins are picked from.
 *  - **Never seen** — an allele no stabled animal carries, at a gene with an
 *    effect. The allele need not be a benefit.
 *  - **Quality** — its Quality, scored as if stabled, against the weakest
 *    stabled animal's.
 *
 * Pure: the service reads the stable and the templates and hands them in.
 */

import { Gender, GeneType } from '#lib/types/index.js';
import {
  type Allele,
  type BenefitSlot,
  benefitSlots,
  carries,
  isBreedGeneric,
  type ScoredGene,
  tallyAlleles,
  tallyFor,
} from '#lib/utils/geneticQuality.js';
import { compareGeneIds } from '#lib/utils/lociCodec.js';
import type { PetLoci } from '#lib/utils/petLoci.js';

/** A benefit allele the stable cannot breed, and who could bring it. */
export interface HuntTarget {
  geneId: string;
  allele: Allele;
  kind: BenefitSlot['kind'];
  attribute: string | null;
  generic: boolean;
  /**
   * The sexes that would bring it. A dominant benefit needs one parent, so
   * either sex will do; a recessive one needs a copy from each, so only the
   * sex that lacks it.
   */
  sexes: Gender[];
}

const BOTH: Gender[] = [Gender.MALE, Gender.FEMALE];

/**
 * Every benefit allele the stable cannot breed.
 *
 * A locus no stabled animal reads (`?` across the stable) is skipped: the
 * player's Genetics level has not revealed it, so it is unknown, not missing.
 * With `focusBreed`, only breed-generic loci and that breed's are listed — a
 * hunt is for the breed being bred.
 */
export function huntTargets(
  stable: Readonly<Record<Gender, readonly PetLoci[]>>,
  genes: Readonly<Record<string, ScoredGene>>,
  opts: { focusBreed?: string } = {},
): HuntTarget[] {
  const all = tallyAlleles([...stable[Gender.MALE], ...stable[Gender.FEMALE]]);
  const bySex = {
    [Gender.MALE]: tallyAlleles(stable[Gender.MALE]),
    [Gender.FEMALE]: tallyAlleles(stable[Gender.FEMALE]),
  };
  const out: HuntTarget[] = [];
  for (const geneId of [...all.keys()].sort(compareGeneIds)) {
    const gene = genes[geneId];
    if (!gene) continue;
    if (opts.focusBreed && !isBreedGeneric(gene) && gene.breed !== opts.focusBreed) continue;
    for (const slot of benefitSlots(gene)) {
      const lacking = (tally: ReturnType<typeof tallyFor>) =>
        (slot.allele === GeneType.DOMINANT ? tally.carD : tally.carR) === 0;
      const sexes =
        slot.allele === GeneType.DOMINANT
          ? lacking(tallyFor(all, geneId))
            ? BOTH
            : []
          : BOTH.filter((sex) => lacking(tallyFor(bySex[sex], geneId)));
      if (sexes.length === 0) continue;
      out.push({
        geneId,
        allele: slot.allele,
        kind: slot.kind,
        attribute: slot.attribute,
        generic: isBreedGeneric(gene),
        sexes,
      });
    }
  }
  return out;
}

/** Hunt targets at one allele of one gene: an allele can hold two benefits. */
export interface HuntAllele {
  geneId: string;
  allele: Allele;
  generic: boolean;
  sexes: Gender[];
  targets: HuntTarget[];
}

/**
 * The targets grouped by allele, in input order. On horse chromosome 01 one
 * `R` both adds Temperament and clears Virility−, and is still one allele to
 * look for.
 */
export function groupByAllele(targets: readonly HuntTarget[]): HuntAllele[] {
  const out = new Map<string, HuntAllele>();
  for (const t of targets) {
    const key = `${t.geneId}:${t.allele}`;
    const group = out.get(key);
    if (group) {
      group.targets.push(t);
      group.sexes = BOTH.filter((sex) => group.sexes.includes(sex) || t.sexes.includes(sex));
    } else {
      out.set(key, { geneId: t.geneId, allele: t.allele, generic: t.generic, sexes: [...t.sexes], targets: [t] });
    }
  }
  return [...out.values()];
}

/** The hunt targets this animal brings, for its sex or, unknown, for either. */
export function targetsSupplied(loci: PetLoci, sex: Gender | null, targets: readonly HuntTarget[]): HuntTarget[] {
  return targets.filter((t) => {
    const type = loci.get(t.geneId) as GeneType | undefined;
    return type !== undefined && carries(type, t.allele) && (sex === null || t.sexes.includes(sex));
  });
}

/** The key a pin is stored under, within one species. */
export function pinKey(geneId: string, allele: Allele): string {
  return `${geneId}:${allele}`;
}

/** The targets on the wanted attributes; an empty set wants every attribute. */
export function onAttributes(targets: readonly HuntTarget[], wanted: ReadonlySet<string>): HuntTarget[] {
  return wanted.size === 0 ? [...targets] : targets.filter((t) => t.attribute !== null && wanted.has(t.attribute));
}

/**
 * The animal as a parent against the weakest stabled parent of its sex.
 *
 * A parent's value is the median, over its stabled partners of the other sex,
 * of the expected attribute total of a foal. The median over partners, not the
 * best one: a parent is used with more than one partner, and one good match
 * says little about the rest. Within one pairing the foal total is a sum over
 * many independently inherited loci, so its median is close to its expected
 * value, which is what is used. In attribute points where the study
 * has measured effects, else in net effects (positives less negatives). The
 * breed's base values are the same for every pair, so the totals compare the
 * genetic part only.
 */
export interface BreedingComparison {
  unit: 'points' | 'effects';
  /** Its median foal over its partners, and how many partners. `null` with no partner to pair. */
  withIt: { total: number; partners: number } | null;
  /** The stabled animal of its sex whose median foal is worst. `null` when there is none. */
  weakest: { total: number; name: string } | null;
}

/** Whether the animal is a better parent than the weakest stabled one of its sex. */
export function breedsBetter(b: BreedingComparison): boolean {
  if (!b.withIt) return false;
  return b.weakest === null || b.withIt.total > b.weakest.total + 1e-9;
}

/** Information shown beside the advice. None of it triggers a capture. */
export type CaptureInfo =
  | { kind: 'needed'; targets: HuntTarget[] }
  | { kind: 'never-seen'; alleles: { geneId: string; allele: Allele }[] }
  | { kind: 'quality'; share: number; weakest: { id: number; name: string; share: number } };

export interface CaptureAdvice {
  /** True when it brings a pinned allele or breeds better foals. */
  capture: boolean;
  /** The pinned hunt targets it brings for its sex. */
  pinned: HuntTarget[];
  /** The breeding comparison, whether or not it triggers. `null` when nothing could be ranked. */
  breeding: BreedingComparison | null;
  info: CaptureInfo[];
}

export interface CaptureAdviceInput {
  /** Hunt targets the animal brings (`targetsSupplied`), on every attribute. */
  supplied: HuntTarget[];
  /** Pinned alleles, as `pinKey`s. */
  pins: ReadonlySet<string>;
  /** The attributes the player breeds for; empty for all. Filters `needed` only. */
  wanted: ReadonlySet<string>;
  /** Alleles it carries that no stabled animal carries, at genes with an effect. */
  neverSeen: { geneId: string; allele: Allele }[];
  /**
   * Its Quality share scored as if stabled, and the weakest stabled animal's
   * in the same scoring. `null` when the stable is too small for the score to
   * mean anything.
   */
  quality: { share: number; weakest: { id: number; name: string; share: number } } | null;
  breeding?: BreedingComparison | null;
}

export function captureAdvice({
  supplied,
  pins,
  wanted,
  neverSeen,
  quality,
  breeding = null,
}: CaptureAdviceInput): CaptureAdvice {
  const pinned = supplied.filter((t) => pins.has(pinKey(t.geneId, t.allele)));
  const info: CaptureInfo[] = [];
  // Each allele once, under the strongest heading it qualifies for.
  const listed = new Set(pinned.map((t) => pinKey(t.geneId, t.allele)));
  const needed = onAttributes(supplied, wanted).filter((t) => !listed.has(pinKey(t.geneId, t.allele)));
  if (needed.length > 0) info.push({ kind: 'needed', targets: needed });
  for (const t of supplied) listed.add(pinKey(t.geneId, t.allele));
  const unseen = neverSeen.filter((a) => !listed.has(pinKey(a.geneId, a.allele)));
  if (unseen.length > 0) info.push({ kind: 'never-seen', alleles: unseen });
  if (quality !== null) info.push({ kind: 'quality', share: quality.share, weakest: quality.weakest });
  const capture = pinned.length > 0 || (breeding !== null && breedsBetter(breeding));
  return { capture, pinned, breeding, info };
}
