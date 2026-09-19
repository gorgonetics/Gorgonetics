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

/**
 * The eight published attribute columns, in wire order. Single source of truth
 * shared by the upload payload (shareService), the read adapter (this module),
 * and the community table columns (CommunityPetTable) so they can't drift.
 */
export const ATTRIBUTE_KEYS = [
  'intelligence',
  'toughness',
  'friendliness',
  'ruggedness',
  'enthusiasm',
  'virility',
  'ferocity',
  'temperament',
] as const;

/**
 * Resolve a catalogue entry's identity from its FIRST-share doc. The
 * catalogue is add-only and reads collapse a hash to its latest entry —
 * but only attributes/tags/notes are correction-eligible; the identity
 * fields (name/character/species/gender/breed/breeder) belong to the
 * first share. `firestore.rules` enforces that binding for new writes
 * (identityMatchesFirstShare); this client-side merge is defence in
 * depth for corrections that predate the rule (issue #393 — a hostile
 * "correction" could rename/re-species someone else's published pet).
 *
 * Returns `latest` with the six identity fields overwritten from `base`.
 * When `latest` IS the base entry the merge is a no-op.
 */
export function mergeCorrectionIdentity(latest: SharedPet, base: SharedPet): SharedPet {
  return {
    ...latest,
    name: base.name,
    character: base.character,
    species: base.species,
    gender: base.gender,
    breed: base.breed,
    breeder: base.breeder,
  };
}

/**
 * Collapse the add-only catalogue to one row per content hash, keeping the
 * latest. `listPets` pages newest-first, and a correction always has a later
 * `uploadedAt` than the base entry it supersedes, so the newest entry for a
 * hash is always encountered first — keep-first-seen therefore keeps the
 * latest and preserves the newest-first display order. Deduping the whole
 * accumulated list (not just each page) also catches the case where a base
 * entry and its correction straddle a page boundary.
 *
 * Identity binding (issue #393): only attributes/tags/notes are
 * correction-eligible — the identity fields (name/character/species/
 * gender/breed/breeder) belong to the first-share entry. firestore.rules
 * enforces that for new writes; this merge covers already-poisoned
 * pre-rule corrections. When the kept row is a correction and its base
 * (first-share) entry is encountered later in the accumulated list, the
 * base's identity fields overwrite the correction's. A correction whose
 * base hasn't been paged in yet is shown as-is (best effort — the detail
 * view's `getSharedPet` always fetches the base doc and re-merges).
 *
 * Accepted residual risk (review #3): a correction paged in before its base
 * shows the correction's own identity in the list. For rule-compliant docs
 * that identity equals the base's, so it's correct; only a legacy pre-rule
 * "poisoned" correction could briefly show spoofed text here, and opening it
 * re-fetches the base and corrects it. We don't fetch each orphan
 * correction's base to verify (extra reads per page against the Spark quota)
 * nor blank correction identity wholesale (it would blank legitimate
 * corrections whose base simply isn't paged in — the common case).
 */
export function dedupeLatest(pets: SharedPet[]): SharedPet[] {
  const indexByHash = new Map<string, number>();
  const out: SharedPet[] = [];
  for (const pet of pets) {
    const keptIndex = indexByHash.get(pet.contentHash);
    if (keptIndex === undefined) {
      indexByHash.set(pet.contentHash, out.length);
      out.push(pet);
    } else if (!pet.isCorrection && out[keptIndex].isCorrection) {
      out[keptIndex] = mergeCorrectionIdentity(out[keptIndex], pet);
    }
  }
  return out;
}

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
