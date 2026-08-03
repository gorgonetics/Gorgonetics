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

  it('emits at most 10 bucket rules however many cells there are', () => {
    // 200 loci across all five buckets on both arms.
    const map: Record<string, { D: number; R: number }> = {};
    const list: [string, GeneType][] = [];
    for (let i = 0; i < 200; i++) {
      const id = `01A${i}`;
      map[id] = { D: i % 5, R: (i + 2) % 5 };
      list.push([id, X]);
    }
    const css = buildRarityCSS({ cells: cells(...list), lookup: stub(map) });
    const rules = css.split('}').filter((r) => r.trim()).length;
    expect(rules).toBeLessThanOrEqual(10);
    // ...and every locus is still covered.
    for (let i = 0; i < 200; i++) expect(css).toContain(`data-gene-id="01A${i}"`);
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

  it('returns empty CSS for an empty grid rather than a stray rule', () => {
    expect(buildRarityCSS({ cells: [], lookup: stub({}) })).toBe('');
  });
});
