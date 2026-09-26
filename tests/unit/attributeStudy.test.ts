import { describe, expect, it } from 'vitest';
import {
  activeSlots,
  buildEffectSlots,
  type EffectSlot,
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
  stabled = false,
): StudySubject {
  return { id, breed, genes, attributes, stabled };
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

  it('leaves a slot unresolved when no value leads', () => {
    // Two equations each imply +5 and two imply +9. There is no majority,
    // and picking either would publish a coin-flip that later substitutions
    // and the validation score would then treat as known.
    const study = studyAttribute(
      [
        horse('a', base(), { temperament: 40 }),
        horse('b', base(), { temperament: 40 }),
        horse('c', base({ '14B4': 'D' }), { temperament: 45 }),
        horse('d', base({ '14B4': 'x' }), { temperament: 49 }),
      ],
      'temperament',
      temperament,
    );
    expect(study.findings.find((f) => f.gene === '14B4')).toBeUndefined();
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

  it('excludes from validation the equations a derived finding was read off', () => {
    // 01A3 is derived from the a-c equation, so that equation reproduces
    // its own delta by construction. Scoring it would be circular.
    const study = studyAttribute(
      [
        horse('a', base(), { temperament: 40 }),
        horse('b', base({ '14B4': 'D' }), { temperament: 45 }),
        horse('d', base({ '01A2': 'D' }), { temperament: 37 }),
        horse('c', base({ '14B4': 'D', '01A2': 'D', '01A3': 'D' }), { temperament: 49 }),
      ],
      'temperament',
      temperament,
    );
    // Four multi-term equations exist; three of them could have produced
    // 01A3 and are withheld. Only b-d — whose two slots are both direct —
    // is genuinely independent, and it is the only one scored.
    expect(study.findings.find((f) => f.gene === '01A3')?.tier).toBe('derived');
    expect(study.validation.tested).toBe(1);
    expect(study.validation.exact).toBe(1);
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
    // Doubled up so both magnitudes win outright rather than tie; `d` then
    // disagrees with the pair of them (70, not 52) and is scored as a miss.
    const study = studyAttribute(
      [
        horse('a', base(), { temperament: 40 }),
        horse('a2', base(), { temperament: 40 }),
        horse('b', base({ '14B4': 'D' }), { temperament: 45 }),
        horse('b2', base({ '14B4': 'D' }), { temperament: 45 }),
        horse('c', base({ '01A3': 'D' }), { temperament: 47 }),
        horse('c2', base({ '01A3': 'D' }), { temperament: 47 }),
        horse('d', base({ '14B4': 'D', '01A3': 'D' }), { temperament: 70 }), // not 52
      ],
      'temperament',
      temperament,
    );
    expect(study.validation.tested).toBeGreaterThan(0);
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
        horse('paired', base({ '14B4': 'D' }), { temperament: 45 }),
        horse('clamped', base(), { temperament: 100 }),
        horse('unrevealed', base({ '14B4': '?' }), { temperament: 40 }),
      ],
      'temperament',
      temperament,
    );
    expect(study.contributors).toBe(2);
  });

  it('counts nobody when the eligible animals cannot be paired', () => {
    // Eligible is not the same as contributing: identical active sets yield
    // no equation.
    const study = studyAttribute(
      [horse('same1', base(), { temperament: 40 }), horse('same2', base(), { temperament: 40 })],
      'temperament',
      temperament,
    );
    expect(study.contributors).toBe(0);
  });

  it('lets a breed of one animal contribute its base gap', () => {
    // 14B4 is Kurbone's, so the Paint expresses nothing: the pair differs
    // only by the two bases, and that is the gap.
    const study = studyAttribute(
      [
        horse('same1', base(), { temperament: 40 }),
        horse('same2', base(), { temperament: 40 }),
        horse('lone', base({ '14B4': 'D' }), { temperament: 45 }, 'Paint'),
      ],
      'temperament',
      temperament,
    );
    expect(study.contributors).toBe(3);
    expect(study.findings).toEqual([]);
    expect(study.baselines.offsets).toEqual([
      expect.objectContaining({ breed: 'Paint', relativeTo: 'Kurbone', offset: 5 }),
    ]);
  });
});

describe('studyAll', () => {
  it('returns one study per attribute in the slot set', () => {
    expect(studyAll([], slots).map((s) => s.attribute)).toEqual(['temperament', 'toughness']);
  });

  it('is empty but well-formed on an empty corpus', () => {
    const [study] = studyAll([], slots);
    expect(study).toMatchObject({ findings: [], contradictions: [], contributors: 0 });
    expect(study.validation).toEqual({ tested: 0, exact: 0, stabledTested: 0, stabledExact: 0, suspects: [] });
  });
});

