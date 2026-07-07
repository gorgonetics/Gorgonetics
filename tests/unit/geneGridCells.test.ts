import { describe, expect, it } from 'vitest';
import { getAppearanceAttributes } from '$lib/services/configService.js';
import {
  buildAppearanceLookup,
  computeGeneCellSize,
  createGeneCellBuilder,
  GENE_CELL_DEFAULT,
  GENE_CELL_MAX,
  GENE_CELL_MIN,
} from '$lib/utils/geneGridCells.js';

const effectsDB = {
  // dominant positive
  '01A1': { effectDominant: 'Toughness+', effectRecessive: 'None', breed: '', appearance: '', notes: '' },
  // recessive negative
  '01A2': { effectDominant: 'None', effectRecessive: 'Speed-', breed: '', appearance: '', notes: '' },
  // potential positive
  '01A3': { effectDominant: 'Potential Intelligence+', effectRecessive: 'None', breed: '', appearance: '', notes: '' },
  // breed-tagged
  '01A4': { effectDominant: 'Toughness+', effectRecessive: 'None', breed: 'Arabian', appearance: '', notes: '' },
  // appearance-only
  '01A5': { effectDominant: 'None', effectRecessive: 'None', breed: '', appearance: 'Coat black', notes: '' },
};

const ctx = {
  effectsDB,
  attributeNames: ['Toughness', 'Speed', 'Intelligence'],
  appearanceLookup: new Map([['coat', 'coat']]),
  speciesKey: 'horse',
};

describe('createGeneCellBuilder.analyzeGene', () => {
  const { analyzeGene } = createGeneCellBuilder(ctx);

  it('classifies a dominant positive', () => {
    const a = analyzeGene('01A1', 'D');
    expect(a.effectType).toBe('positive');
    expect(a.attribute).toBe('Toughness');
  });

  it('classifies a recessive negative for an R allele', () => {
    const a = analyzeGene('01A2', 'R');
    expect(a.effectType).toBe('negative');
    expect(a.attribute).toBe('Speed');
  });

  it('classifies a potential positive', () => {
    const a = analyzeGene('01A3', 'D');
    expect(a.effectType).toBe('potential-positive');
    expect(a.attribute).toBe('Intelligence');
  });

  it('returns the breed and a neutral type for a no-effect allele', () => {
    // 01A1's recessive side is "None" → no effect for an R allele.
    const a = analyzeGene('01A1', 'R');
    expect(a.effectType).toBe('neutral');
    expect(a.attribute).toBeNull();
    expect(analyzeGene('01A4', 'D').breed).toBe('Arabian');
  });
});

describe('createGeneCellBuilder.categorizeAppearance', () => {
  const { categorizeAppearance } = createGeneCellBuilder(ctx);

  it('matches an appearance prefix for horses', () => {
    expect(categorizeAppearance('01A5')).toBe('coat');
  });

  it('returns empty for None / missing / placeholder appearance', () => {
    expect(categorizeAppearance('01A1')).toBe('');
    expect(categorizeAppearance('99Z9')).toBe('');
  });
});

describe('createGeneCellBuilder.makeCell', () => {
  const { makeCell } = createGeneCellBuilder(ctx);

  it('builds attribute and appearance CSS classes for a dominant cell', () => {
    const cell = makeCell({ id: '01A1', type: 'D' });
    expect(cell.attributeCls).toBe('gene-cell gene-positive gene-dominant');
    expect(cell.attribute).toBe('Toughness');
    expect(cell.type).toBe('D');
  });

  it('uses the mixed zygosity class for x alleles', () => {
    const cell = makeCell({ id: '01A2', type: 'x' });
    // 01A2's dominant side is "None", so the attribute view is neutral.
    expect(cell.attributeCls).toBe('gene-cell gene-neutral gene-mixed');
  });

  it('renders unknown alleles as neutral/unknown in both views', () => {
    const cell = makeCell({ id: '01A1', type: '?' });
    expect(cell.attributeCls).toBe('gene-cell gene-neutral gene-unknown');
    expect(cell.appearanceCls).toBe('gene-cell gene-neutral gene-unknown');
  });

  it('falls back to appearance-neutral when no appearance matches', () => {
    const cell = makeCell({ id: '01A1', type: 'D' });
    expect(cell.appearanceCls).toBe('gene-cell gene-appearance-neutral gene-dominant');
  });
});

describe('computeGeneCellSize', () => {
  // 48 gene columns across 12 blocks — the horse chr01 shape.
  const shape = { totalColumns: 48, blockCount: 12 };

  it('falls back to the default before the container is measured', () => {
    expect(computeGeneCellSize({ containerWidth: 0, ...shape })).toBe(GENE_CELL_DEFAULT);
  });

  it('falls back to the default when there are no columns', () => {
    expect(computeGeneCellSize({ containerWidth: 1200, totalColumns: 0, blockCount: 0 })).toBe(GENE_CELL_DEFAULT);
  });

  it('scales cells up to fill a wide container', () => {
    // 1334 wide: (1334 - 28 - 96 - 4) / 48 = 25.1 → 25
    expect(computeGeneCellSize({ containerWidth: 1334, ...shape })).toBe(25);
  });

  it('shrinks cells to fit a narrow container (stats drawer open)', () => {
    // 862 wide: (862 - 28 - 96 - 4) / 48 = 15.3 → 15
    expect(computeGeneCellSize({ containerWidth: 862, ...shape })).toBe(15);
  });

  it('never produces a size that overflows the width budget', () => {
    for (const containerWidth of [400, 700, 862, 1000, 1200, 1334, 1920, 3000]) {
      const size = computeGeneCellSize({ containerWidth, ...shape });
      const consumed = 28 + shape.blockCount * 8 + shape.totalColumns * size;
      // Only assert the fit when cells are not pinned to the min (a container
      // too small for MIN_CELL legitimately overflows and scrolls).
      if (size > GENE_CELL_MIN) expect(consumed).toBeLessThanOrEqual(containerWidth);
    }
  });

  it('clamps to the readable min and max bounds', () => {
    expect(computeGeneCellSize({ containerWidth: 100, ...shape })).toBe(GENE_CELL_MIN);
    expect(computeGeneCellSize({ containerWidth: 100000, ...shape })).toBe(GENE_CELL_MAX);
  });
});

describe('buildAppearanceLookup', () => {
  it('maps lowercased appearance names back to their keys', () => {
    const lookup = buildAppearanceLookup('horse');
    const attrs = getAppearanceAttributes('horse');
    for (const [key, info] of Object.entries(attrs)) {
      expect(lookup.get(info.name.toLowerCase())).toBe(key);
    }
  });
});
