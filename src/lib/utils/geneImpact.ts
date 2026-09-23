/**
 * Gene impact: what each locus is worth in attribute points, as far as the
 * study knows.
 *
 * The gene table declares a direction for a slot (`Toughness+`) and never a
 * size; `attributeStudy` recovers sizes for the slots the corpus can pin
 * down. So every slot with a declared effect is in one of two states, and
 * the lens exists to keep them apart:
 *
 *  - **known** — the study measured it; the points are the game's own units.
 *  - **unknown** — the table declares an effect but the corpus has not
 *    measured its size. It is shown in its declared sign colour, hatched,
 *    and never given an estimated number: `attributePoints` refuses to
 *    impute one, and a view that did would undo that.
 *
 * A known slot is coloured by the sign of its *measured* points, not by the
 * declared sign. The study holds the declared sign out of the solve and uses
 * it as an independent check, so when the two disagree the measurement is
 * the better evidence.
 *
 * Painting follows the rarity lens: cells are built once and this module
 * only emits the text of one injected `<style>` element, which sets custom
 * properties the static rules in `geneCell.css` read.
 *
 * Pure functions. No DB, no Svelte.
 */

import type { ParsedGeneRecord } from '$lib/services/geneService.js';
import { GeneType } from '$lib/types/index.js';
import { type AttributeMagnitudes, magnitudeOf } from '$lib/utils/attributePoints.js';
import type { Expression } from '$lib/utils/attributeStudy.js';
import { capitalize, escapeHtml } from '$lib/utils/string.js';

export type SlotImpact =
  | { kind: 'none' }
  | { kind: 'unknown'; attribute: string; sign: '+' | '-' }
  | { kind: 'known'; attribute: string; sign: '+' | '-'; points: number };

const NONE: SlotImpact = Object.freeze({ kind: 'none' });

/**
 * One slot of one gene. `attribute` comes back capitalised, matching the
 * keys `AttributeMagnitudes.coverage` and the breeding scorers use.
 */
export function slotImpact(
  gd: ParsedGeneRecord | undefined,
  geneId: string,
  expression: Expression,
  magnitudes: AttributeMagnitudes,
): SlotImpact {
  if (!gd) return NONE;
  const rawAttribute = expression === 'dominant' ? gd.dominantAttribute : gd.recessiveAttribute;
  const declaredSign = expression === 'dominant' ? gd.dominantSign : gd.recessiveSign;
  if (!rawAttribute) return NONE;
  const attribute = capitalize(rawAttribute);
  const points = magnitudeOf(magnitudes, geneId, expression);
  if (points !== undefined) return { kind: 'known', attribute, sign: points < 0 ? '-' : '+', points };
  // An attribute with no sign is not a declaration anything can be read from.
  if (!declaredSign) return NONE;
  return { kind: 'unknown', attribute, sign: declaredSign };
}

/**
 * The slot a pet actually expresses at a locus: `D` and `x` express the
 * dominant effect, `R` the recessive one, and `?` nothing knowable — the
 * same rule `expressedSign` encodes for the breeding scorers.
 */
export function expressedSlot(type: GeneType | string): Expression | null {
  if (type === GeneType.DOMINANT || type === GeneType.MIXED) return 'dominant';
  if (type === GeneType.RECESSIVE) return 'recessive';
  return null;
}

/** What one pet's locus contributes, or `none` for `?` and off-breed loci. */
export function expressedImpact(
  gd: ParsedGeneRecord | undefined,
  geneId: string,
  type: GeneType | string,
  magnitudes: AttributeMagnitudes,
  inactive = false,
): SlotImpact {
  const expression = expressedSlot(type);
  if (!expression || inactive) return NONE;
  return slotImpact(gd, geneId, expression, magnitudes);
}

/** Ramp steps for a known slot's colour intensity. */
export const IMPACT_LEVELS = 4;

/** The largest absolute magnitude in the table: the top of the colour ramp. */
export function maxAbsPoints(magnitudes: AttributeMagnitudes): number {
  let max = 0;
  for (const value of magnitudes.points.values()) max = Math.max(max, Math.abs(value));
  return max;
}

/**
 * Ramp step (1..IMPACT_LEVELS) for a known magnitude, or 0 for a measured
 * zero. Relative to the table's own maximum: the study reports sizes in
 * game units, and no fixed scale is known to fit every attribute.
 */
export function impactLevel(points: number, maxAbs: number): number {
  if (points === 0 || maxAbs <= 0) return 0;
  return Math.min(IMPACT_LEVELS, Math.max(1, Math.ceil((IMPACT_LEVELS * Math.abs(points)) / maxAbs)));
}

/** Signed points as a label: `+3`, `-2`, `0`. */
export function formatPoints(points: number): string {
  return points > 0 ? `+${points}` : String(points);
}

/** One attribute's total over a pet's expressed loci. */
export interface AttributeImpact {
  attribute: string;
  /** Sum of the known slots' points. */
  points: number;
  /** Expressed slots with a known size. */
  known: number;
  /** Expressed slots with a declared effect but no known size, by declared sign. */
  unknownPositive: number;
  unknownNegative: number;
}

/**
 * Per-attribute totals, ordered by `attributeOrder` and then by name for
 * anything it does not list. The total is a partial sum over the known
 * slots, not a bound: an unknown negative slot leaves it too high exactly as
 * an unknown positive one leaves it too low, which is why the unknown counts
 * travel with it.
 */