describe('stabled animals', () => {
  it('marks a contradicting animal the player can re-read', () => {
    const study = studyAttribute(
      [
        horse('ok1', base(), { temperament: 40 }),
        horse('ok2', base(), { temperament: 40 }),
        horse('ok3', base({ '14B4': 'D' }), { temperament: 45 }),
        horse('ok4', base({ '14B4': 'D' }), { temperament: 45 }),
        horse('bad', base({ '14B4': 'D' }), { temperament: 99 }, 'Kurbone', true),
      ],
      'temperament',
      temperament,
    );
    expect(study.contradictions.find((c) => c.subjectId === 'bad')?.stabled).toBe(true);
    expect(study.contradictions.find((c) => c.subjectId === 'ok1')?.stabled).toBe(false);
  });

  it('puts a checkable disagreement above a larger unfalsifiable one', () => {
    // `loud` dissents more often, but nothing can settle it; `quiet` can be
    // looked up in the game, so it is the one worth showing first.
    const study = studyAttribute(
      [
        horse('a', base(), { temperament: 40 }),
        horse('b', base(), { temperament: 40 }),
        horse('c', base(), { temperament: 40 }),
        horse('d', base({ '14B4': 'D' }), { temperament: 45 }),
        horse('e', base({ '14B4': 'D' }), { temperament: 45 }),
        horse('loud', base({ '14B4': 'D' }), { temperament: 90 }),
        horse('quiet', base({ '01A3': 'D' }), { temperament: 80 }, 'Kurbone', true),
      ],
      'temperament',
      temperament,
    );
    const stabledFirst = study.contradictions.findIndex((c) => c.stabled);
    const unstabled = study.contradictions.findIndex((c) => !c.stabled);
    expect(stabledFirst).toBeLessThan(unstabled);
  });

  it('scores stabled pairs separately, and counts only pairs stabled on both sides', () => {
    const study = studyAttribute(
      [
        horse('a', base(), { temperament: 40 }, 'Kurbone', true),
        horse('b', base({ '14B4': 'D' }), { temperament: 45 }, 'Kurbone', true),
        horse('c', base({ '01A3': 'D' }), { temperament: 47 }, 'Kurbone', true),
        // Unstabled: its pairs count toward the headline score only.
        horse('d', base({ '14B4': 'D', '01A3': 'D' }), { temperament: 52 }),
      ],
      'temperament',
      temperament,
    );
    expect(study.validation.stabledTested).toBeGreaterThan(0);
    expect(study.validation.stabledTested).toBeLessThan(study.validation.tested);
    expect(study.validation.stabledExact).toBe(study.validation.stabledTested);
  });

  it('reports no stabled score when nothing is stabled', () => {
    const study = studyAttribute(
      [
        horse('a', base(), { temperament: 40 }),
        horse('b', base({ '14B4': 'D' }), { temperament: 45 }),
        horse('c', base({ '01A3': 'D' }), { temperament: 47 }),
        horse('d', base({ '14B4': 'D', '01A3': 'D' }), { temperament: 52 }),
      ],
      'temperament',
      temperament,
    );
    expect(study.validation.tested).toBeGreaterThan(0);
    expect(study.validation.stabledTested).toBe(0);
  });
});

