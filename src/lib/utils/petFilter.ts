/**
 * Pure pet-list filtering, the single source of truth for the Library roster.
 *
 * Extracted from the old in-component `filteredPets` $derived so the
 * search / tag / starred / stabled predicate can be unit-tested rather than
 * living as a closure over component reactive state (#306 audit per #310).
 *
 * The `species` / `breed` / `gender` / `petQualityOnly` fields are optional so
 * a search-less or species-agnostic surface can omit them; the redesign Library
 * (MyPets + Roster) passes them all via `getLibraryFilters()`.
 * See docs/design/redesign-library-workspace-v1.md.
 */

import { normalizeSpecies } from '$lib/services/configService.js';
import type { Gender, Pet } from '$lib/types/index.js';

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
  /** Exact gender; '' or omitted means all genders. */
  gender?: Gender | '';
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
  if (filters.gender && pet.gender !== filters.gender) return false;
  return true;
}

/** Return the pets that pass the active list filters, preserving order. */
export function filterPets(pets: Pet[], filters: PetListFilters): Pet[] {
  return pets.filter((pet) => petMatchesFilters(pet, filters));
}