export function summarizeImpact(
  impacts: Iterable<SlotImpact>,
  attributeOrder: readonly string[] = [],
): AttributeImpact[] {
  const byAttribute = new Map<string, AttributeImpact>();
  for (const impact of impacts) {
    if (impact.kind === 'none') continue;
    let row = byAttribute.get(impact.attribute);
    if (!row) {
      row = { attribute: impact.attribute, points: 0, known: 0, unknownPositive: 0, unknownNegative: 0 };
      byAttribute.set(impact.attribute, row);
    }
    if (impact.kind === 'known') {
      row.points += impact.points;
      row.known++;
    } else if (impact.sign === '+') {
      row.unknownPositive++;
    } else {
      row.unknownNegative++;
    }
  }
  const rank = (attribute: string) => {
    const i = attributeOrder.indexOf(attribute);
    return i < 0 ? attributeOrder.length : i;
  };
  return [...byAttribute.values()].sort(
    (a, b) => rank(a.attribute) - rank(b.attribute) || a.attribute.localeCompare(b.attribute),
  );
}

// --- Stylesheet --------------------------------------------------------------

/** Same guard as the rarity sheet: one bad id would void a whole selector list. */
const SAFE_GENE_ID = /^[A-Za-z0-9_-]+$/;

/** The custom-property value that paints a slot. */
export function impactPaint(impact: SlotImpact, maxAbs: number): string | null {
  if (impact.kind === 'none') return null;
  const arm = impact.sign === '+' ? 'pos' : 'neg';
  if (impact.kind === 'unknown') return `var(--impact-${arm}-unknown)`;
  const level = impactLevel(impact.points, maxAbs);
  return level === 0 ? 'var(--impact-zero)' : `var(--impact-${arm}-${level})`;
}

/** One rendered cell and the slot(s) it paints. */
export interface ImpactCell {
  geneId: string;
  /** Whole-cell paint (a pet's expressed slot). */
  fill?: SlotImpact;
  /** Split paints (the genome map: dominant bottom-right, recessive top-left). */
  dom?: SlotImpact;
  rec?: SlotImpact;
}

export interface ImpactCSSInput {
  /** Container selector the rules are scoped under. */
  scope: string;
  cells: Iterable<ImpactCell>;
  maxAbs: number;
  /** Emit a points label on known whole-cell fills. */
  labels?: boolean;
}

/**
 * Group cells by paint and emit one rule per group, so the sheet grows with
 * the number of distinct paints (a dozen) rather than with the genome.
 */
export function buildImpactCSS({ scope, cells, maxAbs, labels = false }: ImpactCSSInput): string {
  const groups = new Map<string, string[]>();
  const add = (declaration: string, geneId: string) => {
    const list = groups.get(declaration);
    if (list) list.push(geneId);
    else groups.set(declaration, [geneId]);
  };

  for (const cell of cells) {
    if (!SAFE_GENE_ID.test(cell.geneId)) continue;
    if (cell.fill) {
      const paint = impactPaint(cell.fill, maxAbs);
      if (paint) add(`--impact-fill: ${paint};`, cell.geneId);
      if (labels && cell.fill.kind === 'known') {
        const strong = impactLevel(cell.fill.points, maxAbs) >= 3;
        add(
          `--impact-label: "${formatPoints(cell.fill.points)}";${strong ? ' --impact-ink: var(--impact-ink-strong);' : ''}`,
          cell.geneId,
        );
      }
    }
    if (cell.dom) {
      const paint = impactPaint(cell.dom, maxAbs);
      if (paint) add(`--impact-dom: ${paint};`, cell.geneId);
    }
    if (cell.rec) {
      const paint = impactPaint(cell.rec, maxAbs);
      if (paint) add(`--impact-rec: ${paint};`, cell.geneId);
    }
  }

  const out: string[] = [];
  for (const [declaration, ids] of groups) {
    const selectors = ids.map((id) => `${scope} .gene-cell[data-gene-id="${id}"]`).join(',\n');
    out.push(`${selectors} { ${declaration} }`);
  }
  return out.join('\n');
}

// --- Tooltip -----------------------------------------------------------------

function describeSlot(label: string, impact: SlotImpact): string | null {
  if (impact.kind === 'none') return null;
  const colour = impact.sign === '+' ? 'var(--gene-positive)' : 'var(--gene-negative)';
  const attribute = escapeHtml(impact.attribute);
  if (impact.kind === 'known') {
    return `${label}: <span style="color: ${colour}">${attribute} ${formatPoints(impact.points)}</span>`;
  }
  return `${label}: <span style="color: ${colour}">${attribute}${impact.sign}</span> <span style="color: var(--text-muted)">· size not measured</span>`;
}

/**
 * Tooltip lines for a locus. `expressed` names the slot the pet expresses,
 * or is `null` on the genome map, which has no pet and lists both slots
 * alike. Lines are HTML (GeneTooltip renders them with `{@html}`), so every
 * table-derived string goes through `escapeHtml`.
 */
export function buildImpactTooltip(
  dom: SlotImpact,
  rec: SlotImpact,
  expressed: Expression | null,
): { subtitle: string; lines: string[] } {
  const lines: string[] = [];
  if (expressed === null) {
    for (const line of [describeSlot('Dominant', dom), describeSlot('Recessive', rec)]) if (line) lines.push(line);
    return { subtitle: lines.length > 0 ? '' : 'No declared attribute effect', lines };
  }
  const own = expressed === 'dominant' ? dom : rec;
  const other = expressed === 'dominant' ? rec : dom;
  const ownLine = describeSlot('Expressed', own);
  lines.push(ownLine ?? 'Expressed: <span style="color: var(--text-muted)">no attribute effect</span>');
  const otherLine = describeSlot(expressed === 'dominant' ? 'If recessive' : 'If dominant', other);
  if (otherLine) lines.push(otherLine);
  return { subtitle: '', lines };
}
