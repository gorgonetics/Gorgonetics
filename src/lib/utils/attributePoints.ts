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
 *    set — but the figure is a floor on the true one, not the true one.
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
 * Pure functions over an already-computed study. No DB, no Svelte.
 */

import type { AttributeStudy, Expression } from '$lib/utils/attributeStudy.js';
import { slotKey } from '$lib/utils/attributeStudy.js';
import { capitalize } from '$lib/utils/string.js';

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
    for (const finding of study.findings) points.set(slotKey(finding), finding.magnitude);
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

/** Signed points for one slot, or `undefined` where the corpus is silent. */
export function magnitudeOf(magnitudes: AttributeMagnitudes, gene: string, expression: Expression): number | undefined {
  return magnitudes.points.get(slotKey({ gene, expression }));
}

/** Coverage for one capitalised attribute; zeroes where nothing is known. */
export function coverageOf(magnitudes: AttributeMagnitudes, attribute: string): AttributeCoverage {
  return magnitudes.coverage.get(attribute) ?? { known: 0, total: 0 };
}
