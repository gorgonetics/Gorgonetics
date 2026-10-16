/**
 * Targeted breeding: a foal like this horse, but better on chosen attributes.
 *
 * The pair ranking asks which pairing in the stable is best. This asks a
 * narrower question about one animal the player wants to keep — the anchor —
 * and each partner it could be bred to: how likely is one foal to beat the
 * anchor on the target attributes without losing more than a set tolerance
 * on any other?
 *
 * ## Measured against the anchor, in points
 *
 * Every figure is a change from the anchor's own genome. At each locus the
 * foal's expressed slot replaces the anchor's, so the change is
 * `magnitude(foal slot) − magnitude(anchor slot)`, and the base cancels as
 * long as the foal is the anchor's breed. The anchor's recorded value is the
 * baseline, so no base value is needed at all.
 *
 * Improving is either gaining a positive or losing a negative. The sizes are
 * signed, so both come out of the same subtraction: a foal that drops the
 * anchor's `−3` slot is `+3` on that attribute.
 *
 * As in `attributePoints`, a slot with no measured size contributes nothing.
 * It is not imputed. Where the foal could express a different unmeasured
 * slot from the anchor's, `unmeasured` counts it, split by the direction the
 * declared signs give: gaining a `+` or dropping a `−` is `better`, the
 * reverse is `worse`. Only the direction is known, never the size.
 *
 * ## Exact, and why that is cheap
 *
 * Loci are independent given the parents, but attributes are not quite: a
 * locus expresses its dominant slot or its recessive slot, never both, and
 * where the two name different attributes — in the horse table, only on
 * chromosome 1 — one locus can lift Temperament and cost Friendliness. Joint
 * success needs that, and a table over every attribute at once is too big.
 * Two things keep it small, both read from the gene table rather than
 * assumed:
 *
 *  - Attributes no segregating locus links are independent, so their
 *    probabilities multiply (`independentGroups`).
 *  - Within a group, an attribute is settled as soon as the loci still to
 *    come cannot change whether its condition holds (`settledProbability`).
 *
 * A seeded sample remains as a fallback should a group still outgrow its
 * budget.
 *
 * Pure: no DB, no Svelte.
 */

import type { AlleleDistribution } from '$lib/types/index.js';
import { GeneType } from '$lib/types/index.js';
import type { AttributeMagnitudes } from '$lib/utils/attributePoints.js';
import { magnitudeOf } from '$lib/utils/attributePoints.js';
import type { Expression } from '$lib/utils/attributeStudy.js';
import { offspringDistribution } from '$lib/utils/breedingGenetics.js';
import type { PetLoci } from '$lib/utils/petLoci.js';
import { capitalize } from '$lib/utils/string.js';

/** What a gene's two slots act on; lowercase attribute names, as the gene table parses them. */
export interface SlotAttributes {
  dominantAttribute: string | null;
  dominantSign: '+' | '-' | null;
  recessiveAttribute: string | null;
  recessiveSign: '+' | '-' | null;
}

/** Expected unmeasured slot changes on one attribute, by the direction their declared signs give. */
export interface Unmeasured {
  better: number;
  worse: number;
}

export interface TargetedBreedingOptions {
  /** Every attribute of the species, capitalised. Non-targets are the protected ones. */
  attributes: readonly string[];
  /** Attributes the foal must beat the anchor on, capitalised. */
  targets: readonly string[];
  /** Points a protected attribute may fall below the anchor and still count as kept. */
  tolerance: number;
  /**
   * `false` skips the joint figure — the one costly part — and reports
   * `pSuccess` as its upper bound, `pSuccessBound`. For screening many
   * candidates before scoring the few that could win.
   */
  joint?: boolean;
  /**
   * Foals in the fallback sample, used only when the exact joint figure
   * outgrows its budget. `0` skips every probability, leaving the expected
   * changes.
   */
  samples?: number;
  seed?: number;
}

/** A locus where the partner can move a target attribute by a measured amount. */
export interface Lever {
  gene: string;
  attribute: string;
  anchor: GeneType;
  /** The partner's genotype; `null` for a two-step route, where the partner is a foal not yet born. */
  partner: GeneType | null;
  /** Expected change on `attribute` at this locus, in measured points. */
  expected: number;
  /** Probability the foal expresses a different slot here from the anchor. */
  pChange: number;
}