describe('doubting the gene data', () => {
  it('will not raise a doubt that one mis-recorded animal could explain', () => {
    // Three sound animals against one misread carrier give three agreeing
    // equations with no dissent at all — pair count alone cannot tell that
    // apart from a genuinely wrong gene entry. Every pair shares `bad`.
    const study = studyAttribute(
      [
        horse('ok1', base(), { temperament: 40 }),
        horse('ok2', base(), { temperament: 40 }),
        horse('ok3', base(), { temperament: 40 }),
        horse('bad', base({ '01A3': 'D' }), { temperament: 28 }),
      ],
      'temperament',
      temperament,
    );
    expect(study.geneDoubts).toEqual([]);
  });

  it('reopens a slot that an early weak contradiction could not settle', () => {
    // One bad pair implies 01A3 is negative, which its declaration forbids.
    // That must not bury the slot: three clean carriers later agree it is
    // +7, and substitution should still get there.
    const study = studyAttribute(
      [
        horse('a', base(), { temperament: 40 }),
        horse('b', base({ '14B4': 'D' }), { temperament: 45 }),
        horse('d', base({ '01A2': 'D' }), { temperament: 37 }),
        horse('bad', base({ '01A3': 'D' }), { temperament: 34 }),
        horse('c1', base({ '14B4': 'D', '01A2': 'D', '01A3': 'D' }), { temperament: 49 }),
        horse('c2', base({ '14B4': 'D', '01A2': 'D', '01A3': 'D' }), { temperament: 49 }),
        horse('c3', base({ '14B4': 'D', '01A2': 'D', '01A3': 'D' }), { temperament: 49 }),
      ],
      'temperament',
      temperament,
    );
    expect(study.findings.find((f) => f.gene === '01A3')).toMatchObject({ magnitude: 7 });
  });

  it('stays quiet when only one pair disputes the declaration', () => {
    // One pair is one equation, and cannot separate a wrong gene entry from
    // one mis-typed attribute. No finding either way — the slot is still not
    // knowledge — but nothing is reported.
    const study = studyAttribute(
      [horse('a', base(), { temperament: 40 }), horse('b', base({ '01A2': 'D' }), { temperament: 46 })],
      'temperament',
      temperament,
    );
    expect(study.geneDoubts).toEqual([]);
    expect(study.findings.find((f) => f.gene === '01A2')).toBeUndefined();
  });

  it('reports a declared direction the animals contradict', () => {
    // 01A2 is declared Temperament-, but carrying it consistently adds 6.
    // That is a transcription slip in the gene table, not a finding.
    const study = studyAttribute(
      [
        horse('a', base(), { temperament: 40 }),
        horse('b', base(), { temperament: 40 }),
        horse('c', base({ '01A2': 'D' }), { temperament: 46 }),
        horse('d', base({ '01A2': 'D' }), { temperament: 46 }),
      ],
      'temperament',
      temperament,
    );
    expect(study.findings.find((f) => f.gene === '01A2')).toBeUndefined();
    const doubt = study.geneDoubts.find((g) => g.gene === '01A2');
    expect(doubt).toMatchObject({ reason: 'contradicts-sign', declared: -1, observed: 6 });
    expect(doubt?.animals).toBe(4);
  });

  it('reports a declared effect that does not show up at all', () => {
    // Carrying 01A3 makes no difference, yet an effect is declared for it.
    // Four animals so the four resulting pairs clear the support floor.
    const study = studyAttribute(
      [
        horse('a', base(), { temperament: 40 }),
        horse('b', base(), { temperament: 40 }),
        horse('c', base({ '01A3': 'D' }), { temperament: 40 }),
        horse('d', base({ '01A3': 'D' }), { temperament: 40 }),
      ],
      'temperament',
      temperament,
    );
    expect(study.geneDoubts.find((g) => g.gene === '01A3')).toMatchObject({
      reason: 'no-effect',
      observed: 0,
    });
  });

  it('blames the declaration when dissent is spread across many animals', () => {
    // Three carriers that disagree about how much 14B4 is worth (5, 6, 7),
    // with no single animal behind the disagreement. The sign still holds,
    // so this is not a transcription slip — the declaration itself is shaky.
    const study = studyAttribute(
      [
        horse('a', base(), { temperament: 40 }),
        horse('b', base(), { temperament: 40 }),
        horse('c', base({ '14B4': 'D' }), { temperament: 45 }),
        horse('d', base({ '14B4': 'D' }), { temperament: 46 }),
        horse('e', base({ '14B4': 'D' }), { temperament: 47 }),
      ],
      'temperament',
      temperament,
    );
    expect(study.geneDoubts.find((g) => g.gene === '14B4')?.reason).toBe('unstable');
  });

  it('blames the animal, not the gene, when one animal causes the dissent', () => {
    const study = studyAttribute(
      [
        horse('ok1', base(), { temperament: 40 }),
        horse('ok2', base(), { temperament: 40 }),
        horse('ok3', base({ '14B4': 'D' }), { temperament: 45 }),
        horse('ok4', base({ '14B4': 'D' }), { temperament: 45 }),
        horse('bad', base({ '14B4': 'D' }), { temperament: 99 }),
      ],
      'temperament',
      temperament,
    );
    expect(study.geneDoubts.find((g) => g.gene === '14B4')).toBeUndefined();
    expect(study.contradictions[0].subjectId).toBe('bad');
  });

  it('marks a doubt settleable when a witness pair is stabled on both sides', () => {
    const study = studyAttribute(
      [
        horse('a', base(), { temperament: 40 }, 'Kurbone', true),
        horse('b', base(), { temperament: 40 }, 'Kurbone', true),
        horse('c', base({ '01A2': 'D' }), { temperament: 46 }, 'Kurbone', true),
        horse('d', base({ '01A2': 'D' }), { temperament: 46 }, 'Kurbone', true),
      ],
      'temperament',
      temperament,
    );
    expect(study.geneDoubts.find((g) => g.gene === '01A2')?.checkable).toBe(true);
  });

  it('is quiet when the gene data agrees with the animals', () => {
    const study = studyAttribute(
      [horse('a', base(), { temperament: 40 }), horse('b', base({ '14B4': 'D' }), { temperament: 45 })],
      'temperament',
      temperament,
    );
    expect(study.geneDoubts).toEqual([]);
  });

  it('files a doubt once, not once per substitution round', () => {
    // A doubted slot never reaches `solved`, so nothing else stops a later
    // round from re-deriving it.
    const study = studyAttribute(
      [
        horse('a', base(), { temperament: 40 }),
        horse('a2', base(), { temperament: 40 }),
        horse('b', base({ '01A2': 'D' }), { temperament: 46 }),
        horse('b2', base({ '01A2': 'D' }), { temperament: 46 }),
        horse('c', base({ '14B4': 'D' }), { temperament: 45 }),
        horse('d', base({ '01A2': 'D', '14B4': 'D' }), { temperament: 51 }),
      ],
      'temperament',
      temperament,
    );
    const forGene = study.geneDoubts.filter((g) => g.gene === '01A2');
    expect(forGene).toHaveLength(1);
  });
});

