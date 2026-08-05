import { describe, expect, it } from 'vitest';
import { GeneType } from '$lib/types/index.js';
import { buildRarityCSS, type RarityBucketSource, type RarityCell } from '$lib/utils/rarityCSS.js';

const D = GeneType.DOMINANT;
const R = GeneType.RECESSIVE;
const X = GeneType.MIXED;
const Q = GeneType.UNKNOWN;

/** Stub baseline: per-locus buckets keyed by allele. `null` = below minKnown. */
function stub(map: Record<string, { D?: number | null; R?: number | null }>): RarityBucketSource {
  return {
    bucketOf: (geneId, allele) => map[geneId]?.[allele as 'D' | 'R'] ?? null,
  };
}

const cells = (...pairs: [string, GeneType][]): RarityCell[] => pairs.map(([geneId, type]) => ({ geneId, type }));

describe('buildRarityCSS', () => {
  it('gives a pure D cell only the dominant property', () => {
    const css = buildRarityCSS({
      cells: cells(['01A1', D]),
      lookup: stub({ '01A1': { D: 3, R: 0 } }),
    });
    expect(css).toContain('--rarity-dom: var(--rarity-d-3)');
    expect(css).not.toContain('--rarity-rec');
  });

  it('gives a pure R cell only the recessive property', () => {
    const css = buildRarityCSS({
      cells: cells(['01A1', R]),
      lookup: stub({ '01A1': { D: 0, R: 4 } }),
    });
    expect(css).toContain('--rarity-rec: var(--rarity-r-4)');
    expect(css).not.toContain('--rarity-dom');
  });

  it('gives a mixed cell BOTH properties — that is what makes the split read', () => {
    const css = buildRarityCSS({
      cells: cells(['01A1', X]),
      lookup: stub({ '01A1': { D: 0, R: 4 } }),
    });
    expect(css).toContain('--rarity-dom: var(--rarity-d-0)');
    expect(css).toContain('--rarity-rec: var(--rarity-r-4)');
  });

  it('emits at most 13 rules however many cells there are', () => {
    // 200 loci across all six buckets on both arms: 12 bucket rules plus the
    // never-seen edge rule. Two arms × six steps never needs crossing.
    const map: Record<string, { D: number; R: number }> = {};
    const list: [string, GeneType][] = [];
    for (let i = 0; i < 200; i++) {
      const id = `01A${i}`;
      map[id] = { D: i % 6, R: (i + 2) % 6 };
      list.push([id, X]);
    }
    const css = buildRarityCSS({ cells: cells(...list), lookup: stub(map) });
    const rules = css.split('}').filter((r) => r.trim()).length;
    expect(rules).toBeLessThanOrEqual(13);
    // ...and every locus is still covered.
    for (let i = 0; i < 200; i++) expect(css).toContain(`data-gene-id="01A${i}"`);
  });

  it('marks a never-seen cell with the distinct edge as well as the pure hue', () => {
    // Two channels on purpose: the map is scanned rather than read, so an allele
    // nobody owns should be findable without comparing shades.
    const css = buildRarityCSS({
      cells: cells(['01A1', X]),
      lookup: stub({ '01A1': { D: 0, R: 5 } }),
    });
    expect(css).toContain('--rarity-rec: var(--rarity-r-5)');
    expect(css).toContain('--rarity-edge: var(--rarity-never-edge)');
  });

  it('changes only the edge COLOUR, never geometry', () => {
    // §4's rule is uniform geometry: a wider or dashed edge on these cells would
    // shrink their fill and make them read as smaller than their neighbours. The
    // rule may only set the colour custom property.
    const css = buildRarityCSS({
      cells: cells(['01A1', X]),
      lookup: stub({ '01A1': { D: 0, R: 5 } }),
    });
    expect(css).not.toContain('border-width');
    expect(css).not.toContain('border-style');
    expect(css).not.toContain('padding');
  });

  it('fires the edge on the dominant arm too', () => {
    const css = buildRarityCSS({
      cells: cells(['01A1', D]),
      lookup: stub({ '01A1': { D: 5 } }),
    });
    expect(css).toContain('--rarity-edge: var(--rarity-never-edge)');
  });

  it('leaves every other cell on the uniform hairline', () => {
    // Including a sole carrier: one step below, and not a different KIND of
    // reading, so it must not borrow the marker.
    const css = buildRarityCSS({
      cells: cells(['01A1', D], ['01A2', X]),
      lookup: stub({ '01A1': { D: 4 }, '01A2': { D: 0, R: 4 } }),
    });
    expect(css).not.toContain('--rarity-edge');
  });

  it('does not mark a cell for an arm it does not carry', () => {
    // The recessive allele is never seen, but this pet is pure D — the cell says
    // nothing about the recessive arm, so it takes no marker.
    const css = buildRarityCSS({
      cells: cells(['01A1', D]),
      lookup: stub({ '01A1': { D: 0, R: 5 } }),
    });
    expect(css).not.toContain('--rarity-edge');
  });

  it('groups loci sharing a bucket into one selector list', () => {
    const css = buildRarityCSS({
      cells: cells(['01A1', D], ['01A2', D], ['01A3', D]),
      lookup: stub({ '01A1': { D: 2 }, '01A2': { D: 2 }, '01A3': { D: 2 } }),
    });
    expect(css.match(/--rarity-dom/g)).toHaveLength(1);
    expect(css).toContain('data-gene-id="01A1"');
    expect(css).toContain('data-gene-id="01A3"');
  });

  it('skips ? cells — gene-unknown already renders them dashed', () => {
    const css = buildRarityCSS({
      cells: cells(['01A1', Q]),
      lookup: stub({ '01A1': { D: 4, R: 4 } }),
    });
    expect(css).toBe('');
  });

  it('lists below-minKnown cells explicitly, since nothing else styles them', () => {
    // The locus is measurable for neither arm → missing data, NOT bucket 0.
    const css = buildRarityCSS({
      cells: cells(['01A1', D], ['01A2', X]),
      lookup: stub({ '01A1': { D: null }, '01A2': { D: null, R: null } }),
    });
    expect(css).toContain('border-style: dashed');
    expect(css).toContain('data-gene-id="01A1"');
    expect(css).toContain('data-gene-id="01A2"');
    expect(css).not.toContain('--rarity-dom');
  });

  it('outweighs the static zygosity fills instead of relying on source order', () => {
    // The missing rule sets `background` directly, so it competes with
    // `.view-rarity.gene-grid-container .gene-cell[data-zygosity=…]` at (0,4,0).
    // The repeated class lifts it to (0,5,0) and settles the tie.
    const css = buildRarityCSS({
      cells: cells(['01A1', D]),
      lookup: stub({ '01A1': { D: null } }),
    });
    expect(css).toContain('.gene-cell.gene-cell[data-gene-id="01A1"]');
  });

  it('does not treat a one-armed null as missing when the other arm scores', () => {
    // A pure D cell only ever consults the dominant arm; the recessive arm
    // being unscored is irrelevant to it.
    const css = buildRarityCSS({
      cells: cells(['01A1', D]),
      lookup: stub({ '01A1': { D: 1, R: null } }),
    });
    expect(css).toContain('--rarity-dom: var(--rarity-d-1)');
    expect(css).not.toContain('dashed');
  });

  it('scopes every rule to the rarity view so the other views are untouched', () => {
    const css = buildRarityCSS({
      cells: cells(['01A1', D]),
      lookup: stub({ '01A1': { D: 0 } }),
    });
    for (const selector of css.split('{')[0].split(',')) {
      expect(selector.trim()).toMatch(/^\.view-rarity\.gene-grid-container /);
    }
  });

  it('drops a gene id that cannot be written into a selector', () => {
    // Ids come from the `genes` table, so they are data. A CSS selector LIST is
    // discarded whole when one selector in it is invalid, so an id carrying a
    // quote would strip the tint from every other locus in its bucket.
    const css = buildRarityCSS({
      cells: cells(['01A1', D], ['bad"id', D], ['01A2', D]),
      lookup: stub({ '01A1': { D: 2 }, 'bad"id': { D: 2 }, '01A2': { D: 2 } }),
    });
    expect(css).not.toContain('bad"id');
    // ...and its bucket-mates survive.
    expect(css).toContain('data-gene-id="01A1"');
    expect(css).toContain('data-gene-id="01A2"');
  });

  it('returns empty CSS for an empty grid rather than a stray rule', () => {
    expect(buildRarityCSS({ cells: [], lookup: stub({}) })).toBe('');
  });
});
