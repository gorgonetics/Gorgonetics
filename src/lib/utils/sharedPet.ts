/**
 * Adapt a catalogue `SharedPet` into the `Pet` shape the gene visualizer
 * and stats table expect, so a community pet can be previewed with the
 * exact same components as a local one — without ever inserting it into
 * the local database.
 *
 * The visualizer keys off `species` / `breed` / `name` and reads the eight
 * attribute columns off the pet object; its grid comes from the
 * `gridOverride` prop (built via `genomeTextToGrid`), so the synthetic
 * `id` is never used to hit the DB. Attribute values come from the
 * uploader's published `attributes` map when present; legacy entries
 * without it fall back to the neutral default, matching what the importer
 * would re-derive.
 */

import { DEFAULT_ATTRIBUTE_VALUE, type Pet, type SharedPet } from '$lib/types/index.js';

/** Sentinel id for a not-in-DB preview pet. Never persisted or queried. */
export const PREVIEW_PET_ID = -1;

const ATTRIBUTE_KEYS = [
  'intelligence',
  'toughness',
  'friendliness',
  'ruggedness',
  'enthusiasm',
  'virility',
  'ferocity',
  'temperament',
] as const;

export function sharedPetToPet(shared: SharedPet): Pet {
  const attrs = shared.attributes ?? {};
  const attributeFields = Object.fromEntries(
    ATTRIBUTE_KEYS.map((k) => [k, attrs[k] ?? DEFAULT_ATTRIBUTE_VALUE]),
  ) as Record<(typeof ATTRIBUTE_KEYS)[number], number>;

  return {
    id: PREVIEW_PET_ID,
    name: shared.name,
    species: shared.species,
    gender: shared.gender,
    breed: shared.breed,
    breeder: shared.breeder,
    content_hash: shared.contentHash,
    genome_text: shared.genomeData,
    notes: shared.notes,
    tags: shared.tags,
    created_at: '',
    updated_at: '',
    ...attributeFields,
    positive_genes: 0,
    starred: false,
    stabled: false,
    is_pet_quality: false,
  };
}
