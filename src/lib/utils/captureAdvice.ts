/**
 * Capture or let go: the advice for one wild animal (#367).
 *
 * A capture starts a cooldown before the next one, so capturing every wild
 * animal wastes it on animals the stable does not need. The advice reads the
 * wild animal against the stabled animals of its species and gives every
 * reason it found, so the player can overrule it knowingly:
 *
 *  - **Needed** — it carries a benefit allele the stable cannot breed: no
 *    stabled animal carries it, or, for a recessive, no stabled animal of
 *    this sex. These are the hunt targets, the alleles worth going out for.
 *  - **Never seen** — it carries an allele no stabled animal carries, at a
 *    gene with an effect. Weaker than needed: the allele need not be a
 *    benefit.
 *  - **Beats the weakest** — its Quality, scored as if it were stabled, is
 *    above that of the weakest stabled animal, which it could later replace.
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

/** One reason behind the advice. */
export type CaptureReason =
  | { kind: 'needed'; targets: HuntTarget[] }
  | { kind: 'never-seen'; alleles: { geneId: string; allele: Allele }[] }
  | { kind: 'beats-weakest'; share: number; weakest: { id: number; name: string; share: number } }
  | { kind: 'below-weakest'; share: number; weakest: { id: number; name: string; share: number } };

export interface CaptureAdvice {
  capture: boolean;
  /** For a capture, every reason to; for a let-go, why there is none. */
  reasons: CaptureReason[];
}

export interface CaptureAdviceInput {
  /** Hunt targets the animal brings (`targetsSupplied`). */
  supplied: HuntTarget[];
  /** Alleles it carries that no stabled animal carries, at genes with an effect. */
  neverSeen: { geneId: string; allele: Allele }[];
  /**
   * Its Quality share scored as if stabled, and the weakest stabled animal's
   * in the same scoring. `null` when the stable is too small for the score to
   * mean anything.
   */
  quality: { share: number; weakest: { id: number; name: string; share: number } } | null;
}

/** Capture when any reason holds; let go otherwise. */
export function captureAdvice({ supplied, neverSeen, quality }: CaptureAdviceInput): CaptureAdvice {
  const reasons: CaptureReason[] = [];
  if (supplied.length > 0) reasons.push({ kind: 'needed', targets: supplied });
  // A needed allele is never seen too; list it once, under the stronger reason.
  const neededKeys = new Set(supplied.map((t) => `${t.geneId}:${t.allele}`));
  const unseen = neverSeen.filter((a) => !neededKeys.has(`${a.geneId}:${a.allele}`));
  if (unseen.length > 0) reasons.push({ kind: 'never-seen', alleles: unseen });
  const beats = quality !== null && quality.share > quality.weakest.share;
  if (beats) reasons.push({ kind: 'beats-weakest', share: quality.share, weakest: quality.weakest });
  const capture = reasons.length > 0;
  if (!capture && quality !== null)
    reasons.push({ kind: 'below-weakest', share: quality.share, weakest: quality.weakest });
  return { capture, reasons };
}
