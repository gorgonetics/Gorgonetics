import { describe, expect, it } from 'vitest';
import {
  activeSlots,
  buildEffectSlots,
  type StudySubject,
  slotKey,
  slotsByAttribute,
  studyAll,
  studyAttribute,
} from '$lib/utils/attributeStudy.js';
import type { GeneEffectData } from '$lib/utils/geneAnalysis.js';

/**
 * A miniature horse genome. `14B4`/`14B2` mirror the real reference data —
 * the worked example that motivated the feature is the first test below.
 */
const effectsDB: Record<string, GeneEffectData> = {
  '14B4': { effectDominant: 'Temperament+', effectRecessive: 'None', breed: 'Kurbone' },
  '14B2': { effectDominant: 'None', effectRecessive: 'Toughness-', breed: 'Kurbone' },
  '01A1': { effectDominant: 'None', effectRecessive: 'Temperament+', breed: '' },
  '01A2': { effectDominant: 'Temperament-', effectRecessive: 'None', breed: '' },
  '01A3': { effectDominant: 'Temperament+', effectRecessive: 'None', breed: '' },
  '02C1': { effectDominant: 'Temperament+', effectRecessive: 'None', breed: 'Paint' },
  '03D1': { effectDominant: 'Coat', effectRecessive: 'None', breed: '' },
};

const slots = buildEffectSlots(effectsDB);
const temperament = slotsByAttribute(slots).get('temperament') ?? [];

function horse(
  id: string,
  genes: Record<string, string>,
  attributes: Record<string, number>,
  breed = 'Kurbone',
): StudySubject {
  return { id, breed, genes, attributes };
}

/** Every locus recessive, so nothing is active unless overridden. */
function base(over: Record<string, string> = {}): Record<string, string> {
  return { '14B4': 'R', '14B2': 'D', '01A1': 'D', '01A2': 'R', '01A3': 'R', '02C1': 'R', ...over };
}

describe('buildEffectSlots', () => {
  it('derives one slot per expressed effect and ignores appearance-only genes', () => {
    expect(slots.map(slotKey).sort()).toEqual([
      '01A1:recessive',
      '01A2:dominant',
      '01A3:dominant',
      '02C1:dominant',
      '14B2:recessive',
      '14B4:dominant',
    ]);
  });

  it('carries the declared sign and breed scope', () => {
    const byKey = new Map(slots.map((s) => [slotKey(s), s]));
    expect(byKey.get('14B4:dominant')).toMatchObject({ sign: 1, breed: 'Kurbone' });
    expect(byKey.get('14B2:recessive')).toMatchObject({ sign: -1, breed: 'Kurbone' });
    expect(byKey.get('01A1:recessive')).toMatchObject({ sign: 1, breed: '' });
  });
});

describe('activeSlots', () => {
  it('treats a mixed locus exactly as a dominant one', () => {
    const dominant = horse('d', base({ '14B4': 'D' }), { temperament: 50 });
    const mixed = horse('x', base({ '14B4': 'x' }), { temperament: 50 });
    expect(activeSlots(mixed, temperament)).toEqual(activeSlots(dominant, temperament));
  });

  it('excludes another breed’s genes', () => {
    const kurbone = horse('k', base({ '02C1': 'D' }), { temperament: 50 });
    expect(activeSlots(kurbone, temperament)?.has('02C1:dominant')).toBe(false);

    const paint = horse('p', base({ '02C1': 'D' }), { temperament: 50 }, 'Paint');
    expect(activeSlots(paint, temperament)?.has('02C1:dominant')).toBe(true);
  });

  it('withdraws the subject when a relevant locus is unrevealed', () => {
    const unknown = horse('u', base({ '14B4': '?' }), { temperament: 50 });
    expect(activeSlots(unknown, temperament)).toBeNull();
  });

  it('tolerates a ? on a locus that does not touch this attribute', () => {
    const unknown = horse('u', base({ '14B2': '?' }), { temperament: 50 });
    expect(activeSlots(unknown, temperament)).not.toBeNull();
  });
});