export interface PartnerOutlook {
  /** P(every target above the anchor and no other attribute more than `tolerance` below it). */
  pSuccess: number;
  /** P(every target above the anchor), whatever happens elsewhere. */
  pTargets: number;
  /**
   * An upper bound on `pSuccess` that costs little: success needs the
   * targets up and every other attribute kept, so it is at most the least
   * likely of those on its own.
   */
  pSuccessBound: number;
  /** Expected change from the anchor per attribute, in measured points. */
  expected: Record<string, number>;
  /** Per protected attribute, P(it falls more than `tolerance` below the anchor). */
  pDrop: Record<string, number>;
  /** Per attribute, expected loci where the foal changes slot through one with no measured size. */
  unmeasured: Record<string, Unmeasured>;
  /** Target loci the partner can move, largest expected change first. */
  levers: Lever[];
}

export const DEFAULT_SAMPLES = 4000;
const DEFAULT_SEED = 0x5eed;

/** Which slot a genotype expresses: `D` and `x` the dominant one, `R` the recessive one. */
function expressed(type: GeneType): 'dominant' | 'recessive' | null {
  if (type === GeneType.DOMINANT || type === GeneType.MIXED) return 'dominant';
  if (type === GeneType.RECESSIVE) return 'recessive';
  return null;
}

/** Small, fast, seedable PRNG: the same inputs always rank the same way. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One locus, reduced to what sampling needs: outcome probabilities and their sparse point changes. */
interface LocusOutcomes {
  probs: number[];
  cumulative: number[];
  /** Per outcome, `[attributeIndex, delta]` pairs. */
  deltas: Array<Array<[number, number]>>;
}

/** A requirement on one attribute's final change: above `bound`, or at least it. */
interface Condition {
  dim: number;
  bound: number;
  strict: boolean;
}

/** Above this many partial outcomes, fall back to sampling rather than stall. */
const STATE_CAP = 200_000;

/**
 * P(every condition holds), exactly.
 *
 * Loci are independent, so the foal is a sum of per-locus outcomes. The
 * joint distribution over every attribute is too big to hold, but most of it
 * never matters: once the loci still to come cannot change whether a
 * condition holds, that attribute is settled — passed, or the outcome is
 * dropped — and stops splitting outcomes apart. Loci with the widest swings
 * go first, so attributes settle early. `null` when the partial outcomes
 * still outgrow `STATE_CAP`.
 */
/**
 * Conditions in groups that no locus links: attributes in different groups
 * are independent, so probabilities over them multiply.
 */
function independentGroups<T extends Condition>(loci: readonly LocusOutcomes[], conditions: readonly T[]): T[][] {
  const group = conditions.map((_, i) => i);
  const find = (i: number): number => {
    if (group[i] !== i) group[i] = find(group[i]);
    return group[i];
  };
  const slotOf = new Map(conditions.map((c, i) => [c.dim, i]));
  for (const locus of loci) {
    const touched = new Set<number>();
    for (const delta of locus.deltas) {
      for (const [attr, d] of delta) if (d !== 0 && slotOf.has(attr)) touched.add(slotOf.get(attr) as number);
    }
    const [first, ...rest] = touched;
    for (const i of rest) group[find(i)] = find(first);
  }
  const parts = new Map<number, T[]>();
  conditions.forEach((c, i) => {
    const root = find(i);
    parts.set(root, [...(parts.get(root) ?? []), c]);
  });
  return [...parts.values()];
}

function jointProbability(loci: readonly LocusOutcomes[], conditions: readonly Condition[]): number | null {
  if (conditions.length <= 1) return settledProbability(loci, conditions);
  // Attributes are only dependent through loci that move more than one of
  // them, so the joint probability is the product over independent groups:
  // exact, and far smaller than one table over every attribute.
  let product = 1;
  for (const part of independentGroups(loci, conditions)) {
    const p = settledProbability(loci, part);
    if (p === null) return null;
    product *= p;
    if (product === 0) return 0;
  }
  return product;
}

