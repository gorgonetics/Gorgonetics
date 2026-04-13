import { get } from 'svelte/store';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  compareSelectMode,
  comparisonActions,
  comparisonPets,
  comparisonReady,
  speciesMismatch,
} from '$lib/stores/comparison.js';

const fakeBee1 = { id: 1, name: 'Buzzy', species: 'BeeWasp' };
const fakeBee2 = { id: 2, name: 'Stinger', species: 'BeeWasp' };
const fakeHorse = { id: 3, name: 'Thunder', species: 'Horse' };

describe('Comparison Store', () => {
  beforeEach(() => {
    comparisonActions.clear();
    compareSelectMode.set(false);
  });

  describe('initial state', () => {
    it('starts with both slots empty', () => {
      const [a, b] = get(comparisonPets);
      expect(a).toBeNull();
      expect(b).toBeNull();
    });

    it('starts not ready', () => {
      expect(get(comparisonReady)).toBe(false);
    });

    it('starts with no species mismatch', () => {
      expect(get(speciesMismatch)).toBe(false);
    });

    it('starts with compare select mode off', () => {
      expect(get(compareSelectMode)).toBe(false);
    });
  });

  describe('addPet', () => {
    it('fills slot 0 first when both empty', () => {
      comparisonActions.addPet(fakeBee1);
      const [a, b] = get(comparisonPets);
      expect(a).toEqual(fakeBee1);
      expect(b).toBeNull();
    });

    it('fills slot 1 second', () => {
      comparisonActions.addPet(fakeBee1);
      comparisonActions.addPet(fakeBee2);
      const [a, b] = get(comparisonPets);
      expect(a).toEqual(fakeBee1);
      expect(b).toEqual(fakeBee2);
    });

    it('replaces slot 1 when both full', () => {
      comparisonActions.addPet(fakeBee1);
      comparisonActions.addPet(fakeBee2);
      comparisonActions.addPet(fakeHorse);
      const [a, b] = get(comparisonPets);
      expect(a).toEqual(fakeBee1);
      expect(b).toEqual(fakeHorse);
    });
  });

  describe('setPet', () => {
    it('sets a specific slot', () => {
      comparisonActions.setPet(1, fakeBee2);
      const [a, b] = get(comparisonPets);
      expect(a).toBeNull();
      expect(b).toEqual(fakeBee2);
    });

    it('can clear a slot with null', () => {
      comparisonActions.addPet(fakeBee1);
      comparisonActions.setPet(0, null);
      const [a] = get(comparisonPets);
      expect(a).toBeNull();
    });
  });

  describe('removePet', () => {
    it('clears the correct slot by ID', () => {
      comparisonActions.addPet(fakeBee1);
      comparisonActions.addPet(fakeBee2);
      comparisonActions.removePet(fakeBee1.id);
      const [a, b] = get(comparisonPets);
      expect(a).toBeNull();
      expect(b).toEqual(fakeBee2);
    });

    it('does nothing for unknown ID', () => {
      comparisonActions.addPet(fakeBee1);
      comparisonActions.removePet(999);
      const [a] = get(comparisonPets);
      expect(a).toEqual(fakeBee1);
    });
  });

  describe('swapPets', () => {
    it('swaps both slots', () => {
      comparisonActions.addPet(fakeBee1);
      comparisonActions.addPet(fakeBee2);
      comparisonActions.swapPets();
      const [a, b] = get(comparisonPets);
      expect(a).toEqual(fakeBee2);
      expect(b).toEqual(fakeBee1);
    });
  });

  describe('clear', () => {
    it('resets both slots', () => {
      comparisonActions.addPet(fakeBee1);
      comparisonActions.addPet(fakeBee2);
      comparisonActions.clear();
      const [a, b] = get(comparisonPets);
      expect(a).toBeNull();
      expect(b).toBeNull();
    });
  });

  describe('comparisonReady', () => {
    it('is false with one pet', () => {
      comparisonActions.addPet(fakeBee1);
      expect(get(comparisonReady)).toBe(false);
    });

    it('is true with two pets', () => {
      comparisonActions.addPet(fakeBee1);
      comparisonActions.addPet(fakeBee2);
      expect(get(comparisonReady)).toBe(true);
    });
  });

  describe('speciesMismatch', () => {
    it('is false for same species', () => {
      comparisonActions.addPet(fakeBee1);
      comparisonActions.addPet(fakeBee2);
      expect(get(speciesMismatch)).toBe(false);
    });

    it('is true for different species', () => {
      comparisonActions.addPet(fakeBee1);
      comparisonActions.addPet(fakeHorse);
      expect(get(speciesMismatch)).toBe(true);
    });

    it('is false with only one pet', () => {
      comparisonActions.addPet(fakeBee1);
      expect(get(speciesMismatch)).toBe(false);
    });
  });

  describe('toggleSelectMode', () => {
    it('toggles compare select mode', () => {
      expect(get(compareSelectMode)).toBe(false);
      comparisonActions.toggleSelectMode();
      expect(get(compareSelectMode)).toBe(true);
      comparisonActions.toggleSelectMode();
      expect(get(compareSelectMode)).toBe(false);
    });
  });
});
