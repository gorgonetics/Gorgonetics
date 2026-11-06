/**
 * Attribute points: what a pairing is worth in the game's own units.
 *
 * Every breeding metric in the app *counts* positive effects, because the
 * gene table declares a direction and never a size. `attributeStudy`
 * recovers the sizes from the corpus; this module is the bridge between the
 * two, turning a study's findings into a lookup the scorers can read. With
 * it, a pairing carrying one `+5` gene outranks one carrying three `+1`s —
 * which counting cannot express.
 *
 * ## Partial knowledge is the whole difficulty
 *
 * The study knows a magnitude for roughly half the slots, and which half
 * depends on the corpus. Three rules keep that honest:
 *
 *  - **An unknown slot contributes nothing.** It is not imputed from the
 *    mean of the known ones. `attributeStudy` refuses to estimate a
 *    magnitude it cannot entail, and a scorer that quietly estimated one
 *    would undo that at the point where it reaches the player's decisions.
 *  - **Coverage travels with the number.** A points total over 7 of 9 slots
 *    is not comparable with one over 9 of 9, so `coverage` is reported per
 *    attribute and the UI is expected to show it. Two pairs are still
 *    ranked against each other fairly — they are scored over the same slot
 *    set — but the figure is a partial sum, and it is not a bound in either
 *    direction. Because both signs count (below), an unmeasured *negative*
 *    slot leaves the figure too high exactly as an unmeasured positive one
 *    leaves it too low.
 *  - **Both signs count.** A points figure is a net attribute change, so
 *    negative slots are in it. Summing positives only, in points units,
 *    would rank a pairing that adds `+5` and `-6` above one that adds `+4`.
 *
 * ## What a magnitude is worth trusting
 *
 * Findings enter the table whatever their tier: excluding `derived` ones
 * would halve coverage, and the study's own validation is run over both.
 * `depth`, `support` and `dissent` stay behind in the Study tab, which is
 * where a player goes to interrogate a number. This module answers a
 * narrower question — "how many points, as far as the corpus knows" — and a
 * scorer has nothing useful to do with a substitution chain's depth.
 *
 * ## Swings
 *
 * A swing gene (see `buildEffectSlots`) is measured only as the gap between
 * its two effects. The table puts the whole gap on the positive side and `0`
 * on the negative side, which is the negative effect folded into the base,
 * as the study folds it. That keeps every difference between animals exact
 * and makes both slots known, so coverage and lock weights treat the gene
 * like any other. How the gap really splits is not known and is not guessed
 * here: `swingSplits` offers an assumed split, and `withAssumedSplits` paints
 * it into a copy of the table for display. Neither ever reaches a scorer.
 *
 * Pure functions over an already-computed study. No DB, no Svelte.
 */

import type { AttributeStudy, Expression } from '#lib/utils/attributeStudy.js';
import { slotKey } from '#lib/utils/attributeStudy.js';
import { fromGeneId } from '#lib/utils/geneAnalysis.js';
import { capitalize } from '#lib/utils/string.js';

/** How much of one attribute's arithmetic the corpus has pinned down. */
export interface AttributeCoverage {
  /** Slots with a known magnitude. */
  known: number;
  /** Slots the gene table declares for this attribute, across every breed present. */
  total: number;
}

/**
 * Known effect sizes, and how complete that knowledge is.
 *
 * `points` is keyed by `slotKey` (`gene:expression`) rather than by
 * attribute, because that is what a scorer holds when it reaches a locus.
 * `coverage` is keyed by the **capitalised** attribute name, matching the
 * keys the breeding scorers and the UI use; `attributeStudy` works in the
 * lowercased names the gene table parses to, and converting here keeps that
 * seam in one place.
 */
export interface AttributeMagnitudes {
  points: ReadonlyMap<string, number>;
  coverage: ReadonlyMap<string, AttributeCoverage>;
  /**
   * Slots whose points are an assumed swing split, not a finding. Set only on
   * a display copy from `withAssumedSplits`; a scoring table never has it.
   */
  assumed?: ReadonlySet<string>;
}

/** No study has run, or it found nothing: every scorer falls back to counting. */
export const EMPTY_MAGNITUDES: AttributeMagnitudes = Object.freeze({
  points: new Map<string, number>(),
  coverage: new Map<string, AttributeCoverage>(),
});

/** Whether anything is known at all — the switch between points and counts. */
export function hasMagnitudes(magnitudes: AttributeMagnitudes): boolean {
  return magnitudes.points.size > 0;
}

/**
 * Collapse a study run into the lookup the scorers need.
 *
 * A slot appears at most once per attribute study, so the table cannot
 * disagree with itself. Where two studies of the same run name the same
 * slot — impossible for a well-formed gene table, since a slot declares one
 * attribute — the last one wins and nothing is silently averaged.
 */
export function buildAttributeMagnitudes(studies: readonly AttributeStudy[]): AttributeMagnitudes {
  const points = new Map<string, number>();
  const coverage = new Map<string, AttributeCoverage>();
  for (const study of studies) {
    for (const finding of study.findings) {
      if (finding.swing) {
        // `magnitude` is `recessive − dominant`: the whole gap on the positive
        // side, nothing on the negative one. See "Swings" above.
        points.set(slotKey({ gene: finding.gene, expression: 'recessive' }), Math.max(finding.magnitude, 0));
        points.set(slotKey({ gene: finding.gene, expression: 'dominant' }), Math.max(-finding.magnitude, 0));
      } else {
        points.set(slotKey(finding), finding.magnitude);
      }
    }
    const attribute = capitalize(study.attribute);
    const existing = coverage.get(attribute);
    // Attributes are studied once each, but a merge keeps this total
    // meaningful if a caller ever concatenates runs.
    coverage.set(attribute, {
      known: (existing?.known ?? 0) + study.findings.length,
      total: (existing?.total ?? 0) + study.slots,
    });
  }
  return { points, coverage };
}