function settledProbability(loci: readonly LocusOutcomes[], conditions: readonly Condition[]): number | null {
  if (conditions.length === 0) return 1;
  const m = conditions.length;
  /** Per locus, per outcome, the change on each conditioned attribute. */
  const compact = loci
    .map((locus) => ({
      probs: locus.probs,
      values: locus.deltas.map((delta) =>
        conditions.map((c) => delta.reduce((sum, [attr, d]) => (attr === c.dim ? sum + d : sum), 0)),
      ),
    }))
    .filter((l) => l.values.some((v) => v.some((d) => d !== 0)));
  // Order the loci attribute by attribute. Once every locus touching an
  // attribute is done, its change is final and it settles, so only the
  // attributes some done locus and some pending locus both touch stay open.
  // Taken in order of fewest open neighbours, that frontier stays a handful
  // even when chromosome 1 links most attributes. Within an attribute, the
  // widest swings go first, which settles it soonest.
  const touches = compact.map((l) => conditions.map((_, c) => l.values.some((v) => v[c] !== 0)));
  const swing = (j: number) =>
    Math.max(
      ...conditions.map(
        (_, c) => Math.max(...compact[j].values.map((v) => v[c])) - Math.min(...compact[j].values.map((v) => v[c])),
      ),
    );
  const pending = new Set(compact.map((_, j) => j));
  const done = new Set<number>();
  const order: number[] = [];
  while (pending.size > 0) {
    let pick = -1;
    let fewest = Number.POSITIVE_INFINITY;
    for (let c = 0; c < m; c++) {
      if (done.has(c)) continue;
      const neighbours = new Set<number>();
      for (const j of pending) {
        if (!touches[j][c]) continue;
        touches[j].forEach((t, other) => {
          if (t && other !== c && !done.has(other)) neighbours.add(other);
        });
      }
      if (neighbours.size < fewest) {
        fewest = neighbours.size;
        pick = c;
      }
    }
    done.add(pick);
    const batch = [...pending].filter((j) => touches[j][pick]);
    batch.sort((a, b) => swing(b) - swing(a));
    for (const j of batch) {
      order.push(j);
      pending.delete(j);
    }
  }
  const ordered = order.map((j) => compact[j]);
  compact.length = 0;
  compact.push(...ordered);

  // Suffix bounds: the least and most the loci from `j` on can still add.
  const n = compact.length;
  const sufMin = Array.from({ length: n + 1 }, () => new Array<number>(m).fill(0));
  const sufMax = Array.from({ length: n + 1 }, () => new Array<number>(m).fill(0));
  for (let j = n - 1; j >= 0; j--) {
    for (let c = 0; c < m; c++) {
      const values = compact[j].values.map((v) => v[c]);
      sufMin[j][c] = sufMin[j + 1][c] + Math.min(...values);
      sufMax[j][c] = sufMax[j + 1][c] + Math.max(...values);
    }
  }

  const passes = (c: Condition, x: number) => (c.strict ? x > c.bound : x >= c.bound);

  // Each partial outcome packs into one number: per attribute, its running
  // change offset into the range it can reach, or one past the top once
  // settled. Sizes are whole numbers — the study rejects a fractional one as
  // a mis-recording — so the packing is exact; anything else gives up.
  const lo = sufMin[0];
  const radix = conditions.map((_, c) => sufMax[0][c] - lo[c] + 2);
  const place: number[] = [];
  let span = 1;
  for (let c = 0; c < m; c++) {
    place.push(span);
    span *= radix[c];
  }
  if (!Number.isSafeInteger(span) || compact.some((l) => l.values.some((v) => v.some((d) => !Number.isInteger(d))))) {
    return null;
  }
  const SETTLED = radix.map((r) => r - 1);

  /** Settle what the loci from `j` on cannot change; the packed key, or -1 once a condition cannot hold. */
  const settle = (v: number[], j: number): number => {
    let key = 0;
    for (let c = 0; c < m; c++) {
      let code: number;
      if (v[c] === Number.POSITIVE_INFINITY) code = SETTLED[c];
      else if (passes(conditions[c], v[c] + sufMin[j][c])) code = SETTLED[c];
      else if (!passes(conditions[c], v[c] + sufMax[j][c])) return -1;
      else code = v[c] - lo[c];
      key += code * place[c];
    }
    return key;
  };
  const unpack = (key: number, into: number[]) => {
    for (let c = 0; c < m; c++) {
      const code = Math.floor(key / place[c]) % radix[c];
      into[c] = code === SETTLED[c] ? Number.POSITIVE_INFINITY : code + lo[c];
    }
  };

  let states = new Map<number, number>();
  const first = settle(new Array<number>(m).fill(0), 0);
  if (first >= 0) states.set(first, 1);
  const v = new Array<number>(m);
  const w = new Array<number>(m);
  for (let j = 0; j < n && states.size > 0; j++) {
    const next = new Map<number, number>();
    const { probs, values } = compact[j];
    for (const [key, p] of states) {
      unpack(key, v);
      for (let k = 0; k < probs.length; k++) {
        const step = values[k];
        for (let c = 0; c < m; c++) w[c] = v[c] + step[c];
        const to = settle(w, j + 1);
        if (to < 0) continue;
        next.set(to, (next.get(to) ?? 0) + p * probs[k]);
      }
    }
    if (next.size > STATE_CAP) return null;
    states = next;
  }
  let total = 0;
  for (const p of states.values()) total += p;
  return total;
}