describe('validation suspects', () => {
  /**
   * `01A1:recessive` is +5 and `01A3:dominant` is +3. Each is witnessed by
   * four clean pairs, so the two pairs `bad` contributes are outvoted and
   * both magnitudes are published — without that the tallies simply tie and
   * nothing is solved, so nothing can be predicted or caught.
   *
   * `bad` expresses both slots, so predicting it is a two-term equation, and
   * its reading is 6 points out.
   */
  const withBadRow = [
    horse('plain', base(), { temperament: 50 }),
    horse('plain2', base(), { temperament: 50 }),
    horse('one', base({ '01A1': 'R' }), { temperament: 55 }),
    horse('one2', base({ '01A1': 'R' }), { temperament: 55 }),
    horse('other', base({ '01A3': 'D' }), { temperament: 53 }),
    horse('other2', base({ '01A3': 'D' }), { temperament: 53 }),
    horse('bad', base({ '01A1': 'R', '01A3': 'D' }), { temperament: 64 }),
  ];

  it('names the animals a failed prediction implicates', () => {
    const study = studyAttribute(withBadRow, 'temperament', temperament);
    expect(study.validation.tested).toBeGreaterThan(0);
    expect(study.validation.exact).toBeLessThan(study.validation.tested);

    const named = study.validation.suspects.map((s) => s.subjectId);
    // A failed prediction accuses the pair, and the app cannot tell which of
    // the two is wrong — so both are named and ranked by how often they recur.
    expect(named).toContain('bad');
  });

  it('reports the constant offset that marks a mis-typed reading', () => {
    const study = studyAttribute(withBadRow, 'temperament', temperament);
    const bad = study.validation.suspects.find((s) => s.subjectId === 'bad');
    // One wrong attribute shifts every prediction about that animal by the
    // same amount, which is what tells a bad record from bad luck.
    expect(bad?.offset).toBe(6);
    expect(bad?.offsetShare).toBe(1);
  });

  it('carries every error size, so a pooled share is a share of the pooled total', () => {
    const study = studyAttribute(withBadRow, 'temperament', temperament);
    const bad = study.validation.suspects.find((s) => s.subjectId === 'bad');
    // `offsets` is what lets the service recompute the share across
    // attributes. Reporting one attribute's share beside a total summed over
    // all of them would claim agreement the evidence does not have.
    expect(bad?.offsets.length).toBeGreaterThan(0);
    expect(bad?.offsets.reduce((n, [, count]) => n + count, 0)).toBe(bad?.failures);
  });

  it('implicates nobody when every prediction lands', () => {
    // 50 + 5 + 3 — what the corpus says this animal must read.
    const clean = [...withBadRow.slice(0, 6), horse('good', base({ '01A1': 'R', '01A3': 'D' }), { temperament: 58 })];
    const study = studyAttribute(clean, 'temperament', temperament);
    expect(study.validation.exact).toBe(study.validation.tested);
    expect(study.validation.suspects).toEqual([]);
  });
});

