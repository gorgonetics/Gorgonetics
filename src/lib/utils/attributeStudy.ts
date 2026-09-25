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
 * cannot contaminate a finding. Every equation here is a difference for that
 * reason. The bases are recovered afterwards, per animal, from the solved
 * magnitudes — see `inferBaselines` — and they do differ by breed.
 *
 * ## Three tiers of finding, which must not be confused
 *
 * A pair differing at exactly one slot yields that slot's magnitude
 * outright — this is the `direct` tier, and it is as certain as the corpus.
 * Substituting known magnitudes into wider pairs then leaves a single
 * unknown and pins that too (`derived`), which roughly doubles the yield.
 * What substitution cannot reach, elimination often can: a slot no one
 * equation isolates may still be forced by several together (`system`, see
 * `determinedSlots`), which roughly doubles the yield again.
 *
 * A derived finding inherits every error upstream of it, so `depth` and
 * `support` travel with each finding and the UI is expected to show them.
 * Collapsing the tiers into one number would launder a chain of
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
const ATTRIBUTE_FLOOR = 0;
const ATTRIBUTE_CEILING = 100;

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
  /**
   * Whether the player can go and re-read this animal's attributes.
   *
   * Only a stabled animal can be checked against the game, which makes it
   * the one kind of evidence a disagreement can be *settled* with. It says
   * nothing about whether the reading is right — an unstabled record is
   * just as likely to be correct, only unfalsifiable.
   */
  stabled?: boolean;
  /**
   * The group whose base this animal reads, when it is not `breed`.
   *
   * `breed` is the pairing pool, and a species paired as one pool (beewasps)
   * has an empty one. Its animals still have a recorded breed, and whether
   * those breeds share one base is an open question the baselines answer —
   * so they are grouped by this, not by the pool. Defaults to `breed`.
   */
  baselineGroup?: string;
}

/**
 * What the corpus entails about one breed's base for one attribute.
 *
 * The base is the value before any gene effect. It is read off animals, not
 * pairs: once every magnitude an animal expresses is known, `value − Σ
 * magnitudes` is its breed's base. Usually some expressed slot is still
 * unknown, and often it is one that *every* animal of the breed expresses —
 * such a slot never differs between two animals, so no difference can
 * separate it from the base. What the corpus pins then is the lump
 * `base + Σ unresolved`, and that is what `value` holds.
 *
 * Nothing bounds the base itself. The displayed attribute is clamped to
 * 0–100, but the base sits under the effects, and on the live corpus a
 * Kurbone's temperament base is at most −36.
 */
export interface BaselineReading {
  /** The baseline group, normally the breed. */
  breed: string;
  /** `base + Σ unresolved`. The base itself when `unresolved` is empty. */
  value: number;
  /** Expressed slots still unknown, as sorted `slotKey`s. */
  unresolved: string[];
  /**
   * Bounds on the base itself, from the declared signs of `unresolved`.
   *
   * A declared `+` is worth at least `+1`, so when every unresolved slot is
   * positive the base is at most `value − |unresolved|`, and symmetrically
   * for negatives. A mix bounds nothing: no magnitude has an upper limit.
   * Both equal `value` when the base is exact. Rests on the declarations,
   * which the study can dispute, so a doubted sign weakens it.
   */
  min: number | null;
  max: number | null;
  /** Animals reading `value`. */
  support: number;
  /** Animals with the same unresolved set reading something else. */
  dissent: number;
  /** Dissenting animals: each is mis-recorded or sits on a wrong magnitude. */
  dissenters: string[];
  /** A few supporting animals, for "show the work". */
  witnesses: string[];
}

/**
 * The exact gap between two breeds' bases.
 *
 * Two breeds whose animals leave the *same* slots unresolved read lumps that
 * differ only by their bases, so the gap is exact even when neither base is.
 * For a species paired as one pool this is the test of that pooling: a gap
 * of zero is what sharing a base predicts, and anything else falsifies it.
 */
export interface BaselineOffset {
  breed: string;
  relativeTo: string;
  /** `base(breed) − base(relativeTo)`. */
  offset: number;
  /** Unresolved sets shared by both breeds that give this offset. */
  support: number;
  /** Shared unresolved sets giving another offset. */
  dissent: number;
  /** Distinct animals behind the supporting sets, on both sides. */
  animals: number;
}

export interface AttributeBaselines {
  /**
   * Per breed, the reading most animals agree on, then the one leaving fewest
   * slots unresolved. Backing comes first: a single animal can leave fewer
   * slots unresolved than the other 240 of its breed, and one mis-recorded
   * reading must not become the breed's base.
   */
  readings: BaselineReading[];
  offsets: BaselineOffset[];
}

/**
 * How certain a finding is, and each tier must stay distinguishable.
 *
 *  - `direct` — a pair differing at exactly one slot. As certain as the
 *    corpus.
 *  - `derived` — substitution left a single unknown. Inherits every error
 *    upstream of it, which is what `depth` records.
 *  - `system` — the slot was not the sole unknown in any one equation, but
 *    the equations *together* determine it. Entailed exactly as a `direct`
 *    finding is, and not a fit: see `determinedSlots`.
 */
