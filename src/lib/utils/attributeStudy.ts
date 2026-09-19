/**
 * Attribute-effect inference: deriving *how much* each gene is worth.
 *
 * The gene data declares which attribute a gene touches and in which
 * direction (`"Temperament+"`), but never the size of the effect. Every
 * score in the app therefore *counts* positives instead of adding them up.
 * This module recovers the missing magnitudes from a corpus of observed
 * animals, so a positive can eventually be worth its actual points.
 *
 * ## Why this is a deduction, not a fit
 *
 * The game's arithmetic is exact: an attribute is an integer, each active
 * effect moves it by a fixed integer, and a declared `+` is at least `+1`.
 * So this is a system of equations with integer unknowns, not a regression.
 * A finding is either *entailed by the corpus* or it is not; there is no
 * confidence interval hiding a guess. Where the corpus does not entail a
 * magnitude we say so rather than estimating one.
 *
 * ## The two ideas that make it tractable
 *
 * **Project onto one attribute.** Two animals almost never share a whole
 * genome, but they frequently agree on every locus that touches *one*
 * attribute. Matching on that projection — not the genome — is what turns
 * an impossible search into a cheap one. The same pair usually yields a
 * finding for several attributes at once, each from a different projection.
 *
 * **Difference, don't solve.** An observed value is `base + Σ effects`, and
 * `base` is unknown. Subtracting two same-breed animals cancels it, so the
 * unknown base never has to be determined and cross-breed base differences
 * (if any exist) cannot contaminate a finding. Every equation here is a
 * difference for that reason.
 *
 * ## Two tiers of finding, which must not be confused
 *
 * A pair differing at exactly one slot yields that slot's magnitude
 * outright — this is the `direct` tier, and it is as certain as the corpus.
 * Substituting known magnitudes into wider pairs then leaves a single
 * unknown and pins that too (`derived`), which roughly doubles the yield.
 * But a derived finding inherits every error upstream of it, so `depth` and
 * `support` travel with each finding and the UI is expected to show them.
 * Collapsing the two tiers into one number would launder a chain of
 * substitutions into the same object as a value 200 pairs agree on.
 *
 * ## Disagreement is data
 *
 * A slot whose pairs disagree is not noise to average away — the model
 * forbids it. Either the model is wrong or an animal's attributes are
 * mis-recorded, and the second is overwhelmingly more common. So the
 * majority value wins and every dissenting animal is named in
 * `contradictions`, which in practice is a list of bad rows. Averaging
 * here would destroy the corpus's only self-check.
 *
 * `validate` supplies the other check: it predicts pairs that differ at
 * two or more *already-known* slots — equations no finding was derived
 * from — and reports how many land exactly. That number is the engine's
 * health, and it belongs on screen.
 */

import { type GeneEffectData, parseEffect } from './geneAnalysis.js';

/** Lowest and highest value the game will display for an attribute. */
export const ATTRIBUTE_FLOOR = 0;
export const ATTRIBUTE_CEILING = 100;

/**
 * Which allele state expresses an effect. `dominant` covers both `D` and a
 * mixed `x`: per the game, a mixed locus expresses exactly as a dominant
 * one and differs only in what it breeds. There is therefore no separate
 * `x` magnitude to solve for.
 */
export type Expression = 'dominant' | 'recessive';

/** One unknown: what a single gene's effect is worth on a single attribute. */
export interface EffectSlot {
  gene: string;
  expression: Expression;
  /** Lowercased attribute name, matching `parseEffect`. */
  attribute: string;
  sign: 1 | -1;
  /** Owning breed, or `''` for a gene that applies to every breed. */
  breed: string;
}

/** An animal the corpus can learn from. */
export interface StudySubject {
  id: string;
  breed: string;
  /** Gene id to allele state (`D` | `R` | `x` | `?`). */
  genes: Record<string, string>;
  /** Lowercased attribute name to observed value. */
  attributes: Record<string, number>;
}

export type FindingTier = 'direct' | 'derived';

