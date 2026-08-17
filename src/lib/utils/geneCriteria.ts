/**
 * Gene value criteria — the pure semantic core of the roster gene filter.
 *
 * A criterion is a set of allowed states over `{D, R, x}`; `?` is missing
 * data and never satisfies anything (a pet whose Genetics level hadn't
 * revealed a locus reads `?` there — that says nothing about the pet).
 * Two criterion kinds exist because an attribute resolves to ~86–155 loci
 * and a conjunction over those matches nothing, ever — so an attribute is
 * a count with a threshold instead.
 *
 * Pure: no Svelte, no DB. Expansion (which reads the parsed effect
 * columns) lives in `services/geneCriteriaService.ts`; this module only
 * evaluates. See docs/design/gene-value-filter-v1.md §2–§4, §7.
 */

import { GeneType } from '$lib/types/index.js';
import type { PetLoci } from '$lib/utils/petLoci.js';

/** A state a criterion can require — `?` is excluded at the type level (§3). */
export type KnownGeneType = Exclude<GeneType, typeof GeneType.UNKNOWN>;

/** Allowed states. A non-empty proper subset of {D, R, x} once normalised. */
export type AllowedStates = readonly KnownGeneType[];

/** How an attribute expansion wants the good allele held (§5a). */
export type AttributeWant = 'expresses' | 'carries' | 'pure';

export interface LocusCriterion {
  kind: 'locus';
  geneId: string;
  allow: AllowedStates;
}

export interface AttributeCriterion {
  kind: 'attribute';
  /** Capitalised attribute key, e.g. `Toughness` (matches `getAttributeConfig().attributes[].key`). */
  attribute: string;
  /** Kept for the chip label and re-expansion; the predicate only reads `loci`. */
  want: AttributeWant;
  /** Resolved from the parsed effect columns at expansion time and snapshotted (§11). */
  loci: readonly { geneId: string; allow: AllowedStates }[];
  /** Matched-count threshold; clamped to ≥ 1 at creation (§8). */
  min: number;
}

export type GeneCriterion = LocusCriterion | AttributeCriterion;

/** The whole gene filter: criteria are ANDed, scoped to one species (§5c). */
export interface GeneFilter {
  /** Canonical species key the criteria's gene ids belong to. */
  species: string;
  criteria: GeneCriterion[];
}

const ALL_STATES: readonly KnownGeneType[] = [GeneType.DOMINANT, GeneType.RECESSIVE, GeneType.MIXED];

/** All three real states — not a filter, it's the absence of one (§2). */
export function allowsEveryState(allow: AllowedStates): boolean {
  return ALL_STATES.every((s) => allow.includes(s));
}

/** Whether a pet's reading at one locus satisfies an allow set. `?`/absent never does. */
export function stateMatches(state: GeneType | undefined, allow: AllowedStates): boolean {
  if (state === undefined || state === GeneType.UNKNOWN) return false;
  return allow.includes(state);
}

/** Per-criterion evaluation detail, shared by the predicate, counts and exclusion classification. */
export interface AttributeEvaluation {
  /** Loci whose reading is in the allow set. */
  matched: number;
  /** Snapshot size — the shared denominator; unrevealed loci stay in it (§10). */
  total: number;
  /** Loci reading `?` or absent from the pet's projection. */
  unrevealed: number;
  satisfied: boolean;
}

/**
 * Evaluate an attribute criterion against one pet's loci. A vacuous
 * `min ≤ 0` reads as satisfied — the UI clamps to ≥ 1, this just keeps
 * the function total (§8).
 */
export function evaluateAttribute(criterion: AttributeCriterion, loci: PetLoci | undefined): AttributeEvaluation {
  let matched = 0;
  let unrevealed = 0;
  for (const locus of criterion.loci) {
    const state = loci?.get(locus.geneId);
    if (stateMatches(state, locus.allow)) matched++;
    else if (state === undefined || state === GeneType.UNKNOWN) unrevealed++;
  }
  return {
    matched,
    total: criterion.loci.length,
    unrevealed,
    satisfied: matched >= criterion.min,
  };
}

/** Whether one pet's loci satisfy every criterion (AND — §4). */
export function lociSatisfyCriteria(loci: PetLoci | undefined, criteria: readonly GeneCriterion[]): boolean {
  for (const criterion of criteria) {
    if (criterion.kind === 'locus') {
      if (!stateMatches(loci?.get(criterion.geneId), criterion.allow)) return false;
    } else if (!evaluateAttribute(criterion, loci).satisfied) {
      return false;
    }
  }
  return true;
}

/**
 * Per-attribute counts for the roster column (`Toughness 61/86`). Keyed by
 * attribute — at most one attribute criterion per attribute exists (§8).
 */
export function attributeMatchCounts(
  criteria: readonly GeneCriterion[],
  loci: PetLoci | undefined,
): Map<string, AttributeEvaluation> {
  const out = new Map<string, AttributeEvaluation>();
  for (const criterion of criteria) {
    if (criterion.kind !== 'attribute') continue;
    out.set(criterion.attribute, evaluateAttribute(criterion, loci));
  }
  return out;
}

/**
 * Why a pet is (or isn't) in the result. `not-revealed` means re-studying
 * the pet could still make it pass — for a locus criterion the pet reads
 * `?` there; for an attribute criterion `matched + unrevealed ≥ min` (§3).
 * `not-imported` is a pet with no projection at all — a different fix
 * ("upload/re-import") from "re-study" (§8). Total and disjoint, so
 * matches + not-revealed + no-match + not-imported = candidates (§10).
 */
export type GeneFilterVerdict = 'match' | 'not-revealed' | 'no-match' | 'not-imported';

export function classifyAgainstCriteria(
  loci: PetLoci | undefined,
  criteria: readonly GeneCriterion[],
  hasProjection: boolean,
): GeneFilterVerdict {
  if (!hasProjection) return 'not-imported';
  let couldStudyOut = false;
  for (const criterion of criteria) {
    if (criterion.kind === 'locus') {
      const state = loci?.get(criterion.geneId);
      if (stateMatches(state, criterion.allow)) continue;
      if (state === undefined || state === GeneType.UNKNOWN) couldStudyOut = true;
      else return 'no-match';
    } else {
      const ev = evaluateAttribute(criterion, loci);
      if (ev.satisfied) continue;
      if (ev.matched + ev.unrevealed >= criterion.min) couldStudyOut = true;
      else return 'no-match';
    }
  }
  return couldStudyOut ? 'not-revealed' : 'match';
}

/**
 * Normalise a criterion for storage: an all-states allow set is not a
 * filter and drops (§2); an attribute with no loci is not a criterion
 * (§8, the Ferocity case); `min` clamps to `[1, loci.length]`. An empty
 * allow set is kept — the UI disallows it, but it must not silently
 * become "any" (§8).
 */
export function normalizeCriterion(criterion: GeneCriterion): GeneCriterion | null {
  if (criterion.kind === 'locus') {
    return allowsEveryState(criterion.allow) ? null : criterion;
  }
  const loci = criterion.loci.filter((l) => !allowsEveryState(l.allow));
  if (loci.length === 0) return null;
  const min = Math.max(1, Math.min(criterion.min, loci.length));
  return { ...criterion, loci, min };
}