/**
 * The foal's genotype odds at one locus, given the anchor's genotype there;
 * `null` where they cannot be known.
 */
type FoalOdds = (gene: string, anchor: GeneType) => { dist: AlleleDistribution; partner: GeneType | null } | null;

/** One foal of the anchor and a known partner. */
export function partnerOutlook(
  anchor: PetLoci,
  partner: PetLoci,
  genes: Readonly<Record<string, SlotAttributes>>,
  magnitudes: AttributeMagnitudes,
  options: TargetedBreedingOptions,
): PartnerOutlook {
  return foalOutlook(anchor, genes, magnitudes, options, (gene, anchorType) => {
    const partnerType = partner.get(gene) ?? GeneType.UNKNOWN;
    return { dist: offspringDistribution(anchorType, partnerType), partner: partnerType };
  });
}

type Genotype = 'D' | 'x' | 'R';

/** Per locus, the genotypes a kept middle foal should have. */
export type Wanted = ReadonlyMap<string, ReadonlySet<Genotype>>;

/** A locus the kept middle foal is chosen on, and how often a foal of the pair qualifies there. */
export interface KeepRule {
  gene: string;
  allowed: Genotype[];
  /** Share of the pair's foals with an allowed genotype here. */
  p: number;
}

export interface BridgeOutlook {
  /** The anchor's foal by a kept middle foal. */
  outlook: PartnerOutlook;
  /** What to keep the middle foal for. Empty when any foal of the pair will do. */
  keep: KeepRule[];
  /** Share of the pair's foals that meet every rule in `keep`, gender aside. */
  pQualify: number;
}

/**
 * The genotypes worth choosing a middle foal for: at each locus where a
 * partner could lift the targets, those that do lift them.
 */
export function wantedFrom(needs: readonly PartnerNeed[]): Wanted {
  const wanted = new Map<string, Set<Genotype>>();
  for (const n of needs) {
    if (n.byPartner[n.best] <= 0) continue;
    wanted.set(n.gene, new Set((['D', 'x', 'R'] as const).filter((t) => n.byPartner[t] > 0)));
  }
  return wanted;
}

/**
 * The best middle foal a pair can give: at every locus where the partner
 * matters to the targets, the genotype that does most for them among those
 * the pair can produce. Loci where every foal of the pair is the same set no
 * rule. Stricter than `wantedFrom`, which only asks for the gains: this also
 * asks the middle foal to keep what the anchor already has.
 */
export function idealMiddle(sire: PetLoci, dam: PetLoci, needs: readonly PartnerNeed[]): Wanted {
  const wanted = new Map<string, Set<Genotype>>();
  for (const n of needs) {
    const middle = offspringDistribution(sire.get(n.gene) ?? GeneType.UNKNOWN, dam.get(n.gene) ?? GeneType.UNKNOWN);
    if (middle.unknown > 0) continue;
    const possible = (['D', 'x', 'R'] as const).filter((t) => middle[t] > 0);
    const top = Math.max(...possible.map((t) => n.byPartner[t]));
    const allowed = possible.filter((t) => n.byPartner[t] === top);
    if (allowed.length < possible.length) wanted.set(n.gene, new Set(allowed));
  }
  return wanted;
}

