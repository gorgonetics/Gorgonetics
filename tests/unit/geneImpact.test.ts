import { describe, expect, it } from 'vitest';
import type { ParsedGeneRecord } from '$lib/services/geneService.js';
import { GeneType } from '$lib/types/index.js';
import { type AttributeMagnitudes, EMPTY_MAGNITUDES } from '$lib/utils/attributePoints.js';
import {
  buildImpactCSS,
  buildImpactTooltip,
  expressedImpact,
  impactLevel,
  impactPaint,
  maxAbsPoints,
  type SlotImpact,
  slotImpact,
  summarizeImpact,
} from '$lib/utils/geneImpact.js';

const gene = (over: Partial<ParsedGeneRecord> = {}): ParsedGeneRecord => ({
  dominantAttribute: 'toughness',
  dominantSign: '+',
  recessiveAttribute: 'ferocity',
  recessiveSign: '-',
  breed: '',
  ...over,
});

const magnitudes = (points: Record<string, number>): AttributeMagnitudes => ({
  points: new Map(Object.entries(points)),
  coverage: new Map(),
});

describe('slotImpact', () => {
  it('is known where the study measured the slot, coloured by the measured sign', () => {
    const m = magnitudes({ '01A1:dominant': 3, '01A1:recessive': 2 });
    expect(slotImpact(gene(), '01A1', 'dominant', m)).toEqual({
      kind: 'known',
      attribute: 'Toughness',
      sign: '+',
      points: 3,
    });
    // Declared `-`, measured +2: the measurement wins.
    expect(slotImpact(gene(), '01A1', 'recessive', m)).toMatchObject({ kind: 'known', sign: '+', points: 2 });
  });

  it('is unknown where an effect is declared but not measured', () => {
    expect(slotImpact(gene(), '01A1', 'recessive', EMPTY_MAGNITUDES)).toEqual({
      kind: 'unknown',
      attribute: 'Ferocity',
      sign: '-',
    });
  });

  it('is none with no declared attribute, no sign, or no gene record', () => {
    expect(slotImpact(gene({ dominantAttribute: null }), '01A1', 'dominant', EMPTY_MAGNITUDES).kind).toBe('none');
    expect(slotImpact(gene({ dominantSign: null }), '01A1', 'dominant', EMPTY_MAGNITUDES).kind).toBe('none');
    expect(slotImpact(undefined, '01A1', 'dominant', EMPTY_MAGNITUDES).kind).toBe('none');
  });
});

describe('expressedImpact', () => {
  const m = magnitudes({ '01A1:dominant': 3, '01A1:recessive': -2 });

  it('reads the dominant slot for D and x, the recessive slot for R', () => {
    expect(expressedImpact(gene(), '01A1', GeneType.DOMINANT, m)).toMatchObject({ points: 3 });
    expect(expressedImpact(gene(), '01A1', GeneType.MIXED, m)).toMatchObject({ points: 3 });
    expect(expressedImpact(gene(), '01A1', GeneType.RECESSIVE, m)).toMatchObject({ points: -2 });
  });

  it('is none for an unrevealed locus or an off-breed one', () => {
    expect(expressedImpact(gene(), '01A1', GeneType.UNKNOWN, m).kind).toBe('none');
    expect(expressedImpact(gene(), '01A1', GeneType.DOMINANT, m, true).kind).toBe('none');
  });
});

describe('impactLevel', () => {
  it('scales against the table maximum, with a floor of one step', () => {
    expect(impactLevel(8, 8)).toBe(4);
    expect(impactLevel(-8, 8)).toBe(4);
    expect(impactLevel(4, 8)).toBe(2);
    expect(impactLevel(1, 8)).toBe(1);
    expect(impactLevel(0, 8)).toBe(0);
    expect(impactLevel(3, 0)).toBe(0);
  });

  it('takes the maximum over absolute values', () => {
    expect(maxAbsPoints(magnitudes({ a: 2, b: -7, c: 5 }))).toBe(7);
    expect(maxAbsPoints(EMPTY_MAGNITUDES)).toBe(0);
  });
});

