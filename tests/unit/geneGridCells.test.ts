import { describe, expect, it } from 'vitest';
import { getAppearanceAttributes } from '$lib/services/configService.js';
import { buildAppearanceLookup, createGeneCellBuilder } from '$lib/utils/geneGridCells.js';

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

describe('buildAppearanceLookup', () => {
  it('maps lowercased appearance names back to their keys', () => {
    const lookup = buildAppearanceLookup('horse');
    const attrs = getAppearanceAttributes('horse');
    for (const [key, info] of Object.entries(attrs)) {
      expect(lookup.get(info.name.toLowerCase())).toBe(key);
    }
  });
});
