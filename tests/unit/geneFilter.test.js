import { describe, expect, it } from 'vitest';
import { isGeneVisible } from '$lib/utils/geneFilter.js';

const empty = {
  selectedChromosomes: [],
  hiddenChromosomes: [],
  selectedAttributes: [],
  hiddenAttributes: [],
  currentEffectFilter: [],
  hiddenEffectFilters: [],
  currentValueFilter: [],
  hiddenValueFilters: [],
  currentView: 'attribute',
};

// Effect lookup that never matches anything (the common case for filter tests
// that don't exercise the effect-database-backed branches).
const noEffects = {
  affectsSelectedAttributes: () => false,
  hasAnyPotentialEffect: () => false,
  potentialEffectType: () => null,
};

const gene = { id: '01A1', type: 'D' };
const analysis = { type: 'positive', attribute: 'Toughness' };

describe('isGeneVisible — regression #309', () => {
  it('appearance view: hides a null-attribute gene when a specific attribute is selected', () => {
    expect(
      isGeneVisible(
        '1',
        gene,
        { type: 'inactive-breed', attribute: null },
        { ...empty, currentView: 'appearance', selectedAttributes: ['Coat'] },
        noEffects,
      ),
    ).toBe(false);
  });

  it('appearance view: shows a matching-attribute gene when that attribute is selected', () => {
    expect(
      isGeneVisible(
        '1',
        gene,
        { type: 'coat', attribute: 'Coat' },
        { ...empty, currentView: 'appearance', selectedAttributes: ['Coat'] },
        noEffects,
      ),
    ).toBe(true);
  });
});

describe('isGeneVisible — chromosome filter', () => {
  it('hides chromosomes outside an active selection', () => {
    expect(isGeneVisible('2', gene, analysis, { ...empty, selectedChromosomes: ['1'] }, noEffects)).toBe(false);
  });

  it('shows a chromosome that is in the selection', () => {
    expect(isGeneVisible('1', gene, analysis, { ...empty, selectedChromosomes: ['1'] }, noEffects)).toBe(true);
  });

  it('hides an explicitly hidden chromosome', () => {
    expect(isGeneVisible('1', gene, analysis, { ...empty, hiddenChromosomes: ['1'] }, noEffects)).toBe(false);
  });
});

describe('isGeneVisible — attribute filter (attribute view)', () => {
  it('hides a gene that does not affect any selected attribute', () => {
    const lookup = { ...noEffects, affectsSelectedAttributes: () => false };
    expect(isGeneVisible('1', gene, analysis, { ...empty, selectedAttributes: ['Speed'] }, lookup)).toBe(false);
  });

  it('shows a gene that potentially affects a selected attribute', () => {
    const lookup = { ...noEffects, affectsSelectedAttributes: () => true };
    expect(isGeneVisible('1', gene, analysis, { ...empty, selectedAttributes: ['Toughness'] }, lookup)).toBe(true);
  });
});

describe('isGeneVisible — hidden attributes', () => {
  it('hides a gene whose attribute is in the hidden list', () => {
    expect(isGeneVisible('1', gene, analysis, { ...empty, hiddenAttributes: ['Toughness'] }, noEffects)).toBe(false);
  });

  it('ignores hidden attributes for a null-attribute gene', () => {
    const a = { type: 'neutral', attribute: null };
    expect(isGeneVisible('1', gene, a, { ...empty, hiddenAttributes: ['Toughness'] }, noEffects)).toBe(true);
  });
});

describe('isGeneVisible — effect filter', () => {
  it('shows a gene whose type is in the effect filter', () => {
    expect(isGeneVisible('1', gene, analysis, { ...empty, currentEffectFilter: ['positive'] }, noEffects)).toBe(true);
  });

  it('hides a gene whose type is not in the effect filter', () => {
    expect(isGeneVisible('1', gene, analysis, { ...empty, currentEffectFilter: ['negative'] }, noEffects)).toBe(false);
  });

  it('promotes a neutral gene to its potential type before matching', () => {
    const a = { type: 'neutral', attribute: null };
    const lookup = { ...noEffects, hasAnyPotentialEffect: () => true, potentialEffectType: () => 'potential-positive' };
    // The neutral gene is promoted to potential-positive and so matches the filter.
    expect(isGeneVisible('1', gene, a, { ...empty, currentEffectFilter: ['potential-positive'] }, lookup)).toBe(true);
    // ...and is hidden by a filter that does not include the promoted type.
    expect(isGeneVisible('1', gene, a, { ...empty, currentEffectFilter: ['neutral'] }, lookup)).toBe(false);
  });

  it('hides a gene whose type is in the hidden-effects list', () => {
    expect(isGeneVisible('1', gene, analysis, { ...empty, hiddenEffectFilters: ['positive'] }, noEffects)).toBe(false);
  });
});

describe('isGeneVisible — value filter', () => {
  it('hides a dominant gene when only recessive is selected', () => {
    expect(isGeneVisible('1', gene, analysis, { ...empty, currentValueFilter: ['gene-recessive'] }, noEffects)).toBe(
      false,
    );
  });

  it('shows a dominant gene when dominant is selected', () => {
    expect(isGeneVisible('1', gene, analysis, { ...empty, currentValueFilter: ['gene-dominant'] }, noEffects)).toBe(
      true,
    );
  });

  it('hides a dominant gene when dominant is in the hidden-values list', () => {
    expect(isGeneVisible('1', gene, analysis, { ...empty, hiddenValueFilters: ['gene-dominant'] }, noEffects)).toBe(
      false,
    );
  });

  it('maps an unknown allele (?) to the unknown zygosity class', () => {
    const unknownGene = { id: '01A1', type: '?' };
    expect(
      isGeneVisible('1', unknownGene, analysis, { ...empty, currentValueFilter: ['gene-unknown'] }, noEffects),
    ).toBe(true);
  });
});

describe('isGeneVisible — no filters', () => {
  it('shows a gene when no filters are active', () => {
    expect(isGeneVisible('1', gene, analysis, empty, noEffects)).toBe(true);
  });
});
