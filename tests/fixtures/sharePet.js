/**
 * Shared local-Pet fixtures for the share-service test surface (#255).
 *
 * Previously two `makePet` factories had drifted across the unit
 * (`shareService.test.js`) and emulator (`shareService.emulator.test.js`)
 * suites — different signatures, one with a placeholder content_hash and
 * one computing the real digest. This is the single source of truth.
 *
 * `uploadPet` re-hashes `genome_text` and rejects rows whose stored
 * `content_hash` doesn't match, so the default fixture is a coherent pair
 * (`content_hash === sha256(genome_text)`). The hash is precomputed at module
 * load via top-level await so `makePet` stays synchronous for test bodies.
 */
import { Gender } from '$lib/types/index.js';
import { sha256Hex } from '$lib/utils/hash.js';

/** Canonical raw gene-report text and its real SHA-256. */
export const DEFAULT_RAW_TEXT = '[Overview]\nCharacter=PlayerOne\nEntity=Buzz\n[Genes]\n';
export const DEFAULT_RAW_TEXT_HASH = await sha256Hex(DEFAULT_RAW_TEXT);

/**
 * Production-shape local `Pet`. Defaults to a coherent
 * (`content_hash === sha256(genome_text)`) row built from `DEFAULT_RAW_TEXT`.
 *
 * @param {object} [opts]
 * @param {string} [opts.rawText]      genome text (defaults to DEFAULT_RAW_TEXT)
 * @param {string} [opts.contentHash]  explicit hash; defaults to the digest of
 *   `DEFAULT_RAW_TEXT` when `rawText` is the default, else `''` (use `freshPet`
 *   for a real digest of arbitrary text — hashing is async)
 * @param {object} [opts.overrides]    any further field overrides (snake_case,
 *   e.g. `{ content_hash: '' }` or `{ genome_text: '' }`), applied last
 */
export function makePet({ rawText = DEFAULT_RAW_TEXT, contentHash, ...overrides } = {}) {
  return {
    id: 1,
    name: 'Buzz',
    species: 'BeeWasp',
    gender: Gender.FEMALE,
    breed: '',
    breeder: 'PlayerOne',
    content_hash: contentHash ?? (rawText === DEFAULT_RAW_TEXT ? DEFAULT_RAW_TEXT_HASH : ''),
    genome_data: JSON.stringify({ name: 'Buzz', breeder: 'PlayerOne', genes: {} }),
    genome_text: rawText,
    notes: '',
    tags: ['fast', 'fierce'],
    created_at: '2026-05-01T00:00:00Z',
    updated_at: '2026-05-01T00:00:00Z',
    intelligence: 50,
    toughness: 50,
    friendliness: 50,
    ruggedness: 50,
    enthusiasm: 50,
    virility: 50,
    ferocity: 50,
    temperament: 0,
    positive_genes: 0,
    starred: false,
    stabled: false,
    is_pet_quality: false,
    ...overrides,
  };
}

/**
 * A coherent Pet whose `content_hash` is the real SHA-256 of a seed-derived
 * genome text — distinct seeds yield distinct hashes, so emulator tests can
 * upload several pets without content-hash-ID collisions.
 */
export async function freshPet(seed = 'pet') {
  const rawText = `[Overview]\nCharacter=Player${seed}\nEntity=Buzz${seed}\n[Genes]\n`;
  const contentHash = await sha256Hex(rawText);
  return makePet({ rawText, contentHash, breeder: `Player${seed}` });
}
