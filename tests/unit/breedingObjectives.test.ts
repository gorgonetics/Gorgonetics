import { describe, expect, it } from 'vitest';
import type { BreedingPairResult, Pet } from '$lib/types/index.js';
import {
  attributeObjective,
  BREEDING_OBJECTIVE_IDS,
  BREEDING_OBJECTIVES,
  DEFAULT_BREEDING_OBJECTIVE,
  resolveObjective,
} from '$lib/utils/breedingObjectives.js';

const pet = (id: number) => ({ id, name: `p${id}` }) as Pet;

function pair(overrides: Partial<BreedingPairResult>): BreedingPairResult {
  return {
    male: pet(1),
    female: pet(2),
    evMixed: 0,
    evPositiveByAttribute: {},
    evPositiveTotal: 0,
    evPositiveWeighted: 0,
    evCapabilityGain: 0,
    evPositiveImprovement: 0,
    evPairUpgrade: 0,
    betterParentPositives: 0,
    weakerParentPositives: 0,
    evAttributeImprovement: {},
    evNegativeTotal: 0,
    evLiabilityReduction: 0,
    cleanerParentNegatives: 0,
    evUnknown: 0,
    totalLoci: 0,
    ...overrides,
  };
}

describe('breeding objectives', () => {
  it('exposes a stable id for every strategy', () => {
    expect(BREEDING_OBJECTIVE_IDS).toEqual(BREEDING_OBJECTIVES.map((o) => o.id));
    expect(new Set(BREEDING_OBJECTIVE_IDS).size).toBe(BREEDING_OBJECTIVE_IDS.length);
    expect(BREEDING_OBJECTIVE_IDS).toContain(DEFAULT_BREEDING_OBJECTIVE);
  });

  it('sorts by a different field per strategy', () => {
    const p = pair({
      evCapabilityGain: 1,
      evPositiveImprovement: 2,
      evPairUpgrade: 3,
      evLiabilityReduction: 4,
      evPositiveTotal: 5,
    });
    const scores = BREEDING_OBJECTIVES.map((o) => o.score(p));
    expect(new Set(scores).size).toBe(BREEDING_OBJECTIVES.length);
  });

  it('picks genuinely different winners — the point of offering a choice', () => {
    // The regressing pair: high absolute count, no improvement on a parent.
    const regressing = pair({ evPositiveTotal: 346, evPositiveImprovement: 0.27 });
    // The improver: lower absolute count, real headroom.
    const improver = pair({ evPositiveTotal: 319, evPositiveImprovement: 6.01 });
    const byLevel = BREEDING_OBJECTIVES.find((o) => o.id === 'positives') as (typeof BREEDING_OBJECTIVES)[number];
    const byCeiling = BREEDING_OBJECTIVES.find((o) => o.id === 'ceiling') as (typeof BREEDING_OBJECTIVES)[number];
    expect(byLevel.score(regressing)).toBeGreaterThan(byLevel.score(improver));
    expect(byCeiling.score(improver)).toBeGreaterThan(byCeiling.score(regressing));
  });

  it('builds an attribute strategy that reads the per-attribute improvement', () => {
    const o = attributeObjective('Intelligence');
    expect(o.score(pair({ evAttributeImprovement: { Intelligence: 3.5 } }))).toBe(3.5);
    // An attribute the pairing cannot improve scores zero, not undefined.
    expect(o.score(pair({ evAttributeImprovement: {} }))).toBe(0);
  });

  it('round-trips every id, including attribute strategies', () => {
    for (const o of BREEDING_OBJECTIVES) expect(resolveObjective(o.id)?.id).toBe(o.id);
    expect(resolveObjective('attribute:Toughness')?.label).toBe('Improve Toughness');
    expect(resolveObjective('nonsense')).toBeNull();
  });

  /**
   * The persisted objective survives a species switch. Without the attribute
   * filter, `attribute:Toughness` stays selected on a species with no
   * Toughness, the <select> holds a value matching no option, and the planner
   * ranks by a metric the table never shows.
   */
  it('rejects an attribute strategy the species has no attribute for', () => {
    const attrs = ['Toughness', 'Speed'];
    expect(resolveObjective('attribute:Toughness', attrs)?.id).toBe('attribute:Toughness');
    expect(resolveObjective('attribute:Endurance', attrs)).toBeNull();
    // A general strategy is species-independent and always resolves.
    expect(resolveObjective('reach', attrs)?.id).toBe('reach');
  });
});