/**
 * Foals bred, on average, until one beats the anchor. Waits are geometric:
 * `1 / pSuccess` from a direct partner. A two-step route first waits
 * `1 / pQualify` for a middle foal worth keeping — counted among foals of the
 * gender it needs, which is not modelled — then for a success by it.
 * `Infinity` when success is out of reach.
 */
export function expectedFoals(pSuccess: number, pQualify?: number): number {
  if (pSuccess <= 0 || pQualify === 0) return Number.POSITIVE_INFINITY;
  return (pQualify === undefined ? 0 : 1 / pQualify) + 1 / pSuccess;
}

/**
 * Two steps: breed `sire` × `dam`, keep a foal, then breed it to the anchor.
 *
 * The player reads the middle foal's genome before breeding it on, so the
 * foal that matters is the one kept, not the average one. At each `wanted`
 * locus the pair can deliver, the middle foal is taken to have an allowed
 * genotype, and `pQualify` says how often a foal does. Elsewhere its
 * genotype is still a distribution, and the anchor's foal is the mixture
 * over it. Loci are independent, so the per-locus mixtures are the whole
 * joint distribution and the single-foal scorer applies unchanged.
 *
 * A wanted locus the pair cannot deliver, or always delivers, sets no rule.
 * Which gender the middle foal comes out is not modelled.
 */
export function bridgeOutlook(
  anchor: PetLoci,
  sire: PetLoci,
  dam: PetLoci,
  genes: Readonly<Record<string, SlotAttributes>>,
  magnitudes: AttributeMagnitudes,
  options: TargetedBreedingOptions,
  wanted: Wanted = new Map(),
): BridgeOutlook {
  const keep = keepRules(sire, dam, wanted);
  const rules = new Map(keep.map((k) => [k.gene, k]));
  const outlook = foalOutlook(anchor, genes, magnitudes, options, (gene, anchorType) => {
    const middle = offspringDistribution(sire.get(gene) ?? GeneType.UNKNOWN, dam.get(gene) ?? GeneType.UNKNOWN);
    if (middle.unknown > 0) return null;
    let odds: Record<Genotype, number> = { D: middle.D, x: middle.x, R: middle.R };
    const rule = rules.get(gene);
    if (rule) {
      odds = {
        D: rule.allowed.includes('D') ? odds.D / rule.p : 0,
        x: rule.allowed.includes('x') ? odds.x / rule.p : 0,
        R: rule.allowed.includes('R') ? odds.R / rule.p : 0,
      };
    }
    const dist: AlleleDistribution = { D: 0, x: 0, R: 0, unknown: 0 };
    for (const t of ['D', 'x', 'R'] as const) {
      if (odds[t] === 0) continue;
      const step = offspringDistribution(anchorType, t);
      dist.D += odds[t] * step.D;
      dist.x += odds[t] * step.x;
      dist.R += odds[t] * step.R;
      dist.unknown += odds[t] * step.unknown;
    }
    return { dist, partner: null };
  });
  return { outlook, keep, pQualify: keep.reduce((p, k) => p * k.p, 1) };
}

/**
 * The rules `wanted` actually sets for one pair: loci where some foals of
 * the pair qualify and some do not. Cheap — no scoring — so a caller can
 * tell two ways of choosing the middle foal apart before paying for either.
 */
export function keepRules(sire: PetLoci, dam: PetLoci, wanted: Wanted): KeepRule[] {
  const rules: KeepRule[] = [];
  for (const [gene, allowed] of wanted) {
    const middle = offspringDistribution(sire.get(gene) ?? GeneType.UNKNOWN, dam.get(gene) ?? GeneType.UNKNOWN);
    if (middle.unknown > 0) continue;
    const p = [...allowed].reduce((sum, t) => sum + middle[t], 0);
    if (p > 0 && p < 1) rules.push({ gene, allowed: (['D', 'x', 'R'] as const).filter((t) => allowed.has(t)), p });
  }
  return rules.sort((a, b) => a.gene.localeCompare(b.gene));
}

/** One slot, resolved once: attribute index, measured size, declared sign. */
interface ResolvedSlot {
  attr: number;
  points: number | undefined;
  sign: 1 | -1;
}