export interface StudyFinding {
  gene: string;
  expression: Expression;
  attribute: string;
  /** Signed integer points this effect moves the attribute by. */
  magnitude: number;
  tier: FindingTier;
  /** 0 for `direct`; substitution rounds needed otherwise. */
  depth: number;
  /** Independent equations yielding `magnitude`. */
  support: number;
  /** Independent equations yielding something else. */
  dissent: number;
  /** A few subject-id pairs that witness the finding, for "show the work". */
  witnesses: Array<[string, string]>;
}

/** An animal whose readings conflict with an otherwise-agreed magnitude. */
export interface StudyContradiction {
  subjectId: string;
  /** How many dissenting equations this animal took part in. */
  count: number;
}

export interface ValidationReport {
  /** Equations tested, all of which differ at 2+ known slots. */
  tested: number;
  /** Equations whose predicted difference matched the observed one. */
  exact: number;
}

export interface AttributeStudy {
  attribute: string;
  /** Unknowns in scope for this attribute across every breed present. */
  slots: number;
  findings: StudyFinding[];
  contradictions: StudyContradiction[];
  validation: ValidationReport;
  /** Subjects that contributed at least one equation. */
  contributors: number;
}

export interface StudyOptions {
  /**
   * Widest pair difference to turn into an equation. Pairs beyond this are
   * ignored: they are plentiful but each carries many unknowns, so they
   * cost quadratic time and almost never resolve. 6 spans every difference
   * substitution has been observed to close.
   */
  maxDistance?: number;
  /** Witness pairs retained per finding. Kept small; this is for display. */
  maxWitnesses?: number;
}

const DEFAULT_MAX_DISTANCE = 6;
const DEFAULT_MAX_WITNESSES = 3;

/** Stable key for a slot. */
export function slotKey(slot: Pick<EffectSlot, 'gene' | 'expression'>): string {
  return `${slot.gene}:${slot.expression}`;
}

/**
 * Derive every unknown from the gene reference data.
 *
 * A locus contributes up to two slots — its dominant and its recessive
 * effect are unrelated quantities and may even land on different
 * attributes, so they are never solved as one.
 */
export function buildEffectSlots(effectsDB: Record<string, GeneEffectData>): EffectSlot[] {
  const slots: EffectSlot[] = [];
  for (const [gene, data] of Object.entries(effectsDB)) {
    for (const [expression, raw] of [
      ['dominant', data.effectDominant],
      ['recessive', data.effectRecessive],
    ] as Array<[Expression, string]>) {
      const parsed = parseEffect(raw);
      if (!parsed) continue;
      slots.push({
        gene,
        expression,
        attribute: parsed.attribute,
        sign: parsed.sign === '+' ? 1 : -1,
        breed: data.breed ?? '',
      });
    }
  }
  return slots;
}

/** Group slots by attribute so each attribute is solved on its own. */
export function slotsByAttribute(slots: readonly EffectSlot[]): Map<string, EffectSlot[]> {
  const out = new Map<string, EffectSlot[]>();
  for (const slot of slots) {
    const list = out.get(slot.attribute);
    if (list) list.push(slot);
    else out.set(slot.attribute, [slot]);
  }
  return out;
}

/** Whether `state` expresses `expression`. A mixed `x` expresses as dominant. */
function expresses(state: string | undefined, expression: Expression): boolean {
  if (expression === 'recessive') return state === 'R';
  return state === 'D' || state === 'x';
}

/**
 * Slots a subject has switched on for one attribute.
 *
 * Returns null when any relevant locus is unrevealed: a `?` is study-time
 * visibility, not a known-absent allele, so its contribution is an extra
 * unknown that would silently corrupt the equation. Such a subject sits
 * out this attribute — and only this one, since its other projections may
 * still be fully revealed.
 */
export function activeSlots(subject: StudySubject, attributeSlots: readonly EffectSlot[]): Set<string> | null {
  const active = new Set<string>();
  for (const slot of attributeSlots) {
    if (slot.breed && slot.breed !== subject.breed) continue;
    const state = subject.genes[slot.gene];
    if (state === undefined || state === '?') return null;
    if (expresses(state, slot.expression)) active.add(slotKey(slot));
  }
  return active;
}

/** A difference equation: `Σ coefficient × magnitude = delta`. */
interface Equation {
  /** Slot key to +1 (present in the left subject) or -1 (in the right). */
  terms: Map<string, 1 | -1>;
  delta: number;
  left: string;
  right: string;
}