export type FindingTier = 'direct' | 'derived' | 'system';

export interface StudyFinding {
  gene: string;
  expression: Expression;
  attribute: string;
  /** Signed integer points this effect moves the attribute by. */
  magnitude: number;
  tier: FindingTier;
  /** 0 for `direct`; substitution rounds needed otherwise. */
  depth: number;
  /**
   * Independent equations yielding `magnitude` — except for `system`, where
   * it is the equations that *mention* the slot.
   *
   * The difference matters and the UI must not flatten it: a `direct`
   * support of 4 is four separate confirmations, a `system` support of 4 is
   * four equations that jointly leave one answer and individually confirm
   * nothing.
   */
  support: number;
  /** Independent equations yielding something else. */
  dissent: number;
  /** A few subject-id pairs that witness the finding, for "show the work". */
  witnesses: Array<[string, string]>;
}

/**
 * Why the corpus doubts a gene's declared effect.
 *
 *  - `contradicts-sign` — the animals consistently move the attribute the
 *    other way. A `+` that reads `-4` is a transcription slip, not a
 *    surprise about the game.
 *  - `no-effect` — an effect is declared, but animals carrying it are
 *    indistinguishable from those that do not. The locus probably belongs
 *    to another attribute, or to none.
 *  - `unstable` — pairs disagree, and no single animal accounts for the
 *    disagreement. One bad reading shows up as one repeat offender; when
 *    the dissent is spread across many animals instead, the thing they
 *    have in common is the declaration.
 *  - `non-integer` — the equations determine this slot, but to a fraction.
 *    The game's arithmetic is integral, so this cannot be a real magnitude:
 *    some animal in the subsystem is mis-recorded. Only a subsystem solve
 *    can raise this, because it is the only tier that combines enough
 *    equations to contradict integrality.
 */
export type GeneDoubtReason = 'contradicts-sign' | 'no-effect' | 'unstable' | 'non-integer';

/**
 * A gene whose declared effect the corpus disputes.
 *
 * The gene table is hand-entered, so it is evidence like any other and can
 * be wrong. These are the slots where the animals and the declaration
 * disagree — each one a specific, checkable question to put to the game,
 * not a vague warning.
 */
export interface GeneDoubt {
  gene: string;
  expression: Expression;
  attribute: string;
  /** The declared direction, `+1` or `-1`. */
  declared: 1 | -1;
  /** What the animals imply instead. Zero means no effect was detectable. */
  observed: number;
  reason: GeneDoubtReason;
  /** Equations behind `observed`. */
  support: number;
  /** Equations implying something else again. */
  dissent: number;
  /** Distinct animals involved, so a wide disagreement can be told from a narrow one. */
  animals: number;
  /** At least one witness pair is stabled on both sides, so this is settleable now. */
  checkable: boolean;
  witnesses: Array<[string, string]>;
}

/** An animal whose readings conflict with an otherwise-agreed magnitude. */
export interface StudyContradiction {
  subjectId: string;
  /** How many dissenting equations this animal took part in. */
  count: number;
  /** Stabled, so the player can settle this by re-reading the animal. */
  stabled: boolean;
}

export interface ValidationReport {
  /** Equations tested, all of which differ at 2+ known slots. */
  tested: number;
  /** Equations whose predicted difference matched the observed one. */
  exact: number;
  /**
   * The same score over equations whose *both* animals are stabled.
   *
   * This is the figure to trust. The headline score is computed over
   * readings nobody can confirm, so a shortfall in it is ambiguous — bad
   * data and a bad model look identical. Restricted to animals the player
   * can re-read, a shortfall is a claim they can go and falsify, and a
   * clean score is evidence the model holds rather than a hope.
   */
  stabledTested: number;
  stabledExact: number;
  /**
   * Animals that appear in failing predictions, worst first.
   *
   * The model forbids disagreement, so a failed prediction is not noise to
   * tolerate — it names two animals, one of which is almost certainly
   * mis-recorded. Without this the score says only *that* the corpus is
   * imperfect; these say *who*, which is the only form of it anyone can act
   * on.
   */
  suspects: ValidationSuspect[];
}

/**
 * An animal implicated in failing predictions.
 *
 * The distinguishing evidence is `offset`. One mis-typed attribute shifts
 * that animal's value by a constant, so every equation it appears in is
 * wrong by the *same amount* — measured on the live corpus, the large error
 * clusters trace to a single animal at 100%. An animal whose failures are
 * scattered across many different offsets is a different problem, most
 * likely an ordinary participant in someone else's bad pairing.
 */
export interface ValidationSuspect {
  subjectId: string;
  /** Failing predictions this animal takes part in. */
  failures: number;
  /** The error this animal is most often wrong by. */
  offset: number;
  /** Share of its failures at that offset; near 1 means one bad reading. */
  offsetShare: number;
  /**
   * Every error size seen, and how often — `[error, count]` pairs.
   *
   * Carried so that pooling across attributes can recompute `offset` and
   * `offsetShare` from the whole picture. Taking one attribute's share and
   * pairing it with a total counted across all of them would report, say,
   * 100% agreement over 4 failures while quietly summing 7.
   */
  offsets: Array<[number, number]>;
}