/**
 * The gene table resolved against one attribute list and one size table.
 *
 * Every outlook walks the whole table, and a route ranking asks for
 * hundreds of outlooks over the same three inputs. Cached on their identity.
 */
const resolvedCache = new WeakMap<
  object,
  WeakMap<AttributeMagnitudes, { key: string; slots: Array<[string, ResolvedSlot | null, ResolvedSlot | null]> }>
>();

function resolveGenes(
  genes: Readonly<Record<string, SlotAttributes>>,
  magnitudes: AttributeMagnitudes,
  attributes: readonly string[],
): Array<[string, ResolvedSlot | null, ResolvedSlot | null]> {
  const key = attributes.join('|');
  const byMagnitudes = resolvedCache.get(genes) ?? new WeakMap();
  resolvedCache.set(genes, byMagnitudes);
  const hit = byMagnitudes.get(magnitudes);
  if (hit && hit.key === key) return hit.slots;
  const index = new Map(attributes.map((a, i) => [a, i]));
  const resolve = (gene: string, name: string | null, sign: '+' | '-' | null, expression: Expression) => {
    const attr = name ? index.get(capitalize(name)) : undefined;
    if (attr === undefined) return null;
    return { attr, points: magnitudeOf(magnitudes, gene, expression), sign: sign === '-' ? -1 : 1 } as ResolvedSlot;
  };
  const slots = Object.entries(genes).map(
    ([gene, s]) =>
      [
        gene,
        resolve(gene, s.dominantAttribute, s.dominantSign, 'dominant'),
        resolve(gene, s.recessiveAttribute, s.recessiveSign, 'recessive'),
      ] as [string, ResolvedSlot | null, ResolvedSlot | null],
  );
  byMagnitudes.set(magnitudes, { key, slots });
  return slots;
}

/**
 * The fallback when `jointProbability` gives up: a seeded sample of foals.
 * Same answers within sampling error, same answer every run.
 */
function sample(
  loci: readonly LocusOutcomes[],
  targetIdx: readonly number[],
  protectedIdx: readonly number[],
  tolerance: number,
  options: TargetedBreedingOptions,
): { pSuccess: number; pTargets: number; drops: Float64Array } {
  const samples = options.samples ?? DEFAULT_SAMPLES;
  const random = mulberry32(options.seed ?? DEFAULT_SEED);
  const width = Math.max(0, ...targetIdx, ...protectedIdx) + 1;
  const drops = new Float64Array(width);
  const foal = new Float64Array(width);
  let success = 0;
  let targetsUp = 0;
  for (let n = 0; n < samples; n++) {
    foal.fill(0);
    for (const locus of loci) {
      const u = random();
      let k = 0;
      while (k < locus.cumulative.length - 1 && u >= locus.cumulative[k]) k++;
      for (const [attr, d] of locus.deltas[k]) foal[attr] += d;
    }
    const up = targetIdx.length > 0 && targetIdx.every((i) => foal[i] > 0);
    let kept = true;
    for (const i of protectedIdx) {
      if (foal[i] < -tolerance) {
        drops[i]++;
        kept = false;
      }
    }
    if (up) targetsUp++;
    if (up && kept) success++;
  }
  for (let i = 0; i < width; i++) drops[i] /= samples;
  return { pSuccess: success / samples, pTargets: targetsUp / samples, drops };
}

