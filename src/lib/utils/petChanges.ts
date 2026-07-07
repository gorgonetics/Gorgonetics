/**
 * Pure change-diff for `PetEditor`.
 *
 * Extracted from the in-component `handleSave` so the field-by-field
 * comparison that builds `updateData` can be unit-tested rather than living
 * inside an async save handler (#313, follow-up to #306 / #310).
 *
 * The returned object holds only the keys that actually changed, matching the
 * `appState.updatePet` partial-update contract. `handleSave` stays a thin
 * wrapper: it builds the draft from component state, calls this, and persists
 * when the result is non-empty.
 */

import type { Gender, Pet } from '$lib/types/index.js';

/** Editable snapshot of a pet, as held by the `PetEditor` form state. */
export interface PetEditDraft {
  /** Raw name input; trimmed before comparison/persistence. */
  name: string;
  gender: Gender;
  /** Raw breed input; trimmed before comparison/persistence. */
  breed: string;
  /** Attribute values keyed by lowercased attribute name. */
  attributes: Record<string, number>;
  tags: string[];
  starred: boolean;
  stabled: boolean;
  isPetQuality: boolean;
}

/**
 * Compute the partial update for a pet: only the fields whose draft value
 * differs from the stored pet. `attributes` and `tags` are nested sub-objects,
 * present only when something within them changed.
 *
 * Returns an empty object when nothing changed — callers use that to skip the
 * persist call.
 */
export function computePetChanges(pet: Pet, draft: PetEditDraft): Record<string, unknown> {
  const updateData: Record<string, unknown> = {};

  if (draft.name.trim() !== pet.name) updateData.name = draft.name.trim();
  if (draft.gender !== pet.gender) updateData.gender = draft.gender;
  // Unset breed is stored as '' (DB default); the editor's "Not set" option
  // maps to '' too, so an unset breed round-trips without a spurious write.
  if (draft.breed.trim() !== (pet.breed ?? '')) updateData.breed = draft.breed.trim();

  const attributeChanges: Record<string, number> = {};
  for (const [key, value] of Object.entries(draft.attributes)) {
    if ((pet as unknown as Record<string, unknown>)[key] !== value) attributeChanges[key] = value;
  }
  if (Object.keys(attributeChanges).length > 0) updateData.attributes = attributeChanges;

  const currentTags = pet.tags ?? [];
  const tagsChanged = draft.tags.length !== currentTags.length || draft.tags.some((t, i) => t !== currentTags[i]);
  if (tagsChanged) updateData.tags = draft.tags;

  if (draft.starred !== !!pet.starred) updateData.starred = draft.starred;
  if (draft.stabled !== !!pet.stabled) updateData.stabled = draft.stabled;
  if (draft.isPetQuality !== !!pet.is_pet_quality) updateData.is_pet_quality = draft.isPetQuality;

  return updateData;
}