export interface AttributeStudy {
  attribute: string;
  /** Unknowns in scope for this attribute across every breed present. */
  slots: number;
  findings: StudyFinding[];
  contradictions: StudyContradiction[];
  /** Declared effects the corpus disputes, most-supported first. */
  geneDoubts: GeneDoubt[];
  validation: ValidationReport;
  /** Subjects that contributed at least one equation. */
  contributors: number;
  baselines: AttributeBaselines;
}

export interface StudyOptions {
  /**
   * Widest pair difference to turn into an equation. Pairs beyond this are
   * ignored: they are plentiful but each carries many unknowns, so they
   * cost quadratic time and almost never resolve. 6 spans every difference
   * substitution has been observed to close.
   */
  maxDistance?: number;
  /**
   * Slots the player has checked in the game and found correctly declared,
   * as `slotKey`s.
   *
   * A doubt names two possible culprits — the hand-entered gene table, or an
   * animal's recorded attributes — and the engine cannot tell them apart.
   * Only a trip into the game can. When the player comes back and says the
   * declaration stands, the disagreement has to be the animals', so the slot
   * stops being re-recommended and every animal behind the dispute is named
   * in `contradictions` instead.
   *
   * Confirming does not publish a magnitude. The arithmetic still disagrees
   * with the declaration; what changed is who is at fault, not what the
   * corpus entails.
   */
  confirmedSlots?: ReadonlySet<string>;
}

/**
 * Whether the pairs behind a doubt need more than one bad animal to explain.
 *
 * A doubt sends the player into the game to check a gene, so a false one
 * costs them a trip. Counting *pairs* does not protect against that: three
 * sound animals and one mis-typed one produce three pairs that all agree on
 * the same wrong magnitude, with no dissent at all. What matters is whether
 * a single animal could be behind the lot — so intersect the pairs, and
 * accept the doubt only when nothing is common to all of them.
 *
 * That subsumes any minimum count: a single pair always has both its
 * animals in common with itself, so one equation can never raise a doubt.
 *
 * The cost is real — a genuinely mis-entered gene witnessed only through
 * one animal stays hidden until the corpus grows. A panel that cries wolf
 * at small corpus sizes is one the player learns to ignore, which is worse.
 *
 * `unstable` is exempt: it already requires dissent no single animal
 * accounts for, which is this same test by another route.
 */
function needsTwoMistakes(pairs: ReadonlyArray<readonly [string, string]>): boolean {
  if (pairs.length === 0) return false;
  let common: Set<string> | null = null;
  for (const [left, right] of pairs) {
    if (common === null) {
      common = new Set([left, right]);
      continue;
    }
    for (const id of [...common]) if (id !== left && id !== right) common.delete(id);
    if (common.size === 0) return true;
  }
  return (common?.size ?? 0) === 0;
}

const DEFAULT_MAX_DISTANCE = 6;
/** Witness pairs retained per finding. Kept small; this is for display. */
const MAX_WITNESSES = 3;

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

/**
 * Exact rational arithmetic, on `BigInt` so nothing rounds.
 *
 * Integrality is this module's correctness check — a determined slot that
 * lands on a fraction is proof of a mis-recorded animal — so computing it in
 * floating point would undermine the one thing it exists to establish. The
 * systems are a few hundred rows with ±1 starting coefficients, so exactness
 * is cheap here.
 */
interface Frac {
  n: bigint;
  /** Always positive, and the fraction is always reduced. */
  d: bigint;
}

function gcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y) [x, y] = [y, x % y];
  return x;
}

function frac(n: bigint, d: bigint = 1n): Frac {
  if (d === 0n) throw new Error('frac: zero denominator');
  const sign = d < 0n ? -1n : 1n;
  const nn = n * sign;
  const dd = d * sign;
  const g = gcd(nn, dd) || 1n;
  return { n: nn / g, d: dd / g };
}

const fSub = (a: Frac, b: Frac): Frac => frac(a.n * b.d - b.n * a.d, a.d * b.d);
const fMul = (a: Frac, b: Frac): Frac => frac(a.n * b.n, a.d * b.d);
const fDiv = (a: Frac, b: Frac): Frac => frac(a.n * b.d, a.d * b.n);
const fIsZero = (a: Frac): boolean => a.n === 0n;
const fIsInteger = (a: Frac): boolean => a.d === 1n;

