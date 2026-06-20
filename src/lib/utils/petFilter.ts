/**
 * Pure pet-list filtering for `PetList`.
 *
 * Extracted from the in-component `filteredPets` $derived so the
 * search / tag / starred / stabled predicate can be unit-tested rather than
 * living as a closure over component reactive state (#306 audit per #310).
 */

import type { Pet } from '$lib/types/index.js';

export interface PetListFilters {
  /** Search text, matched case-insensitively against name and species. Empty means "no search". */
  query: string;
  /** Tags that must ALL be present on the pet. */
  tags: string[];
  starredOnly: boolean;
  stabledOnly: boolean;
}

/** Whether a pet passes the active list filters. */
export function petMatchesFilters(pet: Pet, filters: PetListFilters): boolean {
  const q = filters.query ? filters.query.toLowerCase() : '';
  if (q) {
    if (!(pet.name || '').toLowerCase().includes(q) && !(pet.species || '').toLowerCase().includes(q)) {
      return false;
    }
  }
  if (filters.tags.length > 0) {
    const petTags = pet.tags ?? [];
    if (!filters.tags.every((t) => petTags.includes(t))) return false;
  }
  if (filters.starredOnly && !pet.starred) return false;
  if (filters.stabledOnly && !pet.stabled) return false;
  return true;
}

/** Return the pets that pass the active list filters, preserving order. */
export function filterPets(pets: Pet[], filters: PetListFilters): Pet[] {
  return pets.filter((pet) => petMatchesFilters(pet, filters));
}