interface Observation {
  subject: StudySubject;
  active: Set<string>;
  value: number;
}

/**
 * An observation is usable only if the reading is a measurement.
 *
 * A value at the floor or the ceiling has been clamped, so it reports a
 * bound rather than a sum and cannot be differenced into an equality.
 * Those subjects are dropped here; a later tier can reintroduce them as
 * inequalities.
 */
function isMeasured(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && value > ATTRIBUTE_FLOOR && value < ATTRIBUTE_CEILING;
}

function buildEquations(observations: readonly Observation[], maxDistance: number): Equation[] {
  const equations: Equation[] = [];
  for (let i = 0; i < observations.length; i++) {
    const a = observations[i];
    for (let j = i + 1; j < observations.length; j++) {
      const b = observations[j];
      // Sizes bound the symmetric difference, so this rejects most pairs
      // before touching their contents.
      if (Math.abs(a.active.size - b.active.size) > maxDistance) continue;
      const terms = new Map<string, 1 | -1>();
      let over = false;
      for (const key of a.active) {
        if (!b.active.has(key)) {
          terms.set(key, 1);
          if (terms.size > maxDistance) {
            over = true;
            break;
          }
        }
      }
      if (over) continue;
      for (const key of b.active) {
        if (!a.active.has(key)) {
          terms.set(key, -1);
          if (terms.size > maxDistance) {
            over = true;
            break;
          }
        }
      }
      if (over || terms.size === 0) continue;
      equations.push({
        terms,
        delta: a.value - b.value,
        left: a.subject.id,
        right: b.subject.id,
      });
    }
  }
  return equations;
}

/** Candidate magnitudes for one slot, with the pairs that implied each. */
type Tally = Map<number, Array<[string, string]>>;

function tallyFor(map: Map<string, Tally>, key: string): Tally {
  let tally = map.get(key);
  if (!tally) {
    tally = new Map();
    map.set(key, tally);
  }
  return tally;
}

function record(tally: Tally, magnitude: number, pair: [string, string]): void {
  const list = tally.get(magnitude);
  if (list) list.push(pair);
  else tally.set(magnitude, [pair]);
}

/** The value with the most independent backing, ties broken by magnitude. */
function majority(tally: Tally): { magnitude: number; support: number; dissent: number } {
  let best = 0;
  let bestCount = -1;
  let total = 0;
  for (const [magnitude, pairs] of tally) {
    total += pairs.length;
    if (pairs.length > bestCount || (pairs.length === bestCount && magnitude < best)) {
      best = magnitude;
      bestCount = pairs.length;
    }
  }
  return { magnitude: best, support: bestCount, dissent: total - bestCount };
}

/**
 * Solve one attribute.
 *
 * Seeds from single-difference pairs, then substitutes to a fixpoint. Each
 * round only accepts slots that are the *sole* remaining unknown in some
 * equation, which is what keeps every finding an entailment rather than an
 * estimate.
 */