/** A difference equation: `Σ coefficient × magnitude = delta`. */
interface Equation {
  /** Slot key to +1 (present in the left subject) or -1 (in the right). */
  terms: Map<string, 1 | -1>;
  delta: number;
  left: string;
  right: string;
  /** Both animals are stabled, so this equation is one the player can audit. */
  stabled: boolean;
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
  // Integral too: the game displays whole numbers, so a fractional reading is
  // a corrupt record rather than a measurement. Nothing produces one today —
  // both subject sources only check `typeof value === 'number'` — but a
  // single such row would otherwise reach the exact-arithmetic solver, where
  // it is not merely useless but fatal to the whole study.
  return value !== undefined && Number.isInteger(value) && value > ATTRIBUTE_FLOOR && value < ATTRIBUTE_CEILING;
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
        stabled: a.subject.stabled === true && b.subject.stabled === true,
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

/**
 * The value with strictly the most backing.
 *
 * `tied` when nothing leads outright. There is no sensible tie-break: with
 * two values on two equations each, picking either publishes a coin-flip
 * as a finding, and that value then feeds substitution and validation as
 * though it were known. The corpus simply has not settled the slot.
 */
function majority<T>(tally: Map<number, readonly T[]>): {
  magnitude: number;
  support: number;
  dissent: number;
  tied: boolean;
} {
  let best = 0;
  let bestCount = -1;
  let tied = false;
  let total = 0;
  for (const [magnitude, pairs] of tally) {
    total += pairs.length;
    if (pairs.length > bestCount) {
      best = magnitude;
      bestCount = pairs.length;
      tied = false;
    } else if (pairs.length === bestCount) {
      tied = true;
    }
  }
  return { magnitude: best, support: bestCount, dissent: total - bestCount, tied };
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
  const confirmedSlots = options.confirmedSlots ?? new Set<string>();

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
  for (const observations of byBreed.values()) equations.push(...buildEquations(observations, maxDistance));
  // Subjects that actually produced an equation, not subjects that were
  // merely eligible: two animals with identical active sets yield nothing,
  // and a breed with a single measured animal yields nothing at all.
  const contributing = new Set<string>();
  for (const equation of equations) contributing.add(equation.left).add(equation.right);
  const contributors = contributing.size;

  const signOf = new Map<string, 1 | -1>();
  for (const slot of attributeSlots) signOf.set(slotKey(slot), slot.sign);

  const solved = new Map<string, StudyFinding>();
  const dissenters = new Map<string, number>();
  const geneDoubts: GeneDoubt[] = [];
  // A doubted slot never reaches `solved`, so without its own record every
  // later substitution round would re-derive it and file the doubt again.
  const doubted = new Set<string>();
  // Equations a derived finding was read off. Within one attribute a pair of
  // subjects yields exactly one equation, so the pair identifies it.
  // `validate` must skip these: the magnitude was computed as the residual
  // of the very equation, so it reproduces that delta by construction and
  // would score a guaranteed hit. Roughly a third of multi-term equations
  // are in this position once substitution has run.
  const consumed = new Set<string>();
  const stabledIds = new Set<string>();
  for (const observations of byBreed.values())
    for (const o of observations) if (o.subject.stabled) stabledIds.add(o.subject.id);

  /** Distinct animals appearing anywhere in a tally, and whether any pair is checkable. */
  const censusOf = (tally: Tally): { animals: number; checkable: boolean } => {
    const seen = new Set<string>();
    let checkable = false;
    for (const pairs of tally.values())
      for (const [left, right] of pairs) {
        seen.add(left).add(right);
        if (stabledIds.has(left) && stabledIds.has(right)) checkable = true;
      }
    return { animals: seen.size, checkable };
  };

  const doubt = (
    key: string,
    tally: Tally,
    observed: number,
    support: number,
    dissent: number,
    reason: GeneDoubtReason,
  ): void => {
    const declared = signOf.get(key);
    if (declared === undefined || doubted.has(key)) return;
    doubted.add(key);
    const [gene, expression] = key.split(':') as [string, Expression];
    const { animals, checkable } = censusOf(tally);
    geneDoubts.push({
      gene,
      expression,
      attribute,
      declared,
      observed,
      reason,
      support,
      dissent,
      animals,
      checkable,
      witnesses: (tally.get(observed) ?? []).slice(0, MAX_WITNESSES),
    });
  };

  const commit = (key: string, tally: Tally, tier: FindingTier, depth: number): void => {
    const { magnitude, support, dissent, tied } = majority(tally);
    // Nothing leads: the slot is unresolved, not resolved-to-the-smaller.
    // Reported as `unstable` when the disagreement is broad enough to
    // implicate the declaration, and left open either way so a later round
    // with more equations can still break the tie.
    if (tied) {
      const spread = [...tally.values()].flat();
      if (needsTwoMistakes(spread)) doubt(key, tally, magnitude, support, dissent, 'unstable');
      return;
    }
    // The declared direction is an independent fact about the gene, never an
    // input to the arithmetic — which is what lets it be *tested*. The gene
    // table is hand-entered, so when the animals disagree with it the
    // declaration is a suspect in its own right. No finding is published
    // either way: a slot resting on a declaration we doubt is not knowledge.
    const sign = signOf.get(key);
    if (sign !== undefined && magnitude * sign <= 0) {
      // No finding either way — a slot resting on a declaration the animals
      // contradict is not knowledge. But only *file* the doubt when more
      // than one bad animal would be needed to fake it.
      //
      // When it is not yet worth filing, the slot is left open rather than
      // suppressed: one early bad pair must not be able to bury a slot that
      // later, cleaner evidence would settle. `doubted` therefore marks only
      // what has actually been reported, so a later round can still reopen
      // this one.
      if (confirmedSlots.has(key)) {
        // The player has been into the game and the declaration stands. The
        // gene is no longer a suspect, so every animal in this dispute is —
        // all of them, not just the minority, because the whole tally
        // contradicts something now known to be true. Still no finding: the
        // arithmetic disagrees with a confirmed fact, so what the corpus
        // entails here is that a record is wrong, not what the gene is worth.
        for (const pairs of tally.values())
          for (const [left, right] of pairs) {
            dissenters.set(left, (dissenters.get(left) ?? 0) + 1);
            dissenters.set(right, (dissenters.get(right) ?? 0) + 1);
          }
        return;
      }
      if (needsTwoMistakes(tally.get(magnitude) ?? [])) {
        doubt(key, tally, magnitude, support, dissent, magnitude === 0 ? 'no-effect' : 'contradicts-sign');
      }
      return;
    }
    let worstAnimal = 0;
    const blame = new Map<string, number>();
    for (const [value, pairs] of tally) {
      if (value === magnitude) continue;
      for (const [left, right] of pairs) {
        dissenters.set(left, (dissenters.get(left) ?? 0) + 1);
        dissenters.set(right, (dissenters.get(right) ?? 0) + 1);
        for (const id of [left, right]) {
          const n = (blame.get(id) ?? 0) + 1;
          blame.set(id, n);
          if (n > worstAnimal) worstAnimal = n;
        }
      }
    }
    // One mis-recorded animal turns up in most of the dissent it causes.
    // When no animal does — the disagreement is spread thin — the only
    // thing every dissenting pair shares is this gene's declaration, so it
    // is the declaration that wants checking, not the animals.
    // A confirmed declaration cannot be the thing every dissenting pair has
    // in common, so `unstable` no longer points at it. The blame recorded
    // just above already names the animals.
    if (dissent > 0 && worstAnimal * 2 <= dissent && !confirmedSlots.has(key)) {
      doubt(key, tally, magnitude, support, dissent, 'unstable');
    }
    if (tier === 'derived')
      for (const pairs of tally.values()) for (const [left, right] of pairs) consumed.add(`${left}|${right}`);
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
      witnesses: (tally.get(magnitude) ?? []).slice(0, MAX_WITNESSES),
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
      if (solved.has(key) || doubted.has(key)) continue;
      const before = solved.size;
      commit(key, tally, 'derived', depth);
      if (solved.size > before) added++;
    }
    if (added === 0) break;
  }

