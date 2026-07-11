/**
 * Pure filtering for community-catalogue rows (SharedPet), mirroring the
 * Library's `petFilter.ts` so both surfaces speak the same filter language
 * (FilterBar). Kept separate because the two shapes diverge: SharedPet has
 * no starred/stabled/pet-quality flags, and its "owner" is the share
 * payload's `character` (falling back to `breeder` on older entries).
 *
 * Filtering is client-side over the *loaded* pages only — the catalogue is
 * cursor-paginated (50/page, newest-first) and this pass deliberately does
 * not push predicates into Firestore. If server-side filtering lands later,
 * this module stays the single place that defines match semantics.
 */

import { normalizeSpecies } from '$lib/services/configService.js';
import type { Gender, SharedPet } from '$lib/types/index.js';

export interface SharedPetFilters {
  /** Search text, matched case-insensitively against name, owner (character/breeder) and species. Empty means "no search". */
  query: string;
  /** Normalized species (e.g. 'beewasp'); '' or omitted means all species. */
  species?: string;
  /** Breed name; '' or omitted means all breeds. */
  breed?: string;
  /** Exact gender; '' or omitted means all genders. */
  gender?: Gender | '';
  /** Tags that must ALL be present on the entry. */
  tags?: string[];
}

/** The owner/sharer name shown in the catalogue's Owner column. */
export function sharedPetOwner(pet: SharedPet): string {
  return pet.character || pet.breeder || '';
}

/** Whether a shared pet passes the active catalogue filters. */
export function sharedPetMatchesFilters(pet: SharedPet, filters: SharedPetFilters): boolean {
  const q = filters.query ? filters.query.toLowerCase() : '';
  if (q) {
    const matches =
      (pet.name || '').toLowerCase().includes(q) ||
      sharedPetOwner(pet).toLowerCase().includes(q) ||
      (pet.species || '').toLowerCase().includes(q);
    if (!matches) return false;
  }
  if (filters.tags && filters.tags.length > 0) {
    const petTags = pet.tags ?? [];
    if (!filters.tags.every((t) => petTags.includes(t))) return false;
  }
  if (filters.species && normalizeSpecies(pet.species) !== filters.species) return false;
  if (filters.breed && pet.breed !== filters.breed) return false;
  if (filters.gender && pet.gender !== filters.gender) return false;
  return true;
}

/** Return the shared pets that pass the active filters, preserving order. */
export function filterSharedPets(pets: SharedPet[], filters: SharedPetFilters): SharedPet[] {
  return pets.filter((pet) => sharedPetMatchesFilters(pet, filters));
}