/** Positive findings on a chromosome needed before their shared value splits a swing. */
const MIN_SPLIT_PEERS = 3;

/**
 * A swing finding shared out between the gene's two effects, for display.
 *
 * The corpus pins only the swing `recessive − dominant`; the split is an
 * assumption, not a finding. It is taken from the gene's chromosome: when
 * every known positive effect there has the same value, the swing's positive
 * side gets that value and the negative side the rest. Chromosome 01 is the
 * case this exists for — all its positives read `+5`.
 */
export interface SwingSplit {
  gene: string;
  swing: number;
  recessive: number;
  dominant: number;
  /** Positive findings on the chromosome that agree on the shared value. */
  peers: number;
}

/**
 * Split every swing finding whose chromosome supports it, keyed by gene.
 *
 * A swing gets no split when its chromosome's positives disagree, when too
 * few are known, or when the shared value would leave the negative side at
 * zero or above — a declared `-` is at least `-1`.
 *
 * For display only. The split is an assumption, and it can appear, change or
 * go when an import pins another positive on the chromosome, so it must stay
 * out of `buildAttributeMagnitudes`, whose table is cached on the promise that
 * an import only adds to it.
 */
export function swingSplits(studies: readonly AttributeStudy[]): Map<string, SwingSplit> {
  const swingGenes = new Set(studies.flatMap((study) => study.findings.filter((f) => f.swing).map((f) => f.gene)));
  return splitsOver(buildAttributeMagnitudes(studies).points, swingGenes);
}

/**
 * `swingSplits` read off a points table, which holds one entry per finding
 * and a swing as its gap (see "Swings" above), so the two give the same splits.
 */
function splitsOver(points: ReadonlyMap<string, number>, swingGenes: ReadonlySet<string>): Map<string, SwingSplit> {
  const positives = new Map<string, Set<number>>();
  const counts = new Map<string, number>();
  for (const [key, value] of points) {
    const gene = key.slice(0, key.indexOf(':'));
    if (swingGenes.has(gene) || value <= 0) continue;
    const chromosome = fromGeneId(gene)?.chromosome;
    if (!chromosome) continue;
    const values = positives.get(chromosome) ?? new Set<number>();
    values.add(value);
    positives.set(chromosome, values);
    counts.set(chromosome, (counts.get(chromosome) ?? 0) + 1);
  }
  const out = new Map<string, SwingSplit>();
  for (const gene of swingGenes) {
    const recessiveSide = points.get(slotKey({ gene, expression: 'recessive' }));
    const dominantSide = points.get(slotKey({ gene, expression: 'dominant' }));
    const chromosome = fromGeneId(gene)?.chromosome;
    if (recessiveSide === undefined || dominantSide === undefined || !chromosome) continue;
    const values = positives.get(chromosome);
    const peers = counts.get(chromosome) ?? 0;
    if (values?.size !== 1 || peers < MIN_SPLIT_PEERS) continue;
    const [shared] = values;
    const swing = recessiveSide - dominantSide;
    // `swing = recessive − dominant`, and the positive side is whichever
    // the swing's sign says.
    const recessive = swing > 0 ? shared : shared + swing;
    const dominant = recessive - swing;
    if (Math.min(recessive, dominant) >= 0) continue;
    out.set(gene, { gene, swing, recessive, dominant, peers });
  }
  return out;
}

/**
 * A display copy of a scoring table, with each swing shown as its assumed
 * split instead of the gap-and-zero the scorers read, and those slots listed
 * in `assumed`. Where the chromosome supports no split, the negative side is
 * left unknown rather than shown as a `0` nobody measured.
 *
 * Every difference between animals is the same in both tables, so a view
 * built on this agrees with the scores. It is still for painting only: the
 * split can change on import, which the scoring cache must not see.
 */
export function withAssumedSplits(
  magnitudes: AttributeMagnitudes,
  swingGenes: ReadonlySet<string>,
): AttributeMagnitudes {
  if (swingGenes.size === 0 || !hasMagnitudes(magnitudes)) return magnitudes;
  const splits = splitsOver(magnitudes.points, swingGenes);
  const points = new Map(magnitudes.points);
  const assumed = new Set<string>();
  for (const gene of swingGenes) {
    const recessiveKey = slotKey({ gene, expression: 'recessive' });
    const dominantKey = slotKey({ gene, expression: 'dominant' });
    const split = splits.get(gene);
    if (split) {
      points.set(recessiveKey, split.recessive);
      points.set(dominantKey, split.dominant);
      assumed.add(recessiveKey).add(dominantKey);
    } else if (points.has(recessiveKey) && points.has(dominantKey)) {
      // The zero side is the negative effect folded into the base.
      points.delete((points.get(recessiveKey) ?? 0) > 0 ? dominantKey : recessiveKey);
    }
  }
  return { ...magnitudes, points, assumed };
}

/** Signed points for one slot, or `undefined` where the corpus is silent. */
export function magnitudeOf(magnitudes: AttributeMagnitudes, gene: string, expression: Expression): number | undefined {
  return magnitudes.points.get(slotKey({ gene, expression }));
}

/** Coverage for one capitalised attribute; zeroes where nothing is known. */
export function coverageOf(magnitudes: AttributeMagnitudes, attribute: string): AttributeCoverage {
  return magnitudes.coverage.get(attribute) ?? { known: 0, total: 0 };
}