  // Substitution has gone as far as it can; whatever it left may still be
  // pinned by the equations jointly. Run after the fixpoint rather than
  // instead of it: the fixpoint is what builds the support/dissent tallies
  // that `doubt` and `contradictions` rest on, and a subsystem solve returns
  // one value with no tally and can reproduce none of that.
  const subsystem = determinedSlots(equations, solved);
  for (const key of subsystem.consumed) consumed.add(key);
  for (const found of subsystem.found) {
    if (solved.has(found.key) || doubted.has(found.key)) continue;
    const declared = signOf.get(found.key);
    const value = Number(found.value.n) / Number(found.value.d);
    const witnesses = found.pairs.slice(0, MAX_WITNESSES);
    /**
     * File a doubt about this slot, unless one bad animal could explain the
     * whole thing — the same guard `commit` applies, because a doubt that
     * sends the player into the game for nothing costs them a trip. The
     * tally has a single entry, so the doubt surface reads the same for a
     * subsystem result as for a disputed one.
     */
    const raise = (reason: GeneDoubtReason): void => {
      // The whole pair list, not the displayed slice: `doubt` counts the
      // distinct animals from this tally and asks whether any pair is
      // stabled, and both decide how the panel ranks the doubt. It truncates
      // for display itself.
      if (needsTwoMistakes(found.pairs)) {
        doubt(found.key, new Map([[value, found.pairs]]), value, found.support, 0, reason);
      }
    };

    // The three gates, each a check this engine already believes in.
    if (!fIsInteger(found.value)) {
      // Determined, but to a fraction — impossible for an integral game, so
      // an animal in this subsystem is mis-recorded. Only this tier can see
      // it, because only this tier combines enough equations to notice.
      raise('non-integer');
      continue;
    }
    const magnitude = Number(found.value.n);
    if (magnitude === 0) {
      raise('no-effect');
      continue;
    }
    if (declared !== undefined && magnitude * declared <= 0) {
      raise('contradicts-sign');
      continue;
    }

    const [gene, expression] = found.key.split(':') as [string, Expression];
    solved.set(found.key, {
      gene,
      expression,
      attribute,
      magnitude,
      tier: 'system',
      depth: 0,
      support: found.support,
      // An inconsistent subsystem publishes nothing at all rather than a
      // majority, so a published one has nothing dissenting from it.
      dissent: 0,
      witnesses,
    });
  }