describe('determined subsystems', () => {
  /**
   * Three slots, four animals, every pair differing at exactly two slots.
   *
   * No equation ever has a single unknown, so substitution cannot start —
   * but the three equations determine all three magnitudes:
   *
   *   A + B = 8   B + C = 12   A + C = 10   =>   A = 3, B = 5, C = 7
   *
   * A, B and C are `01A3:dominant`, `01A1:recessive` and `14B4:dominant`.
   */
  const pinned = [
    horse('V', base(), { temperament: 50 }),
    horse('U', base({ '01A3': 'D', '01A1': 'R' }), { temperament: 58 }),
    horse('T', base({ '01A1': 'R', '14B4': 'D' }), { temperament: 62 }),
    horse('S', base({ '01A3': 'D', '14B4': 'D' }), { temperament: 60 }),
  ];

  it('solves what substitution cannot reach', () => {
    const study = studyAttribute(pinned, 'temperament', temperament);
    const byKey = new Map(study.findings.map((f) => [slotKey(f), f]));

    expect(byKey.get('01A3:dominant')?.magnitude).toBe(3);
    expect(byKey.get('01A1:recessive')?.magnitude).toBe(5);
    expect(byKey.get('14B4:dominant')?.magnitude).toBe(7);
    // Every pair differs at two slots, so the old solver reaches none of them.
    expect(study.findings.every((f) => f.tier === 'system')).toBe(true);
  });

  it('carries the evidence that pinned each slot', () => {
    const study = studyAttribute(pinned, 'temperament', temperament);
    const found = study.findings.find((f) => slotKey(f) === '01A3:dominant');
    expect(found?.support).toBeGreaterThan(1);
    expect(found?.witnesses.length).toBeGreaterThan(0);
    // An inconsistent subsystem publishes nothing at all, so a published one
    // has nothing dissenting from it.
    expect(found?.dissent).toBe(0);
  });

  it('refuses a fractional solution and says an animal is mis-recorded', () => {
    // S moved by one. The system still determines all three slots, but now to
    // halves — impossible when every effect is an integer.
    const broken = [...pinned.slice(0, 3), horse('S', base({ '01A3': 'D', '14B4': 'D' }), { temperament: 61 })];
    const study = studyAttribute(broken, 'temperament', temperament);

    expect(study.findings).toEqual([]);
    expect(study.geneDoubts.some((d) => d.reason === 'non-integer')).toBe(true);
  });

  it('refuses a solution that contradicts the declared direction', () => {
    // Same shape, values chosen so `01A3:dominant` solves to -3 against a
    // declared `+`. The declaration is never an input to the arithmetic,
    // which is exactly what lets it reject the answer.
    const wrongWay = [
      horse('V', base(), { temperament: 50 }),
      horse('U', base({ '01A3': 'D', '01A1': 'R' }), { temperament: 52 }),
      horse('T', base({ '01A1': 'R', '14B4': 'D' }), { temperament: 62 }),
      horse('S', base({ '01A3': 'D', '14B4': 'D' }), { temperament: 54 }),
    ];
    const study = studyAttribute(wrongWay, 'temperament', temperament);
    const byKey = new Map(study.findings.map((f) => [slotKey(f), f]));

    expect(byKey.has('01A3:dominant')).toBe(false);
    expect(study.geneDoubts.some((d) => d.gene === '01A3' && d.reason === 'contradicts-sign')).toBe(true);
    // The slots the same system pins correctly are still published.
    expect(byKey.get('01A1:recessive')?.magnitude).toBe(5);
    expect(byKey.get('14B4:dominant')?.magnitude).toBe(7);
  });

  it('publishes nothing from a component its own animals contradict', () => {
    // B and C are identical on every temperament locus and read differently,
    // so `01A3:dominant` is 4 and 6 at once. The fixpoint correctly abstains
    // (the tally ties, and one bad animal could explain it). The subsystem
    // pass must abstain too rather than pick a pivot value and call it
    // certain — the contradiction belongs to the combination, not the slot.
    const contradicting = [
      horse('A', base(), { temperament: 50 }),
      horse('B', base({ '01A3': 'D' }), { temperament: 54 }),
      horse('C', base({ '01A3': 'D' }), { temperament: 56 }),
    ];
    const study = studyAttribute(contradicting, 'temperament', temperament);
    expect(study.findings).toEqual([]);
  });

  it('does not score itself: the equations it solved are not held-out tests', () => {
    // Every equation in `pinned` went into the solve, so none of them is an
    // out-of-sample test. Counting them would report a guaranteed 100%.
    const study = studyAttribute(pinned, 'temperament', temperament);
    expect(study.findings.length).toBe(3);
    expect(study.validation.tested).toBe(0);
  });

  it('survives a corrupt non-integer reading instead of failing the study', () => {
    // Nothing produces one today, but both subject sources only type-check
    // the value. Reaching exact arithmetic, it would abort every attribute.
    const corrupt = [...pinned, horse('X', base({ '01A3': 'D' }), { temperament: 55.5 })];
    expect(() => studyAttribute(corrupt, 'temperament', temperament)).not.toThrow();
    const study = studyAttribute(corrupt, 'temperament', temperament);
    expect(study.findings.find((f) => slotKey(f) === '01A3:dominant')?.magnitude).toBe(3);
  });

  it('counts every animal behind a doubt, not just the displayed witnesses', () => {
    // Same shape as the sign-clash case — every pair differs at two slots, so
    // only the subsystem pass can reach `01A3` — with two animals stabled.
    // The doubt panel ranks by how many animals are involved and whether any
    // pair is settleable, so both must come from the whole pair list rather
    // than the three pairs the table happens to show.
    const many = [
      horse('V', base(), { temperament: 50 }),
      horse('U', base({ '01A3': 'D', '01A1': 'R' }), { temperament: 52 }),
      horse('T', base({ '01A1': 'R', '14B4': 'D' }), { temperament: 62 }, 'Kurbone', true),
      horse('S', base({ '01A3': 'D', '14B4': 'D' }), { temperament: 54 }, 'Kurbone', true),
    ];
    const study = studyAttribute(many, 'temperament', temperament);
    const doubt = study.geneDoubts.find((d) => d.gene === '01A3');

    expect(doubt).toBeDefined();
    expect(doubt?.witnesses.length).toBeLessThanOrEqual(3);
    // T and S are both stabled and their difference mentions this slot, so
    // the player can settle it — visible only if the census saw every pair.
    expect(doubt?.checkable).toBe(true);
    expect(doubt?.animals).toBe(4);
  });

  it('leaves a slot open when the system does not determine it', () => {
    // Two animals, one equation, two unknowns: `A + B = 8` has infinitely
    // many solutions and neither slot may be published.
    const underdetermined = [pinned[0], pinned[1]];
    const study = studyAttribute(underdetermined, 'temperament', temperament);
    expect(study.findings).toEqual([]);
  });
});