describe('summarizeImpact', () => {
  it('sums known points and counts unknown slots by sign, in attribute order', () => {
    const impacts: SlotImpact[] = [
      { kind: 'known', attribute: 'Toughness', sign: '+', points: 3 },
      { kind: 'known', attribute: 'Toughness', sign: '-', points: -1 },
      { kind: 'unknown', attribute: 'Toughness', sign: '+' },
      { kind: 'unknown', attribute: 'Ferocity', sign: '-' },
      { kind: 'none' },
    ];
    expect(summarizeImpact(impacts, ['Ferocity', 'Toughness'])).toEqual([
      { attribute: 'Ferocity', points: 0, known: 0, unknownPositive: 0, unknownNegative: 1 },
      { attribute: 'Toughness', points: 2, known: 2, unknownPositive: 1, unknownNegative: 0 },
    ]);
  });

  it('puts attributes missing from the order last, by name', () => {
    const impacts: SlotImpact[] = [
      { kind: 'unknown', attribute: 'Zeal', sign: '+' },
      { kind: 'unknown', attribute: 'Agility', sign: '+' },
      { kind: 'unknown', attribute: 'Toughness', sign: '+' },
    ];
    expect(summarizeImpact(impacts, ['Toughness']).map((r) => r.attribute)).toEqual(['Toughness', 'Agility', 'Zeal']);
  });
});

describe('buildImpactCSS', () => {
  const scope = '.view-impact.gene-grid-container';

  it('groups cells by paint and labels known fills', () => {
    const css = buildImpactCSS({
      scope,
      maxAbs: 4,
      labels: true,
      cells: [
        { geneId: '01A1', fill: { kind: 'known', attribute: 'Toughness', sign: '+', points: 4 } },
        { geneId: '01A2', fill: { kind: 'known', attribute: 'Toughness', sign: '+', points: 4 } },
        { geneId: '01A3', fill: { kind: 'unknown', attribute: 'Ferocity', sign: '-' } },
        { geneId: '01A4', fill: { kind: 'none' } },
      ],
    });
    const fillRule = css.split('\n}').find((r) => r.includes('--impact-fill: var(--impact-pos-4)'));
    expect(fillRule).toContain('[data-gene-id="01A1"]');
    expect(fillRule).toContain('[data-gene-id="01A2"]');
    expect(css).toContain('--impact-label: "+4"; --impact-ink: var(--impact-ink-strong);');
    expect(css).toMatch(/01A3"\] \{ --impact-fill: var\(--impact-neg-unknown\); \}/);
    expect(css).not.toContain('01A4');
    // One rule per distinct paint, not per cell.
    expect(css.match(/--impact-fill: var\(--impact-pos-4\)/g)).toHaveLength(1);
  });

  it('paints split cells per slot and never labels them', () => {
    const css = buildImpactCSS({
      scope,
      maxAbs: 4,
      labels: true,
      cells: [
        {
          geneId: '01A1',
          dom: { kind: 'known', attribute: 'Toughness', sign: '+', points: 2 },
          rec: { kind: 'unknown', attribute: 'Ferocity', sign: '-' },
        },
      ],
    });
    expect(css).toContain('--impact-dom: var(--impact-pos-2);');
    expect(css).toContain('--impact-rec: var(--impact-neg-unknown);');
    expect(css).not.toContain('--impact-label');
  });

  it('drops a gene id that would break the selector list', () => {
    const css = buildImpactCSS({
      scope,
      maxAbs: 4,
      cells: [{ geneId: '01"A1', fill: { kind: 'unknown', attribute: 'Toughness', sign: '+' } }],
    });
    expect(css).toBe('');
  });

  it('paints a measured zero as known, not as unknown', () => {
    expect(impactPaint({ kind: 'known', attribute: 'Toughness', sign: '+', points: 0 }, 4)).toBe('var(--impact-zero)');
  });
});

describe('buildImpactTooltip', () => {
  const dom: SlotImpact = { kind: 'known', attribute: 'Toughness', sign: '+', points: 3 };
  const rec: SlotImpact = { kind: 'unknown', attribute: 'Ferocity', sign: '-' };

  it('leads with the expressed slot on a pet', () => {
    const { lines } = buildImpactTooltip(dom, rec, 'dominant');
    expect(lines[0]).toContain('Expressed:');
    expect(lines[0]).toContain('Toughness +3');
    expect(lines[1]).toContain('If recessive:');
    expect(lines[1]).toContain('size not measured');
  });

  it('lists both slots on the map, and says so when neither has an effect', () => {
    expect(buildImpactTooltip(dom, rec, null).lines).toHaveLength(2);
    expect(buildImpactTooltip({ kind: 'none' }, { kind: 'none' }, null)).toEqual({
      subtitle: 'No declared attribute effect',
      lines: [],
    });
  });

  it('escapes table-derived text', () => {
    const { lines } = buildImpactTooltip({ kind: 'unknown', attribute: '<b>X</b>', sign: '+' }, { kind: 'none' }, null);
    expect(lines[0]).toContain('&lt;b&gt;X&lt;/b&gt;');
  });
});
