import { describe, expect, it } from 'vitest';
import { GeneType } from '$lib/types/index.js';
import type { ParsedChromosome } from '$lib/utils/geneAnalysis.js';
import type { QualityContribution } from '$lib/utils/geneticQuality.js';
import {
  benefitText,
  buildQualityCSS,
  gridToLoci,
  qualityRows,
  qualityTooltip,
  rowText,
} from '$lib/utils/qualityLens.js';

const D = GeneType.DOMINANT;
const R = GeneType.RECESSIVE;

const c = (over: Partial<QualityContribution>): QualityContribution => ({
  gene: '01A1',
  allele: R,
  kind: 'add',
  attribute: 'temperament',
  standing: 'sole',
  generic: true,
  value: 1,
  ...over,
});

describe('gridToLoci', () => {
  it('reads every gene of every chromosome', () => {
    const chr = (ids: Array<[string, string]>): ParsedChromosome => ({
      blocks: [],
      allGenes: ids.map(([id, type], i) => ({ id, type, block: 'A', position: i + 1, globalPosition: i })),
    });
    const loci = gridToLoci({ '01': chr([['01A1', 'R']]), '02': chr([['02A1', 'x']]) });
    expect([...loci]).toEqual([
      ['01A1', 'R'],
      ['02A1', 'x'],
    ]);
  });
});

describe('qualityRows', () => {
  it("groups one allele's benefits into one row, most valuable first", () => {
    const rows = qualityRows([
      c({ gene: '02A1', allele: D, kind: 'add', attribute: 'toughness', standing: 'lock', value: 0.5 }),
      c({ kind: 'add', attribute: 'temperament', value: 1 }),
      c({ kind: 'clear', attribute: 'virility', value: 1 }),
    ]);
    expect(rows.map((r) => [r.gene, r.allele, r.benefits, r.value])).toEqual([
      ['01A1', 'R', ['Temperament +', 'no Virility −'], 2],
      ['02A1', 'D', ['Toughness +'], 0.5],
    ]);
    expect(rowText(rows[0])).toBe('01A1 R (Temperament +, no Virility −, only carrier)');
  });

  it('reads a slot with no attribute without a placeholder name', () => {
    expect(benefitText({ kind: 'add', attribute: null })).toBe('effect +');
  });
});

describe('buildQualityCSS', () => {
  it('sets a fill per standing and a ring on the highlighted gene, skipping unsafe ids', () => {
    const css = buildQualityCSS({
      scope: '.view-quality',
      standing: new Map([
        ['01A1', 'sole'],
        ['01A2', 'backed'],
        ['bad"]{}', 'lock'],
      ]),
      highlight: '01A1',
    });
    expect(css).toContain('.view-quality .gene-cell[data-gene-id="01A1"] { --quality-fill: var(--quality-sole); }');
    expect(css).toContain('[data-gene-id="01A2"] { --quality-fill: var(--quality-backed); }');
    expect(css).toContain('[data-gene-id="01A1"] { --quality-ring: var(--quality-highlight); }');
    expect(css).not.toContain('bad');
  });
});

describe('qualityTooltip', () => {
  it('names the standing and lists the slots at that gene', () => {
    const t = qualityTooltip('01A1', 'sole', [c({ generic: false, value: 0.1 }), c({ gene: '02A1' })]);
    expect(t.subtitle).toMatch(/^Only carrier — no other stabled pet/);
    expect(t.lines).toEqual(['R: Temperament + · breed-locked · 0.1']);
  });

  it('says so when the pet carries no benefit allele there', () => {
    expect(qualityTooltip('03A1', undefined, [])).toEqual({ subtitle: 'No benefit allele here', lines: [] });
  });
});
