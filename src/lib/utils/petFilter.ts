/**
 * Pure pet-list filtering, shared by `PetList` and the redesign Library.
 *
 * Extracted from the in-component `filteredPets` $derived so the
 * search / tag / starred / stabled predicate can be unit-tested rather than
 * living as a closure over component reactive state (#306 audit per #310).
 *
 * The `species` / `breed` / `petQualityOnly` fields are optional so the
 * Library can reuse this predicate as the single source of truth for filtering
 * (absorbing the Stable filters) without changing `PetList`, which omits them.
 * See docs/design/redesign-library-workspace-v1.md.
 */

import { normalizeSpecies } from '$lib/services/configService.js';
import type { Pet } from '$lib/types/index.js';

export interface PetListFilters {
  /** Search text, matched case-insensitively against name and species. Empty means "no search". */
  query: string;
  /** Tags that must ALL be present on the pet. */
  tags: string[];
  starredOnly: boolean;
  stabledOnly: boolean;
  /** Normalized species; '' or omitted means all species. */
  species?: string;
  /** Breed name; '' or omitted means all breeds. */
  breed?: string;
  petQualityOnly?: boolean;
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
  if (filters.petQualityOnly && !pet.is_pet_quality) return false;
  if (filters.species && normalizeSpecies(pet.species) !== filters.species) return false;
  if (filters.breed && pet.breed !== filters.breed) return false;
  return true;
}

/** Return the pets that pass the active list filters, preserving order. */
export function filterPets(pets: Pet[], filters: PetListFilters): Pet[] {
  return pets.filter((pet) => petMatchesFilters(pet, filters));
}