  return {
    attribute,
    slots: attributeSlots.length,
    findings: [...solved.values()].sort(
      (a, b) => a.depth - b.depth || b.support - a.support || a.gene.localeCompare(b.gene),
    ),
    // Stabled animals first: a disagreement the player can go and settle is
    // worth more than a louder one they cannot check, however large its count.
    // Checkable first, then the widest disagreements: a doubt backed by many
    // animals is far more likely the declaration's fault than one animal's.
    geneDoubts: geneDoubts.sort(
      (a, b) => Number(b.checkable) - Number(a.checkable) || b.animals - a.animals || b.support - a.support,
    ),
    contradictions: [...dissenters.entries()]
      .map(([subjectId, count]) => ({ subjectId, count, stabled: stabledIds.has(subjectId) }))
      .sort((a, b) => Number(b.stabled) - Number(a.stabled) || b.count - a.count),
    validation: validate(equations, solved, consumed),
    contributors,
    baselines: inferBaselines([...byBreed.values()].flat(), solved, signOf),
  };
}

/**
 * Read each breed's base off the animals, once the magnitudes are in.
 *
 * Every equation above is a difference so that the base never had to be
 * known. With the magnitudes solved it falls out per animal: subtract what
 * is known and `base + Σ unresolved` is left. Animals of one breed leaving
 * the same slots unresolved must read the same lump, so they are tallied
 * together and the majority rule applies as it does to magnitudes.
 *
 * A lump is not a lesser result. When the unresolved slot is one every
 * animal expresses, the corpus can never do better — no pair differs at it —
 * and the lump is exactly what the game's arithmetic makes observable.
 */
function inferBaselines(
  observations: readonly Observation[],
  solved: ReadonlyMap<string, StudyFinding>,
  signOf: ReadonlyMap<string, 1 | -1>,
): AttributeBaselines {
  /** Breed, then unresolved signature, then lump value to the animals reading it. */
  const lumps = new Map<string, Map<string, Map<number, string[]>>>();
  for (const { subject, active, value } of observations) {
    let lump = value;
    const unresolved: string[] = [];
    for (const key of active) {
      const known = solved.get(key);
      if (known) lump -= known.magnitude;
      else unresolved.push(key);
    }
    const group = subject.baselineGroup ?? subject.breed;
    const bySignature = lumps.get(group) ?? new Map<string, Map<number, string[]>>();
    lumps.set(group, bySignature);
    const signature = unresolved.sort().join(',');
    const tally = bySignature.get(signature) ?? new Map<number, string[]>();
    bySignature.set(signature, tally);
    const ids = tally.get(lump);
    if (ids) ids.push(subject.id);
    else tally.set(lump, [subject.id]);
  }

  /** Per breed, every settled lump by signature. */
  const settled = new Map<string, Map<string, BaselineReading>>();
  for (const [breed, bySignature] of lumps) {
    const readings = new Map<string, BaselineReading>();
    for (const [signature, tally] of bySignature) {
      const { magnitude: lump, support, dissent, tied } = majority(tally);
      // Two readings with equal backing: the corpus has not settled this lump.
      if (tied) continue;
      const unresolved = signature ? signature.split(',') : [];
      let positives = 0;
      let negatives = 0;
      for (const key of unresolved) {
        if (signOf.get(key) === 1) positives++;
        else negatives++;
      }
      readings.set(signature, {
        breed,
        value: lump,
        unresolved,
        min: positives === 0 ? lump + negatives : null,
        max: negatives === 0 ? lump - positives : null,
        support,
        dissent,
        dissenters: [...tally].filter(([v]) => v !== lump).flatMap(([, ids]) => ids),
        witnesses: (tally.get(lump) ?? []).slice(0, MAX_WITNESSES),
      });
    }
    if (readings.size > 0) settled.set(breed, readings);
  }

  const readings = [...settled.values()]
    .map((bySignature) =>
      [...bySignature.values()].reduce((best, r) =>
        r.support > best.support || (r.support === best.support && r.unresolved.length < best.unresolved.length)
          ? r
          : best,
      ),
    )
    .sort((a, b) => b.support - a.support || a.breed.localeCompare(b.breed));

  // Offsets are read relative to the best-supported breed, so each breed is
  // placed once against a common reference rather than against every other.
  // An animal of no recorded breed (possible only in a pooled species) could
  // be any of them, so its group is never compared.
  const offsets: BaselineOffset[] = [];
  const reference = readings.find((r) => r.breed !== '')?.breed;
  const anchor = reference === undefined ? undefined : settled.get(reference);
  if (anchor) {
    for (const [breed, bySignature] of settled) {
      if (breed === reference || breed === '') continue;
      const tally = new Map<number, Array<[BaselineReading, BaselineReading]>>();
      for (const [signature, reading] of bySignature) {
        const other = anchor.get(signature);
        if (!other) continue;
        const offset = reading.value - other.value;
        const list = tally.get(offset);
        if (list) list.push([reading, other]);
        else tally.set(offset, [[reading, other]]);
      }
      if (tally.size === 0) continue;
      const { magnitude: offset, support, dissent, tied } = majority(tally);
      if (tied) continue;
      let animals = 0;
      for (const [a, b] of tally.get(offset) ?? []) animals += a.support + b.support;
      offsets.push({ breed, relativeTo: reference as string, offset, support, dissent, animals });
    }
  }
  offsets.sort((a, b) => b.animals - a.animals || a.breed.localeCompare(b.breed));

  return { readings, offsets };
}

