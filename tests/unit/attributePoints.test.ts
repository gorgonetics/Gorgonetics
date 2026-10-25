import { describe, expect, it } from 'vitest';
import {
  buildAttributeMagnitudes,
  coverageOf,
  EMPTY_MAGNITUDES,
  hasMagnitudes,
  magnitudeOf,
  swingSplits,
} from '#lib/utils/attributePoints.js';
import type { AttributeStudy, StudyFinding } from '#lib/utils/attributeStudy.js';

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

describe('swing splits', () => {
  /** Chromosome 01 as the live corpus reads it: every known positive is +5. */
  const peers = ['01A1', '01A2', '01A3'].map((gene) =>
    finding({ gene, expression: 'recessive', attribute: 'temperament', magnitude: 5 }),
  );
  const swing = (magnitude: number, gene = '01A4') =>
    finding({ gene, expression: 'recessive', attribute: 'enthusiasm', magnitude, swing: true });

  it('gives the positive side the chromosome’s shared value and the negative side the rest', () => {
    const studies = [study('temperament', 3, peers), study('enthusiasm', 1, [swing(8)])];
    expect(swingSplits(studies).get('01A4')).toEqual({
      gene: '01A4',
      swing: 8,
      recessive: 5,
      dominant: -3,
      peers: 3,
    });
  });

  it('keeps the assumed split out of the scoring table', () => {
    // The table holds only what the corpus entails: the whole gap on the
    // positive side, nothing on the negative one, split or no split.
    const magnitudes = buildAttributeMagnitudes([study('temperament', 3, peers), study('enthusiasm', 1, [swing(8)])]);
    expect(magnitudeOf(magnitudes, '01A4', 'recessive')).toBe(8);
    expect(magnitudeOf(magnitudes, '01A4', 'dominant')).toBe(0);
    expect(coverageOf(magnitudes, 'Enthusiasm')).toEqual({ known: 1, total: 1 });
  });

  it('puts a dominant-positive swing on the dominant slot', () => {
    const magnitudes = buildAttributeMagnitudes([study('enthusiasm', 1, [swing(-4)])]);
    expect(magnitudeOf(magnitudes, '01A4', 'dominant')).toBe(4);
    expect(magnitudeOf(magnitudes, '01A4', 'recessive')).toBe(0);
  });

  it('does not split when the chromosome’s positives disagree', () => {
    const mixed = [...peers, finding({ gene: '01B1', attribute: 'toughness', magnitude: 4 })];
    const studies = [study('temperament', 4, mixed), study('enthusiasm', 1, [swing(8)])];
    expect(swingSplits(studies).size).toBe(0);
  });

  it('does not split on too few positives', () => {
    expect(swingSplits([study('temperament', 2, peers.slice(0, 2)), study('enthusiasm', 1, [swing(8)])]).size).toBe(0);
  });

  it('does not split when the negative side would be zero or positive', () => {
    expect(swingSplits([study('temperament', 3, peers), study('enthusiasm', 1, [swing(5)])]).size).toBe(0);
  });

  it('reads positives from the swing’s own chromosome only', () => {
    const elsewhere = peers.map((p) => ({ ...p, gene: p.gene.replace('01', '02') }));
    expect(swingSplits([study('temperament', 3, elsewhere), study('enthusiasm', 1, [swing(8)])]).size).toBe(0);
  });

  it('splits a dominant-positive swing with the shared value on the dominant side', () => {
    expect(
      swingSplits([study('temperament', 3, peers), study('enthusiasm', 1, [swing(-7)])]).get('01A4'),
    ).toMatchObject({ recessive: -2, dominant: 5 });
  });
});
