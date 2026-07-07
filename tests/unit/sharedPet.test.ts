import { describe, expect, it } from 'vitest';
import { DEFAULT_ATTRIBUTE_VALUE, type SharedPet } from '$lib/types/index.js';
import { PREVIEW_PET_ID, sharedPetToPet } from '$lib/utils/sharedPet.js';

function makeShared(overrides: Partial<SharedPet> = {}): SharedPet {
  return {
    contentHash: 'hash-1',
    name: 'Buzz',
    character: 'Player',
    species: 'BeeWasp',
    gender: 'Female',
    breed: '',
    breeder: 'Player',
    notes: '',
    tags: [],
    uploadedAt: new Date('2026-05-10T12:00:00Z'),
    schemaVersion: 1,
    appVersion: '1.0.0',
    ...overrides,
  } as SharedPet;
}

describe('sharedPetToPet', () => {
  it('maps published attributes onto the pet fields', () => {
    const pet = sharedPetToPet(
      makeShared({
        attributes: { intelligence: 62, toughness: 55, ferocity: 71 },
        genomeData: 'GENOME',
      }),
    );
    expect(pet.intelligence).toBe(62);
    expect(pet.toughness).toBe(55);
    expect(pet.ferocity).toBe(71);
    // Absent keys fall back to the neutral default.
    expect(pet.virility).toBe(DEFAULT_ATTRIBUTE_VALUE);
    expect(pet.genome_text).toBe('GENOME');
    expect(pet.id).toBe(PREVIEW_PET_ID);
  });

  it('uses neutral defaults for legacy entries with no attributes map', () => {
    const pet = sharedPetToPet(makeShared());
    for (const k of ['intelligence', 'toughness', 'temperament', 'ferocity'] as const) {
      expect(pet[k]).toBe(DEFAULT_ATTRIBUTE_VALUE);
    }
  });

  it('carries species/breed/gender/name through for the visualizer', () => {
    const pet = sharedPetToPet(makeShared({ species: 'Horse', breed: 'Standardbred', name: 'Dobbin' }));
    expect(pet.species).toBe('Horse');
    expect(pet.breed).toBe('Standardbred');
    expect(pet.name).toBe('Dobbin');
  });
});