export function studyAttribute(
  subjects: readonly StudySubject[],
  attribute: string,
  attributeSlots: readonly EffectSlot[],
  options: StudyOptions = {},
): AttributeStudy {
  const maxDistance = options.maxDistance ?? DEFAULT_MAX_DISTANCE;
  const maxWitnesses = options.maxWitnesses ?? DEFAULT_MAX_WITNESSES;

  // Equations only cancel the unknown base within a breed, so subjects are
  // never paired across breeds.
  const byBreed = new Map<string, Observation[]>();
  for (const subject of subjects) {
    const value = subject.attributes[attribute];
    if (!isMeasured(value)) continue;
    const active = activeSlots(subject, attributeSlots);
    if (!active) continue;
    const list = byBreed.get(subject.breed);
    if (list) list.push({ subject, active, value });
    else byBreed.set(subject.breed, [{ subject, active, value }]);
  }

  const equations: Equation[] = [];
  let contributors = 0;
  for (const observations of byBreed.values()) {
    contributors += observations.length;
    equations.push(...buildEquations(observations, maxDistance));
  }

  const signOf = new Map<string, 1 | -1>();
  for (const slot of attributeSlots) signOf.set(slotKey(slot), slot.sign);

  const solved = new Map<string, StudyFinding>();
  const dissenters = new Map<string, number>();

  const commit = (key: string, tally: Tally, tier: FindingTier, depth: number): void => {
    const { magnitude, support, dissent } = majority(tally);
    // The declared direction is an independent fact about the gene, never
    // an input to the arithmetic. A magnitude that contradicts it means the
    // slot is not entailed after all, so it is dropped rather than shown.
    const sign = signOf.get(key);
    if (sign !== undefined && magnitude * sign <= 0) return;
    for (const [value, pairs] of tally) {
      if (value === magnitude) continue;
      for (const [left, right] of pairs) {
        dissenters.set(left, (dissenters.get(left) ?? 0) + 1);
        dissenters.set(right, (dissenters.get(right) ?? 0) + 1);
      }
    }
    const [gene, expression] = key.split(':') as [string, Expression];
    solved.set(key, {
      gene,
      expression,
      attribute,
      magnitude,
      tier,
      depth,
      support,
      dissent,
      witnesses: (tally.get(magnitude) ?? []).slice(0, maxWitnesses),
    });
  };

  const direct = new Map<string, Tally>();
  for (const equation of equations) {
    if (equation.terms.size !== 1) continue;
    const [key, coefficient] = [...equation.terms][0];
    record(tallyFor(direct, key), equation.delta * coefficient, [equation.left, equation.right]);
  }
  for (const [key, tally] of direct) commit(key, tally, 'direct', 0);

  for (let depth = 1; ; depth++) {
    const candidates = new Map<string, Tally>();
    for (const equation of equations) {
      let unknown: string | null = null;
      let coefficient: 1 | -1 = 1;
      let residual = equation.delta;
      let solvable = true;
      for (const [key, sign] of equation.terms) {
        const known = solved.get(key);
        if (known) {
          residual -= sign * known.magnitude;
        } else if (unknown === null) {
          unknown = key;
          coefficient = sign;
        } else {
          solvable = false;
          break;
        }
      }
      if (!solvable || unknown === null) continue;
      record(tallyFor(candidates, unknown), residual * coefficient, [equation.left, equation.right]);
    }
    let added = 0;
    for (const [key, tally] of candidates) {
      if (solved.has(key)) continue;
      const before = solved.size;
      commit(key, tally, 'derived', depth);
      if (solved.size > before) added++;
    }
    if (added === 0) break;
  }

  return {
    attribute,
    slots: attributeSlots.length,
    findings: [...solved.values()].sort(
      (a, b) => a.depth - b.depth || b.support - a.support || a.gene.localeCompare(b.gene),
    ),
    contradictions: [...dissenters.entries()]
      .map(([subjectId, count]) => ({ subjectId, count }))
      .sort((a, b) => b.count - a.count),
    validation: validate(equations, solved),
    contributors,
  };
}

/**
 * Score the findings against equations none of them came from.
 *
 * Only pairs differing at two or more solved slots are used: a
 * single-difference pair is the very equation its finding was read off, so
 * scoring against it would be circular.
 */
function validate(equations: readonly Equation[], solved: ReadonlyMap<string, StudyFinding>): ValidationReport {
  let tested = 0;
  let exact = 0;
  for (const equation of equations) {
    if (equation.terms.size < 2) continue;
    let predicted = 0;
    let complete = true;
    for (const [key, sign] of equation.terms) {
      const finding = solved.get(key);
      if (!finding) {
        complete = false;
        break;
      }
      predicted += sign * finding.magnitude;
    }
    if (!complete) continue;
    tested++;
    if (predicted === equation.delta) exact++;
  }
  return { tested, exact };
}

/** Run every attribute present in `slots`. */
export function studyAll(
  subjects: readonly StudySubject[],
  slots: readonly EffectSlot[],
  options: StudyOptions = {},
): AttributeStudy[] {
  const grouped = slotsByAttribute(slots);
  return [...grouped.entries()]
    .map(([attribute, attributeSlots]) => studyAttribute(subjects, attribute, attributeSlots, options))
    .sort((a, b) => a.attribute.localeCompare(b.attribute));
}