/** A slot the equations pin jointly, though no single equation isolates it. */
interface DeterminedSlot {
  key: string;
  value: Frac;
  /** Residual equations mentioning this slot — how much evidence touches it. */
  support: number;
  /**
   * Every pair behind those equations, whole.
   *
   * Truncated to `MAX_WITNESSES` only where it is displayed.
   * `needsTwoMistakes` intersects the pairs to ask whether one animal could
   * be behind the lot, and handing it a three-item sample would answer that
   * question about the sample rather than about the evidence.
   */
  pairs: Array<[string, string]>;
}

/** What a subsystem pass produced, plus the equations it used them from. */
interface SubsystemResult {
  found: DeterminedSlot[];
  /**
   * Equations satisfied by construction, which `validate` must skip.
   *
   * Every equation in a solved component is reproduced exactly by the
   * solution read off it — the same reason `commit` consumes the equation a
   * derived finding came from. Scoring against them would be the engine
   * marking its own work.
   */
  consumed: Set<string>;
}

/**
 * Slots the equation system determines that substitution cannot reach.
 *
 * The fixpoint accepts a slot only when it is the *sole* remaining unknown
 * in some equation. That is triangular: two equations in two unknowns
 * determine both, and it takes neither. This closes that gap by asking the
 * question elimination answers — which variables does the system pin,
 * whatever order you solve in?
 *
 * A variable is uniquely determined exactly when `e_j` lies in the row space
 * of the coefficient matrix. In reduced row echelon form that reads off
 * directly: column `j` is a pivot, and its row has no non-zero entry in any
 * free (non-pivot) column. Anything else leaves `x_j` moving along the null
 * space, and a value that depends on the elimination order is not knowledge.
 *
 * This is still entailment, not estimation. A determined slot is forced by
 * the corpus exactly as a single-difference pair forces a `direct` finding;
 * the only difference is how many equations had to be combined to see it.
 *
 * Solved per connected component over shared slots, which does three jobs at
 * once: it keeps the matrices small (elimination touches every row on every
 * pivot, so one big system costs far more than several small ones), it makes
 * "inconsistent" a local verdict so one bad animal cannot withdraw an
 * unrelated slot, and it bounds what has to be marked `consumed`.
 *
 * A component whose rows reduce to `0 = k` publishes nothing: the
 * contradiction belongs to the combination rather than to any one slot, so
 * there is no majority to take and picking a pivot value would republish a
 * dispute as certainty.
 *
 * Rows already reduced to no unknowns are dropped rather than checked here —
 * those dispute findings that are already published, which the fixpoint's
 * blame accounting reports through `contradictions`.
 */
