import { describe, expect, it } from 'vitest';
import {
  buildAttributeMagnitudes,
  coverageOf,
  EMPTY_MAGNITUDES,
  hasMagnitudes,
  magnitudeOf,
} from '$lib/utils/attributePoints.js';
import type { AttributeStudy, StudyFinding } from '$lib/utils/attributeStudy.js';

function finding(overrides: Partial<StudyFinding> & Pick<StudyFinding, 'gene' | 'magnitude'>): StudyFinding {
  return {
    expression: 'dominant',
    attribute: 'toughness',
    tier: 'direct',
    depth: 0,
    support: 3,
    dissent: 0,
    witnesses: [],
    ...overrides,
  };
}

function study(attribute: string, slots: number, findings: StudyFinding[]): AttributeStudy {
  return {
    attribute,
    slots,
    findings,
    contradictions: [],
    geneDoubts: [],
    validation: { tested: 0, exact: 0, stabledTested: 0, stabledExact: 0, suspects: [] },
    contributors: findings.length,
    baselines: { readings: [], offsets: [] },
  };
}

describe('attribute magnitudes', () => {
  it('keys findings by gene and expression, and reports coverage per attribute', () => {
    const magnitudes = buildAttributeMagnitudes([
      study('toughness', 9, [
        finding({ gene: '01A1', magnitude: 4 }),
        finding({ gene: '01A1', expression: 'recessive', magnitude: -2 }),
      ]),
      study('intelligence', 5, [finding({ gene: '02B1', attribute: 'intelligence', magnitude: 1 })]),
    ]);

    expect(magnitudeOf(magnitudes, '01A1', 'dominant')).toBe(4);
    expect(magnitudeOf(magnitudes, '01A1', 'recessive')).toBe(-2);
    expect(magnitudeOf(magnitudes, '02B1', 'dominant')).toBe(1);
    // The two expressions of one gene are separate unknowns, so a gene
    // solved on one side must not answer for the other.
    expect(magnitudeOf(magnitudes, '02B1', 'recessive')).toBeUndefined();
    expect(magnitudeOf(magnitudes, 'nosuch', 'dominant')).toBeUndefined();
  });

  it('capitalises attributes to the key the scorers and UI use', () => {
    const magnitudes = buildAttributeMagnitudes([study('toughness', 9, [finding({ gene: '01A1', magnitude: 4 })])]);
    expect(coverageOf(magnitudes, 'Toughness')).toEqual({ known: 1, total: 9 });
    expect(coverageOf(magnitudes, 'toughness')).toEqual({ known: 0, total: 0 });
  });

  it('reports an attribute the study measured nothing on as zero coverage', () => {
    // The study ran and found nothing here: 0 of 9, which is what makes the
    // scorers keep counting for this attribute rather than score it in points.
    const magnitudes = buildAttributeMagnitudes([
      study('toughness', 9, []),
      study('intelligence', 5, [finding({ gene: '02B1', attribute: 'intelligence', magnitude: 1 })]),
    ]);
    expect(coverageOf(magnitudes, 'Toughness')).toEqual({ known: 0, total: 9 });
    expect(coverageOf(magnitudes, 'Intelligence')).toEqual({ known: 1, total: 5 });
  });

  it('takes derived findings as readily as direct ones', () => {
    // Excluding them would halve coverage; the study validates both tiers
    // together and keeps `depth` for the panel that explains a number.
    const magnitudes = buildAttributeMagnitudes([
      study('toughness', 2, [finding({ gene: '01A1', magnitude: 4, tier: 'derived', depth: 3 })]),
    ]);
    expect(magnitudeOf(magnitudes, '01A1', 'dominant')).toBe(4);
  });

  it('is empty for an empty run, and says so', () => {
    expect(hasMagnitudes(EMPTY_MAGNITUDES)).toBe(false);
    expect(hasMagnitudes(buildAttributeMagnitudes([]))).toBe(false);
    expect(hasMagnitudes(buildAttributeMagnitudes([study('toughness', 9, [])]))).toBe(false);
    expect(
      hasMagnitudes(buildAttributeMagnitudes([study('toughness', 9, [finding({ gene: 'g', magnitude: 1 })])])),
    ).toBe(true);
    expect(coverageOf(EMPTY_MAGNITUDES, 'Toughness')).toEqual({ known: 0, total: 0 });
  });
});