describe('studyAttribute', () => {
  it('pins a magnitude from a pair differing at exactly one slot', () => {
    // The motivating example: two horses alike on every temperament locus
    // but 14B4, five points apart.
    const study = studyAttribute(
      [horse('with', base({ '14B4': 'D' }), { temperament: 23 }), horse('without', base(), { temperament: 18 })],
      'temperament',
      temperament,
    );
    expect(study.findings).toHaveLength(1);
    expect(study.findings[0]).toMatchObject({
      gene: '14B4',
      expression: 'dominant',
      magnitude: 5,
      tier: 'direct',
      depth: 0,
      support: 1,
      dissent: 0,
    });
    expect(study.findings[0].witnesses).toEqual([['with', 'without']]);
  });

  it('reads the same pair for a second attribute from a different projection', () => {
    // The pair differs at 14B4 *and* 14B2, so neither attribute alone sees
    // more than a single difference.
    const subjects = [
      horse('a', base({ '14B4': 'D', '14B2': 'R' }), { temperament: 23, toughness: 76 }),
      horse('b', base(), { temperament: 18, toughness: 77 }),
    ];
    const studies = studyAll(subjects, slots);
    const byAttribute = new Map(studies.map((s) => [s.attribute, s]));
    expect(byAttribute.get('temperament')?.findings[0]).toMatchObject({ gene: '14B4', magnitude: 5 });
    expect(byAttribute.get('toughness')?.findings[0]).toMatchObject({ gene: '14B2', magnitude: -1 });
  });

  it('derives a further magnitude by substitution and marks its depth', () => {
    // 01A3 never differs alone: every pair containing it also differs at
    // 14B4 or 01A2, so it can only be reached once those two are known.
    const study = studyAttribute(
      [
        horse('a', base(), { temperament: 40 }),
        horse('b', base({ '14B4': 'D' }), { temperament: 45 }), // pins 14B4 = +5
        horse('d', base({ '01A2': 'D' }), { temperament: 37 }), // pins 01A2 = -3
        horse('c', base({ '14B4': 'D', '01A2': 'D', '01A3': 'D' }), { temperament: 49 }),
      ],
      'temperament',
      temperament,
    );
    const byGene = new Map(study.findings.map((f) => [f.gene, f]));
    expect(byGene.get('14B4')).toMatchObject({ magnitude: 5, tier: 'direct', depth: 0 });
    expect(byGene.get('01A2')).toMatchObject({ magnitude: -3, tier: 'direct', depth: 0 });
    expect(byGene.get('01A3')).toMatchObject({ magnitude: 7, tier: 'derived', depth: 1 });
  });

  it('never pairs across breeds, since the unknown base only cancels within one', () => {
    // Identical genomes, 30 points apart: only a differing base explains it.
    // Pairing them would invent a magnitude for 01A3.
    const study = studyAttribute(
      [
        horse('kurbone', base({ '01A3': 'D' }), { temperament: 60 }),
        horse('paint', base(), { temperament: 30 }, 'Paint'),
      ],
      'temperament',
      temperament,
    );
    expect(study.findings).toEqual([]);
  });

  it('takes the majority value and names the dissenting animals', () => {
    // Same active set means the same value, so the four sound animals sit
    // at 40 or 45 and pair four ways. Only `bad` breaks the arithmetic.
    const subjects = [
      horse('ok1', base(), { temperament: 40 }),
      horse('ok2', base(), { temperament: 40 }),
      horse('ok3', base({ '14B4': 'D' }), { temperament: 45 }),
      horse('ok4', base({ '14B4': 'D' }), { temperament: 45 }),
      horse('bad', base({ '14B4': 'D' }), { temperament: 99 }), // mis-recorded
    ];
    const study = studyAttribute(subjects, 'temperament', temperament);
    const finding = study.findings.find((f) => f.gene === '14B4');
    expect(finding).toMatchObject({ magnitude: 5, support: 4 });
    expect(finding?.dissent).toBeGreaterThan(0);
    expect(study.contradictions[0].subjectId).toBe('bad');
  });

  it('drops a slot whose majority contradicts the declared direction', () => {
    // 01A2 is declared Temperament-, but these readings imply +6.
    const study = studyAttribute(
      [horse('a', base(), { temperament: 40 }), horse('b', base({ '01A2': 'D' }), { temperament: 46 })],
      'temperament',
      temperament,
    );
    expect(study.findings.find((f) => f.gene === '01A2')).toBeUndefined();
  });

  it('ignores clamped readings, which report a bound rather than a sum', () => {
    for (const clamped of [0, 100]) {
      const study = studyAttribute(
        [horse('a', base(), { temperament: clamped }), horse('b', base({ '14B4': 'D' }), { temperament: 50 })],
        'temperament',
        temperament,
      );
      expect(study.findings).toEqual([]);
    }
  });

  it('scores validation only on pairs no finding was read off', () => {
    const study = studyAttribute(
      [
        horse('a', base(), { temperament: 40 }),
        horse('b', base({ '14B4': 'D' }), { temperament: 45 }),
        horse('c', base({ '01A3': 'D' }), { temperament: 47 }),
        // differs from 'a' at both solved slots: 5 + 7 = 12
        horse('d', base({ '14B4': 'D', '01A3': 'D' }), { temperament: 52 }),
      ],
      'temperament',
      temperament,
    );
    expect(study.validation.tested).toBeGreaterThan(0);
    expect(study.validation.exact).toBe(study.validation.tested);
  });

  it('reports a validation miss when a finding does not generalise', () => {
    const study = studyAttribute(
      [
        horse('a', base(), { temperament: 40 }),
        horse('b', base({ '14B4': 'D' }), { temperament: 45 }),
        horse('c', base({ '01A3': 'D' }), { temperament: 47 }),
        horse('d', base({ '14B4': 'D', '01A3': 'D' }), { temperament: 70 }), // not 52
      ],
      'temperament',
      temperament,
    );
    expect(study.validation.exact).toBeLessThan(study.validation.tested);
  });

  it('respects maxDistance', () => {
    const subjects = [
      horse('a', base(), { temperament: 40 }),
      horse('b', base({ '14B4': 'D', '01A3': 'D' }), { temperament: 52 }),
    ];
    expect(studyAttribute(subjects, 'temperament', temperament, { maxDistance: 1 }).validation.tested).toBe(0);
    expect(studyAttribute(subjects, 'temperament', temperament, { maxDistance: 2 }).findings).toEqual([]);
  });

  it('counts only the subjects that contributed an equation', () => {
    const study = studyAttribute(
      [
        horse('measured', base(), { temperament: 40 }),
        horse('clamped', base(), { temperament: 100 }),
        horse('unrevealed', base({ '14B4': '?' }), { temperament: 40 }),
      ],
      'temperament',
      temperament,
    );
    expect(study.contributors).toBe(1);
  });
});

describe('studyAll', () => {
  it('returns one study per attribute in the slot set', () => {
    expect(studyAll([], slots).map((s) => s.attribute)).toEqual(['temperament', 'toughness']);
  });

  it('is empty but well-formed on an empty corpus', () => {
    const [study] = studyAll([], slots);
    expect(study).toMatchObject({ findings: [], contradictions: [], contributors: 0 });
    expect(study.validation).toEqual({ tested: 0, exact: 0 });
  });
});
