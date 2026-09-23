/**
 * Attributes read from a pet's structured name, after import.
 *
 * `uploadPet` reads a structured name once, at import. A pet renamed into
 * the format later, or imported before its species had a rule, keeps its
 * defaults, and the name the player can see then disagrees with the values
 * the app uses. This plans the catch-up.
 *
 * Two cases, kept apart because only one is safe to automate:
 *
 *  - **fill** — the stored attributes were never measured, so the name is
 *    the only reading there is and nothing is lost by taking it.
 *  - **conflict** — the stored attributes are readings (typed in, or read
 *    from an earlier name) and the name says otherwise. Either could be the
 *    stale one, so these are listed for the player, never overwritten.
 *
 * Pure. No DB, no Svelte.
 */

import { parseStructuredPetName } from '$lib/services/nameParser.js';
import type { Gender, Pet } from '$lib/types/index.js';

/** The fields a name can supply, in the shape `updatePet` accepts. */
export interface NameUpdates {
  attributes: Record<string, number>;
  /** Import takes the gender from a structured name too. */
  gender: Gender;
  /** Only when the pet has no breed yet and the name names one. */
  breed?: string;
}

export interface AttributeDifference {
  attribute: string;
  stored: number | undefined;
  fromName: number;
}

export interface NameBackfillPlan {
  fill: Array<{ pet: Pet; updates: NameUpdates }>;
  conflicts: Array<{ pet: Pet; updates: NameUpdates; differences: AttributeDifference[] }>;
}

/** What a pet's name supplies, or `null` when the name does not parse. */
export function updatesFromName(pet: Pick<Pet, 'name' | 'species' | 'breed'>): NameUpdates | null {
  const parsed = parseStructuredPetName(pet.name ?? '', pet.species ?? '');
  if (!parsed) return null;
  const updates: NameUpdates = { attributes: parsed.attributes, gender: parsed.gender };
  if (!pet.breed && parsed.breed) updates.breed = parsed.breed;
  return updates;
}

/** Attributes where the stored value and the name's value differ. */
export function attributeDifferences(pet: Pet, attributes: Record<string, number>): AttributeDifference[] {
  const out: AttributeDifference[] = [];
  for (const [attribute, fromName] of Object.entries(attributes)) {
    const stored = (pet as unknown as Record<string, unknown>)[attribute];
    const value = typeof stored === 'number' ? stored : undefined;
    if (value !== fromName) out.push({ attribute, stored: value, fromName });
  }
  return out;
}

export function planNameBackfill(pets: readonly Pet[]): NameBackfillPlan {
  const plan: NameBackfillPlan = { fill: [], conflicts: [] };
  for (const pet of pets) {
    const updates = updatesFromName(pet);
    if (!updates) continue;
    // Unmeasured: taken even when the values happen to match the defaults,
    // because the write is what records them as readings.
    if (!pet.attributes_measured) {
      plan.fill.push({ pet, updates });
      continue;
    }
    const differences = attributeDifferences(pet, updates.attributes);
    if (differences.length > 0) plan.conflicts.push({ pet, updates, differences });
  }
  return plan;
}
