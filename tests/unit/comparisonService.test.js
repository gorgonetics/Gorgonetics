import { describe, expect, it } from 'vitest';
import { compareAttributes } from '$lib/services/comparisonService.js';

const makePet = (overrides) => ({
  id: 1,
  name: 'TestPet',
  species: 'BeeWasp',
  gender: 'Male',
  breed: '',
  breeder: '',
  content_hash: '',
  genome_data: '',
  notes: '',
  tags: [],
  created_at: '',
  updated_at: '',
  intelligence: 50,
  toughness: 50,
  friendliness: 50,
  ruggedness: 50,
  enthusiasm: 50,
  virility: 50,
  ferocity: 50,
  temperament: 50,
  ...overrides,
});

describe('Comparison Service', () => {
  describe('compareAttributes', () => {
    it('returns correct diffs for BeeWasp pets', () => {
      const petA = makePet({ id: 1, name: 'Buzzy', intelligence: 80, toughness: 30 });
      const petB = makePet({ id: 2, name: 'Stinger', intelligence: 60, toughness: 70 });

      const results = compareAttributes(petA, petB);

      // Should have 7 attributes for BeeWasp (6 core + ferocity)
      expect(results.length).toBe(7);

      const intel = results.find((r) => r.key === 'Intelligence');
      expect(intel).toBeDefined();
      expect(intel.petAValue).toBe(80);
      expect(intel.petBValue).toBe(60);
      expect(intel.diff).toBe(20);
      expect(intel.winner).toBe('a');

      const tough = results.find((r) => r.key === 'Toughness');
      expect(tough).toBeDefined();
      expect(tough.petAValue).toBe(30);
      expect(tough.petBValue).toBe(70);
      expect(tough.diff).toBe(-40);
      expect(tough.winner).toBe('b');
    });

    it('returns tie for equal attributes', () => {
      const petA = makePet({ id: 1, intelligence: 50 });
      const petB = makePet({ id: 2, intelligence: 50 });

      const results = compareAttributes(petA, petB);
      const intel = results.find((r) => r.key === 'Intelligence');
      expect(intel.winner).toBe('tie');
      expect(intel.diff).toBe(0);
    });

    it('includes species-specific attributes for BeeWasp', () => {
      const petA = makePet({ id: 1, ferocity: 80 });
      const petB = makePet({ id: 2, ferocity: 40 });

      const results = compareAttributes(petA, petB);
      const ferocity = results.find((r) => r.key === 'Ferocity');
      expect(ferocity).toBeDefined();
      expect(ferocity.petAValue).toBe(80);
      expect(ferocity.petBValue).toBe(40);
      expect(ferocity.winner).toBe('a');
    });

    it('includes species-specific attributes for Horse', () => {
      const petA = makePet({ id: 1, species: 'Horse', temperament: 90 });
      const petB = makePet({ id: 2, species: 'Horse', temperament: 30 });

      const results = compareAttributes(petA, petB);
      const temperament = results.find((r) => r.key === 'Temperament');
      expect(temperament).toBeDefined();
      expect(temperament.winner).toBe('a');
      expect(temperament.diff).toBe(60);
    });

    it('returns attribute info with name and icon', () => {
      const petA = makePet({ id: 1 });
      const petB = makePet({ id: 2 });

      const results = compareAttributes(petA, petB);
      const intel = results.find((r) => r.key === 'Intelligence');
      expect(intel.name).toBe('Intelligence');
      expect(intel.icon).toBe('🧠');
    });
  });
});