function determinedSlots(equations: readonly Equation[], solved: ReadonlyMap<string, StudyFinding>): SubsystemResult {
  // Residual system: substitute what is already known, keep what is not.
  interface Row {
    terms: Map<string, 1 | -1>;
    delta: number;
    pair: [string, string];
    id: string;
  }
  const rowsIn: Row[] = [];
  for (const equation of equations) {
    const terms = new Map<string, 1 | -1>();
    let delta = equation.delta;
    for (const [key, sign] of equation.terms) {
      const known = solved.get(key);
      if (known) delta -= sign * known.magnitude;
      else terms.set(key, sign);
    }
    // A row with nothing left unknown says something about findings already
    // published, not about a new slot. Disagreement among those is the
    // fixpoint's business and is already reported through `contradictions`.
    if (terms.size === 0) continue;
    rowsIn.push({ terms, delta, pair: [equation.left, equation.right], id: `${equation.left}|${equation.right}` });
  }
  if (rowsIn.length === 0) return { found: [], consumed: new Set() };

  // Split into connected components over shared slots. Two rows with no slot
  // in common cannot inform each other, so solving them together only makes
  // the matrix bigger — elimination reduces every row on every pivot, so cost
  // grows with the square of the row count rather than with the unknowns.
  // Components also make "inconsistent" a local verdict: one mis-recorded
  // animal must not be able to withdraw an unrelated slot.
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root) as string;
    while (parent.get(x) !== root) {
      const next = parent.get(x) as string;
      parent.set(x, root);
      x = next;
    }
    return root;
  };
  const union = (a: string, b: string): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  for (const row of rowsIn) for (const key of row.terms.keys()) if (!parent.has(key)) parent.set(key, key);
  for (const row of rowsIn) {
    const keys = [...row.terms.keys()];
    for (let i = 1; i < keys.length; i++) union(keys[0], keys[i]);
  }
  const components = new Map<string, Row[]>();
  for (const row of rowsIn) {
    const root = find([...row.terms.keys()][0]);
    const list = components.get(root);
    if (list) list.push(row);
    else components.set(root, [row]);
  }

  const found: DeterminedSlot[] = [];
  const consumed = new Set<string>();

  for (const componentRows of components.values()) {
    // Identical equations carry identical information. Two animals differing
    // the same way are common in a stable bred from a few lines, and every
    // duplicate costs a full reduction pass.
    const seen = new Set<string>();
    const rows: Row[] = [];
    for (const row of componentRows) {
      const signature = `${[...row.terms]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([k, s]) => `${k}${s}`)
        .join(',')}=${row.delta}`;
      if (seen.has(signature)) continue;
      seen.add(signature);
      rows.push(row);
    }

    const vars = [...new Set(rows.flatMap((r) => [...r.terms.keys()]))];
    const column = new Map(vars.map((v, i) => [v, i]));
    const width = vars.length + 1;
    const matrix = rows.map((r) => {
      const row = new Array<Frac>(width).fill(frac(0n));
      for (const [key, sign] of r.terms) row[column.get(key) as number] = frac(BigInt(sign));
      row[vars.length] = frac(BigInt(r.delta));
      return row;
    });

    const pivotOfRow: number[] = [];
    let rank = 0;
    for (let c = 0; c < vars.length && rank < matrix.length; c++) {
      let pivot = -1;
      for (let i = rank; i < matrix.length; i++) {
        if (!fIsZero(matrix[i][c])) {
          pivot = i;
          break;
        }
      }
      if (pivot === -1) continue;
      [matrix[rank], matrix[pivot]] = [matrix[pivot], matrix[rank]];
      const lead = matrix[rank][c];
      for (let k = c; k < width; k++) matrix[rank][k] = fDiv(matrix[rank][k], lead);
      for (let i = 0; i < matrix.length; i++) {
        if (i === rank) continue;
        const factor = matrix[i][c];
        if (fIsZero(factor)) continue;
        for (let k = c; k < width; k++) matrix[i][k] = fSub(matrix[i][k], fMul(factor, matrix[rank][k]));
      }
      pivotOfRow[rank] = c;
      rank++;
    }

    // A row reduced to `0 = k` means the animals in this component contradict
    // each other. There is no "majority" to take — the contradiction is a
    // property of the combination, not of one slot — so the component
    // publishes nothing and the equations stay available to `validate`.
    let contradictory = false;
    for (let i = rank; i < matrix.length; i++) {
      if (!fIsZero(matrix[i][vars.length])) {
        contradictory = true;
        break;
      }
    }
    if (contradictory) continue;

    const pivotColumns = new Set(pivotOfRow.slice(0, rank));
    const componentFound: DeterminedSlot[] = [];
    for (let i = 0; i < rank; i++) {
      const pc = pivotOfRow[i];
      let isolated = true;
      for (let c = 0; c < vars.length; c++) {
        if (c === pc || pivotColumns.has(c)) continue;
        if (!fIsZero(matrix[i][c])) {
          isolated = false;
          break;
        }
      }
      if (!isolated) continue;
      const key = vars[pc];
      const touching = componentRows.filter((r) => r.terms.has(key));
      componentFound.push({
        key,
        value: matrix[i][vars.length],
        support: touching.length,
        pairs: touching.map((r) => r.pair),
      });
    }
    if (componentFound.length === 0) continue;
    found.push(...componentFound);
    // Every equation here is reproduced by the solution read off it, so none
    // of them is a held-out test any more.
    for (const row of componentRows) consumed.add(row.id);
  }

  return { found, consumed };
}

/**
 * Score the findings against equations none of them came from.
 *
 * Only pairs differing at two or more solved slots are used: a
 * single-difference pair is the very equation its finding was read off, so
 * scoring against it would be circular.
 */
function validate(
  equations: readonly Equation[],
  solved: ReadonlyMap<string, StudyFinding>,
  consumed: ReadonlySet<string>,
): ValidationReport {
  let tested = 0;
  let exact = 0;
  let stabledTested = 0;
  let stabledExact = 0;
  /** Per animal, how often each error size was seen. */
  const misses = new Map<string, Map<number, number>>();
  const noteMiss = (id: string, error: number): void => {
    const byError = misses.get(id) ?? new Map<number, number>();
    byError.set(error, (byError.get(error) ?? 0) + 1);
    misses.set(id, byError);
  };
  for (const equation of equations) {
    // `terms.size < 2` drops the single-difference equations a direct
    // finding is read off; `consumed` drops the wider ones a derived
    // finding was read off. What remains is genuinely held out.
    if (equation.terms.size < 2 || consumed.has(`${equation.left}|${equation.right}`)) continue;
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
    const hit = predicted === equation.delta;
    tested++;
    if (hit) exact++;
    else {
      const error = Math.abs(predicted - equation.delta);
      noteMiss(equation.left, error);
      noteMiss(equation.right, error);
    }
    if (equation.stabled) {
      stabledTested++;
      if (hit) stabledExact++;
    }
  }

  const suspects: ValidationSuspect[] = [];
  for (const [subjectId, byError] of misses) {
    let failures = 0;
    let offset = 0;
    let best = 0;
    for (const [error, count] of byError) {
      failures += count;
      if (count > best) {
        best = count;
        offset = error;
      }
    }
    suspects.push({ subjectId, failures, offset, offsetShare: best / failures, offsets: [...byError] });
  }
  // Worst first, and a concentrated offset ahead of a scattered one at the
  // same count: the concentrated one is the likelier mis-typed record.
  suspects.sort((a, b) => b.failures - a.failures || b.offsetShare - a.offsetShare);

  return { tested, exact, stabledTested, stabledExact, suspects };
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