describe('baselines', () => {
  it('reads an exact base once every expressed magnitude is known', () => {
    const study = studyAttribute(
      [horse('a', base(), { temperament: 40 }), horse('b', base({ '14B4': 'D' }), { temperament: 43 })],
      'temperament',
      temperament,
    );
    expect(study.baselines.readings).toEqual([
      expect.objectContaining({
        breed: 'Kurbone',
        value: 40,
        unresolved: [],
        min: 40,
        max: 40,
        support: 2,
        dissent: 0,
      }),
    ]);
  });

  it('allows a negative base, seen only through animals lifted clear of the floor', () => {
    // 14B4 = 8 and 01A3 = 7, so all three animals put the base at -3. An
    // animal expressing neither would read -3, clamp to 0, and be dropped.
    const study = studyAttribute(
      [
        horse('a', base({ '14B4': 'D', '01A3': 'D' }), { temperament: 12 }),
        horse('b', base({ '14B4': 'D' }), { temperament: 5 }),
        horse('c', base({ '01A3': 'D' }), { temperament: 4 }),
      ],
      'temperament',
      temperament,
    );
    expect(study.baselines.readings[0]).toMatchObject({ value: -3, unresolved: [], support: 3 });
  });

  it('bounds the base by the declared sign of a slot every animal expresses', () => {
    // 01A1 is recessive-positive and every animal is `R`, so no pair differs
    // at it: only base + 01A1 is observable, and the base is below it.
    const study = studyAttribute(
      [
        horse('a', base({ '01A1': 'R' }), { temperament: 5 }),
        horse('b', base({ '01A1': 'R', '14B4': 'D' }), { temperament: 8 }),
      ],
      'temperament',
      temperament,
    );
    expect(study.baselines.readings).toEqual([
      expect.objectContaining({ value: 5, unresolved: ['01A1:recessive'], min: null, max: 4, support: 2 }),
    ]);
  });

  it('gives an exact gap between breeds that leave the same slots unresolved', () => {
    const study = studyAttribute(
      [
        horse('k1', base({ '01A1': 'R' }), { temperament: 5 }),
        horse('k2', base({ '01A1': 'R', '14B4': 'D' }), { temperament: 8 }),
        horse('p1', base({ '01A1': 'R' }), { temperament: 25 }, 'Paint'),
        horse('p2', base({ '01A1': 'R', '02C1': 'D' }), { temperament: 27 }, 'Paint'),
      ],
      'temperament',
      temperament,
    );
    expect(study.baselines.readings.map((r) => [r.breed, r.max])).toEqual([
      ['Kurbone', 4],
      ['Paint', 24],
    ]);
    expect(study.baselines.offsets).toEqual([
      // Every Kurbone–Paint pair: 01A1 cancels, and each side's other slot is known.
      { breed: 'Paint', relativeTo: 'Kurbone', offset: 20, support: 4, dissent: 0, animals: 4 },
    ]);
  });

  it('names the animal that reads another base', () => {
    const study = studyAttribute(
      [
        // Same active set, so no pair among them is an equation: the base
        // reading is the only check that can catch the odd one out.
        horse('a', base(), { temperament: 40 }),
        horse('b', base({ '14B2': 'R' }), { temperament: 40 }),
        horse('bad', base(), { temperament: 43 }),
      ],
      'temperament',
      temperament,
    );
    const [reading] = study.baselines.readings;
    expect(reading).toMatchObject({ value: 40, support: 2, dissent: 1, dissenters: ['bad'] });
  });

  it('publishes nothing for a breed whose animals split evenly', () => {
    const study = studyAttribute(
      [horse('a', base(), { temperament: 40 }), horse('b', base(), { temperament: 41 })],
      'temperament',
      temperament,
    );
    expect(study.baselines.readings).toEqual([]);
  });

  it('groups by recorded breed inside one pairing pool', () => {
    const pooled = (id: string, genes: Record<string, string>, value: number, group: string): StudySubject => ({
      ...horse(id, genes, { temperament: value }, ''),
      baselineGroup: group,
    });
    const study = studyAttribute(
      [
        pooled('b1', base(), 40, 'Bee'),
        pooled('b2', base({ '01A3': 'D' }), 44, 'Bee'),
        pooled('w1', base(), 40, 'Wasp'),
        pooled('n1', base(), 40, ''),
      ],
      'temperament',
      // Only the generic loci: a pooled species has no breed-locked ones.
      temperament.filter((slot) => slot.breed === ''),
    );
    expect(study.baselines.readings.map((r) => r.breed).sort()).toEqual(['', 'Bee', 'Wasp']);
    // The unbred group could be either, so it is never compared.
    expect(study.baselines.offsets).toEqual([expect.objectContaining({ breed: 'Wasp', relativeTo: 'Bee', offset: 0 })]);
  });
});