function foalOutlook(
  anchor: PetLoci,
  genes: Readonly<Record<string, SlotAttributes>>,
  magnitudes: AttributeMagnitudes,
  options: TargetedBreedingOptions,
  odds: FoalOdds,
): PartnerOutlook {
  const { attributes, targets, tolerance } = options;
  const expected = new Float64Array(attributes.length);
  const better = new Float64Array(attributes.length);
  const worse = new Float64Array(attributes.length);
  const levers: Lever[] = [];
  const loci: LocusOutcomes[] = [];

  for (const [gene, dominantSlot, recessiveSlot] of resolveGenes(genes, magnitudes, attributes)) {
    // A gene acting on no attribute in play cannot move any figure here.
    if (!dominantSlot && !recessiveSlot) continue;
    const anchorType = anchor.get(gene) ?? GeneType.UNKNOWN;
    const from = expressed(anchorType);
    if (from === null) continue;
    const foal = odds(gene, anchorType);
    if (!foal || foal.dist.unknown > 0) continue;
    const { dist, partner: partnerType } = foal;

    const slot = (expression: 'dominant' | 'recessive') => (expression === 'dominant' ? dominantSlot : recessiveSlot);
    const before = slot(from);

    const outcomes: Array<{ p: number; delta: Array<[number, number]> }> = [];
    const leverByAttr = new Map<number, { expected: number; pChange: number }>();
    for (const [type, p] of [
      [GeneType.DOMINANT, dist.D],
      [GeneType.MIXED, dist.x],
      [GeneType.RECESSIVE, dist.R],
    ] as Array<[GeneType, number]>) {
      if (p === 0) continue;
      const to = expressed(type);
      if (to === from) {
        outcomes.push({ p, delta: [] });
        continue;
      }
      const after = to === null ? null : slot(to);
      const delta = new Map<number, number>();
      // Per attribute, counted once per outcome even when both slots of the
      // gene name it: the foal changes slot once.
      const touched = new Set<number>();
      /** Per attribute, the direction of the unmeasured part: leaving a slot undoes its sign. */
      const blind = new Map<number, number>();
      for (const [s, sign] of [
        [before, -1],
        [after, 1],
      ] as const) {
        if (!s) continue;
        touched.add(s.attr);
        if (s.points === undefined) blind.set(s.attr, (blind.get(s.attr) ?? 0) + sign * s.sign);
        else delta.set(s.attr, (delta.get(s.attr) ?? 0) + sign * s.points);
      }
      // Leaving one unmeasured slot for another of the same sign on the same
      // attribute nets to no direction; it is counted as worse, the side a
      // player should not be surprised by.
      for (const [attr, direction] of blind) (direction > 0 ? better : worse)[attr] += p;
      for (const attr of touched) {
        const lever = leverByAttr.get(attr) ?? { expected: 0, pChange: 0 };
        lever.pChange += p;
        lever.expected += p * (delta.get(attr) ?? 0);
        leverByAttr.set(attr, lever);
      }
      for (const [attr, d] of delta) expected[attr] += p * d;
      outcomes.push({ p, delta: [...delta].filter(([, d]) => d !== 0) });
    }

    for (const [attr, lever] of leverByAttr) {
      // A change with no measured size is in `unmeasured`; as a lever it
      // would read as a zero that is not one.
      if (targets.includes(attributes[attr]) && lever.expected !== 0) {
        levers.push({
          gene,
          attribute: attributes[attr],
          anchor: anchorType,
          partner: partnerType,
          expected: lever.expected,
          pChange: lever.pChange,
        });
      }
    }
    if (outcomes.some((o) => o.delta.length > 0)) {
      let running = 0;
      loci.push({
        probs: outcomes.map((o) => o.p),
        cumulative: outcomes.map((o) => (running += o.p)),
        deltas: outcomes.map((o) => o.delta),
      });
    }
  }

  const targetIdx = targets.map((t) => attributes.indexOf(t)).filter((i) => i !== -1);
  const protectedIdx = attributes.map((_, i) => i).filter((i) => !targetIdx.includes(i));
  const up: Condition[] = targetIdx.map((dim) => ({ dim, bound: 0, strict: true }));
  const kept = (dim: number): Condition => ({ dim, bound: -tolerance, strict: false });
  const drops = new Float64Array(attributes.length);
  let pSuccess = 0;
  let pTargets = 0;
  let pSuccessBound = 0;
  // `samples: 0` asks for the expected figures only.
  if (options.samples !== 0) {
    // Exact, and cheap: one attribute at a time (or the targets alone)
    // keeps few partial outcomes. Only the joint figure is costly.
    const exact = {
      targets: targetIdx.length > 0 ? jointProbability(loci, up) : 0,
      kept: protectedIdx.map((i) => jointProbability(loci, [kept(i)])),
    };
    const success =
      targetIdx.length === 0
        ? 0
        : options.joint === false
          ? undefined
          : jointProbability(loci, [...up, ...protectedIdx.map(kept)]);
    if (success !== null && exact.targets !== null && exact.kept.every((k) => k !== null)) {
      pTargets = exact.targets;
      protectedIdx.forEach((i, n) => {
        drops[i] = 1 - (exact.kept[n] as number);
      });
      // Within a group of linked attributes, success is at most its least
      // likely condition; across independent groups those bounds multiply.
      const single = new Map<number, number>([
        ...protectedIdx.map((i, n) => [i, exact.kept[n] as number] as [number, number]),
        ...targetIdx.map((i) => [i, settledProbability(loci, [up[targetIdx.indexOf(i)]]) ?? 1] as [number, number]),
      ]);
      pSuccessBound =
        targetIdx.length === 0
          ? 0
          : Math.min(
              pTargets,
              independentGroups(loci, [...up, ...protectedIdx.map(kept)]).reduce(
                (bound, part) => bound * Math.min(...part.map((c) => single.get(c.dim) ?? 1)),
                1,
              ),
            );
      pSuccess = success ?? pSuccessBound;
    } else {
      const sampled = sample(loci, targetIdx, protectedIdx, tolerance, options);
      pSuccess = sampled.pSuccess;
      pTargets = sampled.pTargets;
      drops.set(sampled.drops);
      pSuccessBound = pSuccess;
    }
  }

  const record = (values: Float64Array, only?: readonly number[], scale = 1) =>
    Object.fromEntries((only ?? attributes.map((_, i) => i)).map((i) => [attributes[i], values[i] * scale]));
  return {
    pSuccess,
    pTargets,
    pSuccessBound,
    expected: record(expected),
    pDrop: record(drops, protectedIdx),
    unmeasured: Object.fromEntries(attributes.map((a, i) => [a, { better: better[i], worse: worse[i] }])),
    levers: levers.sort((a, b) => Math.abs(b.expected) - Math.abs(a.expected) || b.pChange - a.pChange),
  };
}

