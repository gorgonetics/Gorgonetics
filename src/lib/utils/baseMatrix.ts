import type { AttributeStudy, BaselineOffset, BaselineReading, BaseSource } from './attributeStudy.js';

/**
 * Every breed's base on every attribute, on one grid.
 *
 * Each attribute's study orders its breeds by backing, and a breed with no
 * settled reading is simply absent, so reading bases attribute by attribute
 * puts the same breed in a different row each time. The grid fixes both
 * axes: breeds alphabetically (no breed last), attributes in the order given.
 */
export interface BaseCell {
  /** The breed's settled reading on this attribute, if any. */
  reading: BaselineReading | null;
  /**
   * The exact gap to another breed's base, if one is known — read either way
   * round, so the reference breed of a gap shows it too.
   */
  gap: BaselineOffset | null;
}

export interface BaseMatrix {
  attributes: string[];
  rows: Array<{ breed: string; cells: BaseCell[] }>;
}

/** `studies` in display order; the columns follow it. */
export function buildBaseMatrix(studies: readonly AttributeStudy[]): BaseMatrix {
  const breeds = new Set<string>();
  for (const { baselines } of studies) {
    for (const r of baselines.readings) breeds.add(r.breed);
    for (const o of baselines.offsets) {
      breeds.add(o.breed);
      breeds.add(o.relativeTo);
    }
  }
  const ordered = [...breeds].sort((a, b) => ((a === '') !== (b === '') ? (a === '' ? 1 : -1) : a.localeCompare(b)));

  return {
    attributes: studies.map((s) => s.attribute),
    rows: ordered.map((breed) => ({
      breed,
      cells: studies.map(({ baselines }) => ({
        reading: baselines.readings.find((r) => r.breed === breed) ?? null,
        gap: gapOf(baselines.offsets, breed),
      })),
    })),
  };
}

/**
 * The breed's own gap, else the inverse of one read against it: `Paint =
 * Kurbone + 50` is equally `Kurbone = Paint − 50`. Offsets come sorted by
 * backing, so the first match is the best supported.
 */
function gapOf(offsets: readonly BaselineOffset[], breed: string): BaselineOffset | null {
  const own = offsets.find((o) => o.breed === breed);
  if (own) return own;
  const against = offsets.find((o) => o.relativeTo === breed);
  return against ? { ...against, breed, relativeTo: against.breed, offset: 0 - against.offset } : null;
}

export const breedLabel = (breed: string) => breed || 'No breed';

export const signed = (n: number) => (n < 0 ? `−${-n}` : String(n));

export const isExactBase = (r: BaselineReading) => r.min !== null && r.min === r.max;

/**
 * Bounds that cross: no base satisfies both, so a reading or a declared sign
 * behind one of them is wrong.
 */
export const isConflict = (r: BaselineReading) => r.min !== null && r.max !== null && r.min > r.max;

/**
 * The base as the corpus pins it: exact, a range, one-sided, or not at all.
 *
 * Only the exact case is a number for the base itself. A bound is what the
 * declared signs of the unresolved slots allow, and without one the base is
 * unknown. Both sides at once come from different breeds linked by a gap.
 */
export function baseText(r: BaselineReading): string {
  if (isExactBase(r)) return signed(r.min as number);
  if (isConflict(r)) return 'conflict';
  if (r.min !== null && r.max !== null) return `${signed(r.min)} … ${signed(r.max)}`;
  if (r.max !== null) return `≤ ${signed(r.max)}`;
  if (r.min !== null) return `≥ ${signed(r.min)}`;
  return '?';
}

/** `05F2:recessive` reads as `05F2 recessive` — the colon is an internal key separator. */
export const slotLabel = (key: string) => key.replace(':', ' ');

/**
 * How the base was read: from this breed's own animals, or through a gap to
 * another breed. When the base is unknown the lump is still shown, because it
 * is what differences between breeds are read from.
 */
export function lumpText(r: BaselineReading): string {
  if (r.unresolved.length === 0) return 'exact';
  const shown = r.unresolved.slice(0, 3).map(slotLabel).join(' + ');
  const more = r.unresolved.length > 3 ? ` + ${r.unresolved.length - 3} more` : '';
  const sources = [
    r.minVia ? `≥ via ${sourceText(r.minVia)}` : null,
    r.maxVia ? `≤ via ${sourceText(r.maxVia)}` : null,
  ].filter((t) => t !== null);
  return [`base + ${shown}${more} = ${signed(r.value)}`, ...sources].join('; ');
}

const sourceText = (s: BaseSource) =>
  s.offset === 0 ? breedLabel(s.breed) : `${breedLabel(s.breed)} ${s.offset < 0 ? '−' : '+'} ${Math.abs(s.offset)}`;

/** `Kurbone + 50`: this breed's base relative to the gap's reference breed. */
export function gapText(o: BaselineOffset): string {
  if (o.offset === 0) return `= ${breedLabel(o.relativeTo)}`;
  return `${breedLabel(o.relativeTo)} ${o.offset < 0 ? '−' : '+'} ${Math.abs(o.offset)}`;
}
