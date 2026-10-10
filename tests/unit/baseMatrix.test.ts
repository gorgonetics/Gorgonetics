import { describe, expect, it } from 'vitest';
import type { AttributeStudy, BaselineOffset, BaselineReading } from '$lib/utils/attributeStudy.js';
import { baseText, buildBaseMatrix, gapText } from '$lib/utils/baseMatrix.js';

const reading = (over: Partial<BaselineReading> = {}): BaselineReading => ({
  breed: 'Kurbone',
  value: 10,
  unresolved: [],
  min: 10,
  max: 10,
  support: 243,
  dissent: 0,
  dissenters: [],
  witnesses: ['1'],
  ...over,
});

const offset = (over: Partial<BaselineOffset> = {}): BaselineOffset => ({
  breed: 'Paint',
  relativeTo: 'Kurbone',
  offset: 50,
  support: 3,
  dissent: 0,
  animals: 4,
  ...over,
});

const study = (attribute: string, readings: BaselineReading[], offsets: BaselineOffset[] = []) =>
  ({ attribute, baselines: { readings, offsets } }) as unknown as AttributeStudy;

describe('buildBaseMatrix', () => {
  it('puts every breed on every attribute in one fixed order', () => {
    const matrix = buildBaseMatrix([
      study('temperament', [reading({ breed: 'Statehelm', support: 300 }), reading({ breed: 'Kurbone', support: 5 })]),
      study('intelligence', [reading({ breed: 'Kurbone' })]),
    ]);
    expect(matrix.attributes).toEqual(['temperament', 'intelligence']);
    expect(matrix.rows.map((r) => r.breed)).toEqual(['Kurbone', 'Statehelm']);
    const statehelm = matrix.rows[1];
    expect(statehelm.cells[0].reading?.breed).toBe('Statehelm');
    expect(statehelm.cells[1]).toEqual({ reading: null, gap: null });
  });

  it('includes breeds known only through a gap, and gives the reference the inverse gap', () => {
    const matrix = buildBaseMatrix([study('temperament', [], [offset()])]);
    expect(matrix.rows.map((r) => r.breed)).toEqual(['Kurbone', 'Paint']);
    expect(matrix.rows[1].cells[0].gap?.offset).toBe(50);
    const reference = matrix.rows[0].cells[0].gap;
    expect(reference).toMatchObject({ breed: 'Kurbone', relativeTo: 'Paint', offset: -50, animals: 4 });
    expect(gapText(reference as BaselineOffset)).toBe('Paint − 50');
  });

  it("prefers a breed's own gap over an inverted one", () => {
    const matrix = buildBaseMatrix([
      study('temperament', [], [offset(), offset({ breed: 'Kurbone', relativeTo: 'Calico', offset: 3 })]),
    ]);
    const kurbone = matrix.rows.find((r) => r.breed === 'Kurbone');
    expect(kurbone?.cells[0].gap).toMatchObject({ relativeTo: 'Calico', offset: 3 });
  });

  it('puts animals of no breed last', () => {
    const matrix = buildBaseMatrix([study('temperament', [reading({ breed: '' }), reading({ breed: 'Paint' })])]);
    expect(matrix.rows.map((r) => r.breed)).toEqual(['Paint', '']);
  });

  it('is empty when nothing has settled', () => {
    expect(buildBaseMatrix([study('temperament', [])]).rows).toEqual([]);
  });
});

describe('base text', () => {
  it('reads exact, bounded and unknown bases', () => {
    expect(baseText(reading())).toBe('10');
    expect(baseText(reading({ value: -35, unresolved: ['05F2:recessive'], min: null, max: -36 }))).toBe('≤ −36');
    expect(baseText(reading({ unresolved: ['a', 'b'], min: null, max: null }))).toBe('?');
  });

  it('reads bounds on both sides as a range, and crossed bounds as a conflict', () => {
    expect(baseText(reading({ unresolved: ['a'], min: -3, max: 22 }))).toBe('−3 … 22');
    expect(baseText(reading({ unresolved: ['a'], min: 23, max: 22 }))).toBe('conflict');
  });

  it('reads a gap relative to its reference', () => {
    expect(gapText(offset())).toBe('Kurbone + 50');
    expect(gapText(offset({ offset: -5 }))).toBe('Kurbone − 5');
    expect(gapText(offset({ offset: 0 }))).toBe('= Kurbone');
  });
});
