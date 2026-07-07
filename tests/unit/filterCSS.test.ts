import { describe, expect, it } from 'vitest';
import {
  attributeFilterCSS,
  buildFilterCSS,
  buildVisualizerFilterCSS,
  type VisualizerFilterInput,
} from '$lib/utils/filterCSS.js';

const FILTERED = '{ opacity: 0.15 !important; filter: grayscale(1) !important; pointer-events: none !important; }';
const HIDDEN = '{ display: none !important; }';
const INACTIVE = '{ background-color: #e8e8ec !important; border-color: #d0d0d6 !important; opacity: 0.5 !important; }';
const DIMMED = '{ opacity: 0.2 !important; }';

const base = {
  selectedAttributes: [],
  hiddenAttributes: [],
  selectedAppearances: [],
  hiddenAppearances: [],
  breedFilter: '',
  selectedChromosomes: [],
  hiddenChromosomes: [],
  showDiffsOnly: false,
  isHorse: false,
  currentView: 'attribute' as 'appearance' | 'attribute',
  chrBreedRelevance: {},
};

describe('buildFilterCSS', () => {
  it('returns an empty string when no filters are active', () => {
    expect(buildFilterCSS(base)).toBe('');
  });

  it('dims non-selected attribute cells via a :not() chain', () => {
    const css = buildFilterCSS({ ...base, selectedAttributes: ['Toughness', 'Speed'] });
    expect(css).toBe(
      `.grid-container .gene-cell[data-attr]:not([data-attr="Toughness"]):not([data-attr="Speed"]) ${FILTERED}`,
    );
  });

  it('dims a hidden attribute cell directly', () => {
    const css = buildFilterCSS({ ...base, hiddenAttributes: ['Toughness'] });
    expect(css).toBe(`.grid-container .gene-cell[data-attr="Toughness"] ${FILTERED}`);
  });

  it('targets data-appearance in the appearance view', () => {
    const css = buildFilterCSS({ ...base, currentView: 'appearance', selectedAppearances: ['coat'] });
    expect(css).toBe(`.grid-container .gene-cell[data-appearance]:not([data-appearance="coat"]) ${FILTERED}`);
  });

  it('hides chromosomes outside an active selection', () => {
    const css = buildFilterCSS({ ...base, selectedChromosomes: ['1', '3'] });
    expect(css).toBe(`.grid-container tr[data-chr]:not([data-chr="1"]):not([data-chr="3"]) ${HIDDEN}`);
  });

  it('hides explicitly hidden chromosomes', () => {
    const css = buildFilterCSS({ ...base, hiddenChromosomes: ['2'] });
    expect(css).toBe(`.grid-container tr[data-chr="2"] ${HIDDEN}`);
  });

  it('applies breed filtering only for horses', () => {
    const filters = {
      ...base,
      isHorse: true,
      breedFilter: 'Arabian',
      chrBreedRelevance: {
        1: { generic: true, breeds: new Set<string>() },
        2: { generic: false, breeds: new Set(['Clydesdale']) },
      },
    };
    const css = buildFilterCSS(filters);
    expect(css).toContain(
      `.grid-container .gene-cell[data-breed]:not([data-breed=""]):not([data-breed="Arabian"]) ${INACTIVE}`,
    );
    // Chromosome 2 is breed-specific and irrelevant to Arabian → hidden; chr 1 is generic → kept.
    expect(css).toContain(`.grid-container tr[data-chr="2"] ${HIDDEN}`);
    expect(css).not.toContain('tr[data-chr="1"]');
  });

  it('ignores the breed filter when not a horse', () => {
    const css = buildFilterCSS({ ...base, isHorse: false, breedFilter: 'Arabian' });
    expect(css).toBe('');
  });

  it('dims non-diff cells and hides diff-free rows in diffs-only mode', () => {
    const css = buildFilterCSS({ ...base, showDiffsOnly: true });
    expect(css).toContain(`.grid-container td[data-isdiff="false"][data-hascell="true"] ${DIMMED}`);
    expect(css).toContain(`.grid-container tr[data-hasdiffs="false"] ${HIDDEN}`);
  });
});

describe('attributeFilterCSS', () => {
  it('returns an empty string when nothing is selected or hidden', () => {
    expect(attributeFilterCSS('.trio-grid-container', '*', [], [])).toBe('');
  });

  it('dims everything but the selected attributes, scoped to the given grid/cell selectors', () => {
    const css = attributeFilterCSS('.trio-grid-container', '*', ['Speed'], []);
    expect(css).toBe(`.trio-grid-container *[data-attr]:not([data-attr="Speed"]) ${FILTERED}`);
  });

  it('dims a hidden attribute directly', () => {
    const css = attributeFilterCSS('.trio-grid-container', '*', [], ['Toughness']);
    expect(css).toBe(`.trio-grid-container *[data-attr="Toughness"] ${FILTERED}`);
  });
});