/** At one locus, the partner genotype that does most for the targets, and what the others would cost. */
export interface PartnerNeed {
  gene: string;
  anchor: GeneType;
  /** The best partner genotype for the targets here. */
  best: 'D' | 'x' | 'R';
  /** Expected change on the targets, summed, for each partner genotype. */
  byPartner: Record<'D' | 'x' | 'R', number>;
}

/**
 * The partner the targets would want, locus by locus.
 *
 * When no stabled partner can lift the targets, the useful answer is what
 * one would have to carry. Listed only where the partner's genotype changes
 * the expected target value: loci a partner can gain on first, then loci
 * where the anchor already holds the best and a partner can only keep it.
 * Measured slots only.
 */
export function idealPartner(
  anchor: PetLoci,
  genes: Readonly<Record<string, SlotAttributes>>,
  magnitudes: AttributeMagnitudes,
  options: Pick<TargetedBreedingOptions, 'attributes' | 'targets'>,
): PartnerNeed[] {
  const needs: PartnerNeed[] = [];
  const types = ['D', 'x', 'R'] as const;
  for (const gene of Object.keys(genes)) {
    if (!anchor.has(gene)) continue;
    const one = { [gene]: genes[gene] };
    const byPartner = Object.fromEntries(
      types.map((t) => {
        const o = partnerOutlook(anchor, new Map([[gene, t]]), one, magnitudes, {
          ...options,
          tolerance: 0,
          samples: 0,
        });
        return [t, options.targets.reduce((sum, a) => sum + (o.expected[a] ?? 0), 0)];
      }),
    ) as Record<'D' | 'x' | 'R', number>;
    const values = Object.values(byPartner);
    const stake = Math.max(...values) - Math.min(...values);
    if (stake === 0) continue;
    const best = types.reduce((a, b) => (byPartner[b] > byPartner[a] ? b : a));
    needs.push({ gene, anchor: anchor.get(gene) as GeneType, best, byPartner });
  }
  // Gains first, largest first: they are what a new partner is for. Then the
  // loci where the anchor already holds the best and a partner can only
  // cost, largest stake first.
  const gainOf = (n: PartnerNeed) => Math.max(...Object.values(n.byPartner));
  const stakeOf = (n: PartnerNeed) => gainOf(n) - Math.min(...Object.values(n.byPartner));
  return needs.sort((a, b) => gainOf(b) - gainOf(a) || stakeOf(b) - stakeOf(a) || a.gene.localeCompare(b.gene));
}
