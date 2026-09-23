import { describe, expect, it } from 'vitest';
import type { Pet } from '$lib/types/index.js';
import { planNameBackfill, updatesFromName } from '$lib/utils/nameAttributes.js';

const HORSE_NAME = 'Kb F 60 70 65 80 90 100 55';
const HORSE_VALUES = {
  temperament: 60,
  toughness: 70,
  ruggedness: 65,
  enthusiasm: 80,
  friendliness: 90,
  intelligence: 100,
  virility: 55,
};

const pet = (over: Partial<Pet> = {}): Pet =>
  ({
    id: 1,
    name: HORSE_NAME,
    species: 'Horse',
    breed: '',
    gender: 'Male',
    attributes_measured: false,
    temperament: 50,
    toughness: 50,
    ruggedness: 50,
    enthusiasm: 50,
    friendliness: 50,
    intelligence: 50,
    virility: 50,
    ...over,
  }) as unknown as Pet;

describe('updatesFromName', () => {
  it('reads attributes and gender, and a breed only for a pet without one', () => {
    expect(updatesFromName(pet())).toEqual({ attributes: HORSE_VALUES, gender: 'Female', breed: 'Kurbone' });
    expect(updatesFromName(pet({ breed: 'Paint' }))?.breed).toBeUndefined();
  });

  it('takes a beewasp breed from a leading Bee or Wasp, and none from another word', () => {
    const updates = updatesFromName(pet({ species: 'BeeWasp', name: 'Wasp M 60 70 65 80 90 100 55' }));
    expect(updates?.attributes.ferocity).toBe(60);
    expect(updates?.breed).toBe('Wasp');
    expect(updatesFromName(pet({ species: 'BeeWasp', name: 'Bz M 60 70 65 80 90 100 55' }))?.breed).toBeUndefined();
  });

  it('is null for a name that does not parse', () => {
    expect(updatesFromName(pet({ name: 'Dusty' }))).toBeNull();
  });
});

describe('planNameBackfill', () => {
  it('fills unmeasured pets whose names parse', () => {
    const plan = planNameBackfill([pet({ id: 1 }), pet({ id: 2, name: 'Dusty' })]);
    expect(plan.fill.map((e) => e.pet.id)).toEqual([1]);
    expect(plan.conflicts).toEqual([]);
  });

  it('lists measured pets that disagree with their name, and only the differing attributes', () => {
    const measured = pet({ id: 3, attributes_measured: true, ...HORSE_VALUES, toughness: 72 } as Partial<Pet>);
    const plan = planNameBackfill([measured]);
    expect(plan.fill).toEqual([]);
    expect(plan.conflicts).toHaveLength(1);
    expect(plan.conflicts[0].differences).toEqual([{ attribute: 'toughness', stored: 72, fromName: 70 }]);
  });

  it('ignores measured pets that already match their name', () => {
    const matching = pet({ attributes_measured: true, ...HORSE_VALUES } as Partial<Pet>);
    expect(planNameBackfill([matching])).toEqual({ fill: [], conflicts: [] });
  });

  it('reports gender and breed the name would change alongside the attributes', () => {
    const measured = pet({
      id: 4,
      attributes_measured: true,
      ...HORSE_VALUES,
      toughness: 72,
      gender: 'Male',
    } as Partial<Pet>);
    const [conflict] = planNameBackfill([measured]).conflicts;
    expect(conflict.fieldChanges).toEqual([
      { field: 'gender', stored: 'Male', fromName: 'Female' },
      { field: 'breed', stored: '', fromName: 'Kurbone' },
    ]);
  });

  it('skips a disagreement kept under the same name, and brings it back after a rename', () => {
    const measured = pet({ id: 5, attributes_measured: true, ...HORSE_VALUES, toughness: 72 } as Partial<Pet>);
    expect(planNameBackfill([measured], { '5': HORSE_NAME }).conflicts).toEqual([]);
    const renamed = { ...measured, name: `${HORSE_NAME} Renamed` } as Pet;
    expect(planNameBackfill([renamed], { '5': HORSE_NAME }).conflicts).toHaveLength(1);
  });
});