describe('buildVisualizerFilterCSS', () => {
  const DIM = '{ opacity: 0.25 !important; filter: grayscale(1) !important; pointer-events: none !important; }';
  const VG = '.gene-grid-container';

  const base: VisualizerFilterInput = {
    selectedChromosomes: [],
    hiddenChromosomes: [],
    selectedAttributes: [],
    hiddenAttributes: [],
    currentEffectFilter: [],
    hiddenEffectFilters: [],
    currentValueFilter: [],
    hiddenValueFilters: [],
    currentView: 'attribute',
    breedFilter: '',
    isHorse: false,
    chrBreedRelevance: {},
  };

  it('returns an empty string when no filters are active', () => {
    expect(buildVisualizerFilterCSS(base)).toBe('');
  });

  it('dims 0.25 (the pinned dim value), never touching fill', () => {
    const css = buildVisualizerFilterCSS({ ...base, hiddenChromosomes: ['02'] });
    expect(css).toContain('opacity: 0.25 !important');
    expect(css).not.toContain('background');
  });

  it('dims cells on non-selected chromosome rows (does not hide them)', () => {
    const css = buildVisualizerFilterCSS({ ...base, selectedChromosomes: ['01', '03'] });
    expect(css).toBe(
      `${VG} tr[data-chromosome]:not([data-chromosome="01"]):not([data-chromosome="03"]) .gene-cell ${DIM}`,
    );
  });

  it('dims cells on an explicitly hidden chromosome row', () => {
    const css = buildVisualizerFilterCSS({ ...base, hiddenChromosomes: ['02'] });
    expect(css).toBe(`${VG} tr[data-chromosome="02"] .gene-cell ${DIM}`);
  });

  it('attribute view: dims cells not affecting any selected attribute (either allele, delimited)', () => {
    const css = buildVisualizerFilterCSS({ ...base, selectedAttributes: ['Toughness', 'Speed'] });
    expect(css).toBe(
      `${VG} .gene-cell[data-attrs]:not([data-attrs*="·Toughness·"]):not([data-attrs*="·Speed·"]) ${DIM}`,
    );
  });

  it('attribute view: dims a hidden attribute by its single active attribute', () => {
    const css = buildVisualizerFilterCSS({ ...base, hiddenAttributes: ['Toughness'] });
    expect(css).toBe(`${VG} .gene-cell[data-attr="Toughness"] ${DIM}`);
  });

  it('appearance view: dims by the single appearance category', () => {
    const css = buildVisualizerFilterCSS({ ...base, currentView: 'appearance', selectedAttributes: ['coat'] });
    expect(css).toBe(`${VG} .gene-cell[data-appearance]:not([data-appearance="coat"]) ${DIM}`);
  });

  it('applies the effect filter only in the attribute view', () => {
    const attr = buildVisualizerFilterCSS({ ...base, currentEffectFilter: ['positive'] });
    expect(attr).toBe(`${VG} .gene-cell[data-effecttype]:not([data-effecttype="positive"]) ${DIM}`);
    const app = buildVisualizerFilterCSS({ ...base, currentView: 'appearance', currentEffectFilter: ['positive'] });
    expect(app).toBe('');
  });

  it('applies the value (zygosity) filter in both views', () => {
    const css = buildVisualizerFilterCSS({ ...base, currentValueFilter: ['gene-dominant'] });
    expect(css).toBe(`${VG} .gene-cell[data-zygosity]:not([data-zygosity="dominant"]) ${DIM}`);
  });

  it('hides whole chromosome rows for a breed with no relevant gene (horse only)', () => {
    const css = buildVisualizerFilterCSS({
      ...base,
      isHorse: true,
      breedFilter: 'Arabian',
      chrBreedRelevance: {
        '01': { generic: true, breeds: new Set<string>() },
        '02': { generic: false, breeds: new Set(['Clydesdale']) },
        '03': { generic: false, breeds: new Set(['Arabian']) },
      },
    });
    expect(css).toContain(`${VG} tr[data-chromosome="02"] { display: none !important; }`);
    expect(css).not.toContain('tr[data-chromosome="01"]');
    expect(css).not.toContain('tr[data-chromosome="03"]');
  });

  it('ignores the breed filter when not a horse', () => {
    const css = buildVisualizerFilterCSS({ ...base, isHorse: false, breedFilter: 'Arabian' });
    expect(css).toBe('');
  });

  it('recolors latent-effect cells when exactly one attribute is selected (attribute view)', () => {
    const css = buildVisualizerFilterCSS({ ...base, selectedAttributes: ['Toughness'] });
    expect(css).toContain(`${VG} .gene-cell[data-ctxpos*="·Toughness·"].gene-dominant`);
    expect(css).toContain('var(--gene-potential-positive)');
    expect(css).toContain(`${VG} .gene-cell[data-ctxneg*="·Toughness·"].gene-mixed`);
    expect(css).toContain('var(--gene-potential-negative)');
  });

  it('does not recolor when multiple attributes are selected', () => {
    const css = buildVisualizerFilterCSS({ ...base, selectedAttributes: ['Toughness', 'Speed'] });
    expect(css).not.toContain('data-ctxpos');
  });
});
