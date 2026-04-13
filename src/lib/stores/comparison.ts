import { derived, type Writable, writable } from 'svelte/store';
import { normalizeSpecies } from '$lib/services/configService.js';
import type { Pet } from '$lib/types/index.js';

/** The two pets selected for comparison (index 0 = left, index 1 = right). */
export const comparisonPets: Writable<[Pet | null, Pet | null]> = writable([null, null]);

/** Whether multi-select mode is active in PetList. */
export const compareSelectMode: Writable<boolean> = writable(false);

/** Are both comparison slots filled? */
export const comparisonReady = derived(comparisonPets, ($cp) => $cp[0] !== null && $cp[1] !== null);

/** Do the two selected pets have different species? */
export const speciesMismatch = derived(comparisonPets, ($cp) => {
  if (!$cp[0] || !$cp[1]) return false;
  return normalizeSpecies($cp[0].species) !== normalizeSpecies($cp[1].species);
});

function update(fn: (current: [Pet | null, Pet | null]) => [Pet | null, Pet | null]) {
  comparisonPets.update(fn);
}

export const comparisonActions = {
  /** Set a specific slot (0 = left, 1 = right). */
  setPet(index: 0 | 1, pet: Pet | null) {
    update((current) => {
      const next: [Pet | null, Pet | null] = [...current];
      next[index] = pet;
      return next;
    });
  },

  /** Add a pet to the first empty slot, or replace slot 1 if both are full. */
  addPet(pet: Pet) {
    update((current) => {
      if (current[0] === null) return [pet, current[1]];
      if (current[1] === null) return [current[0], pet];
      // Both full — replace slot 1
      return [current[0], pet];
    });
  },

  /** Remove a pet by ID from whichever slot it occupies. */
  removePet(petId: number) {
    update((current) => {
      if (current[0]?.id !== petId && current[1]?.id !== petId) return current;
      const next: [Pet | null, Pet | null] = [...current];
      if (next[0]?.id === petId) next[0] = null;
      if (next[1]?.id === petId) next[1] = null;
      return next;
    });
  },

  /** Swap left and right pets. */
  swapPets() {
    update((current) => [current[1], current[0]]);
  },

  /** Clear both slots. */
  clear() {
    comparisonPets.set([null, null]);
  },

  /** Toggle multi-select mode in PetList. */
  toggleSelectMode() {
    compareSelectMode.update((v) => !v);
  },
};