describe('comparing across breeds', () => {
  it('solves a shared gene from animals of two breeds once their gap is known', () => {
    // Kurbone: k1/k2 give 14B4 = 3. Paint: p1 vs k1 differs only by the base
    // gap. Paint has more animals, so it is the reference and the gap is
    // reported as Kurbone's.
    const study = studyAttribute(
      [
        horse('k1', base(), { temperament: 40 }),
        horse('k2', base({ '14B4': 'D' }), { temperament: 43 }),
        horse('p1', base(), { temperament: 60 }, 'Paint'),
        horse('p2', base({ '01A3': 'D', '02C1': 'D' }), { temperament: 67 }, 'Paint'),
        horse('p3', base({ '02C1': 'D' }), { temperament: 62 }, 'Paint'),
      ],
      'temperament',
      temperament,
    );
    const byKey = new Map(study.findings.map((f) => [slotKey(f), f.magnitude]));
    expect(byKey.get('14B4:dominant')).toBe(3);
    expect(byKey.get('02C1:dominant')).toBe(2);
    expect(byKey.get('01A3:dominant')).toBe(5);
    expect(study.baselines.offsets).toEqual([
      expect.objectContaining({ breed: 'Kurbone', relativeTo: 'Paint', offset: -20 }),
    ]);
  });

  it('reaches a pair too far apart on raw slots once most of them are known', () => {
    // a and b differ at five known slots and one unknown (01A1). With
    // maxDistance 2 the raw pair is never built; measured by unknowns it is
    // a single-difference equation.
    const study = studyAttribute(
      [
        horse('ref', base(), { temperament: 40 }),
        horse('s1', base({ '14B4': 'D' }), { temperament: 43 }),
        horse('s2', base({ '01A2': 'D' }), { temperament: 38 }),
        horse('s3', base({ '01A3': 'D' }), { temperament: 44 }),
        horse('far', base({ '14B4': 'D', '01A2': 'D', '01A3': 'D', '01A1': 'R' }), { temperament: 50 }),
      ],
      'temperament',
      temperament,
      { maxDistance: 2 },
    );
    const byKey = new Map(study.findings.map((f) => [slotKey(f), f.magnitude]));
    // 50 = 40 + 3 − 2 + 4 + m(01A1)
    expect(byKey.get('01A1:recessive')).toBe(5);
  });

  it('does not invent an exact base when the gap is confounded with a slot', () => {
    const study = studyAttribute(
      [
        horse('k1', base(), { temperament: 40 }),
        horse('k2', base({ '14B4': 'D' }), { temperament: 43 }),
        // Every Paint carries 01A1, so on its own Paint only bounds its base.
        horse('p1', base({ '01A1': 'R' }), { temperament: 65 }, 'Paint'),
        horse('p2', base({ '01A1': 'R', '02C1': 'D' }), { temperament: 67 }, 'Paint'),
      ],
      'temperament',
      temperament,
    );
    const paint = study.baselines.readings.find((r) => r.breed === 'Paint');
    // Kurbone base 40 exactly; cross pairs pin gap + 01A1 = 25 but not the gap
    // alone, so Paint keeps only its own bound: base + 01A1 = 65.
    expect(study.baselines.readings.find((r) => r.breed === 'Kurbone')).toMatchObject({ min: 40, max: 40 });
    expect(study.baselines.offsets).toEqual([]);
    expect(paint).toMatchObject({ min: null, max: 64 });
    expect(paint?.via).toBeUndefined();
  });

  it("turns one breed's exact base into another's through the gap", () => {
    const study = studyAttribute(
      [
        horse('k1', base(), { temperament: 40 }),
        horse('k2', base({ '14B4': 'D' }), { temperament: 43 }),
        horse('p1', base(), { temperament: 60 }, 'Paint'),
        // Most Paints carry 01A2 (−) and 01A3 (+) together, which no pair
        // separates and whose mixed signs bound nothing.
        horse('p2', base({ '01A2': 'D', '01A3': 'D' }), { temperament: 63 }, 'Paint'),
        horse('p3', base({ '01A2': 'D', '01A3': 'D', '14B2': 'R' }), { temperament: 63 }, 'Paint'),
      ],
      'temperament',
      temperament,
    );
    const paint = study.baselines.readings.find((r) => r.breed === 'Paint');
    expect(paint).toMatchObject({ value: 63, unresolved: ['01A2:dominant', '01A3:dominant'], min: 60, max: 60 });
  });

  it('keeps adding rounds for as long as each one solves something', () => {
    // A chain where every round unlocks the next two slots: a_k expresses
    // g(k−1) and g(k), so it only becomes a single-unknown pair once g(k−1)
    // is known. With maxDistance 1, nothing past g2 is reachable in the
    // first pass, and the 21-slot chain needs ten cross rounds.
    const chain: EffectSlot[] = Array.from({ length: 21 }, (_, i) => ({
      gene: `g${i + 1}`,
      expression: 'dominant',
      attribute: 'temperament',
      sign: 1,
      breed: '',
    }));
    const carrying = (...ks: number[]) =>
      Object.fromEntries(chain.map((slot, i) => [slot.gene, ks.includes(i + 1) ? 'D' : 'R']));
    const subjects = [
      horse('ref', carrying(), { temperament: 10 }),
      horse('a1', carrying(1), { temperament: 11 }),
      ...Array.from({ length: 20 }, (_, i) => {
        const k = i + 2;
        return horse(`a${k}`, carrying(k - 1, k), { temperament: 10 + (k - 1) + k });
      }),
    ];
    const study = studyAttribute(subjects, 'temperament', chain, { maxDistance: 1 });
    expect(study.findings).toHaveLength(21);
    expect(new Map(study.findings.map((f) => [f.gene, f.magnitude])).get('g21')).toBe(21);
  });

  it('never publishes a base gap as a gene finding', () => {
    const study = studyAttribute(
      [horse('k', base(), { temperament: 40 }), horse('p', base(), { temperament: 60 }, 'Paint')],
      'temperament',
      temperament,
    );
    expect(study.findings).toEqual([]);
    expect(study.baselines.offsets[0]).toMatchObject({ breed: 'Paint', offset: 20 });
  });

  it('keeps a gap of zero, which is a result rather than a missing effect', () => {
    const study = studyAttribute(
      [horse('k', base(), { temperament: 40 }), horse('p', base(), { temperament: 40 }, 'Paint')],
      'temperament',
      temperament,
    );
    expect(study.baselines.offsets[0]).toMatchObject({ breed: 'Paint', offset: 0 });
  });
});
