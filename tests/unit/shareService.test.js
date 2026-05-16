/**
 * Unit tests for shareService — mocks the Firestore SDK so we can assert
 * payload shape and on-read normalisation without the emulator. The
 * emulator round-trip and rule predicates live in
 * tests/integration/shareService.emulator.test.js.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * `writeBatch(db)` returns a builder with `.set()` and `.commit()`. We
 * surface the recorded `set` calls so individual tests can assert on the
 * payloads handed to each collection.
 */
const batchCalls = [];
function createBatch() {
  const calls = [];
  batchCalls.push(calls);
  const commit = vi.fn().mockResolvedValue(undefined);
  return {
    set: (ref, payload) => calls.push({ ref, payload }),
    commit,
    __calls: calls,
    __commit: commit,
  };
}

vi.mock('firebase/firestore', async () => {
  const actual = await vi.importActual('firebase/firestore');
  return {
    ...actual,
    getDoc: vi.fn(),
    getDocs: vi.fn(),
    setDoc: vi.fn(),
    writeBatch: vi.fn(() => createBatch()),
    serverTimestamp: vi.fn(() => '__SENTINEL_SERVER_TIMESTAMP__'),
    doc: vi.fn((db, col, id) => ({ __db: db, path: `${col}/${id}`, id, col })),
    collection: vi.fn((db, col) => ({ __db: db, path: col })),
    query: vi.fn((coll, ...constraints) => ({ __coll: coll, constraints })),
    orderBy: vi.fn((field, dir) => ({ __op: 'orderBy', field, dir })),
    limit: vi.fn((n) => ({ __op: 'limit', n })),
    startAfter: vi.fn((value) => ({ __op: 'startAfter', value })),
  };
});

vi.mock('$lib/firebase.js', () => ({
  firestore: { __mock: 'firestore' },
}));

vi.mock('$lib/services/petService.js', () => ({
  findPetByHash: vi.fn(),
  getPet: vi.fn(),
  updatePet: vi.fn(),
  uploadPet: vi.fn(),
}));

import { getDoc, getDocs, orderBy, startAfter, Timestamp, writeBatch } from 'firebase/firestore';
import { findPetByHash, getPet, updatePet, uploadPet as uploadPetLocally } from '$lib/services/petService.js';
import {
  getSharedPet,
  importCommunityPet,
  listPets,
  sanitizeTags,
  uploadPet,
  verifySharedPet,
} from '$lib/services/shareService.js';
import { Gender } from '$lib/types/index.js';
import { sha256Hex } from '$lib/utils/hash.js';

afterEach(() => {
  // Clear call-history for every spy. Then individually reset the
  // petService mocks — those carry `mockResolvedValueOnce` /
  // `mockRejectedValueOnce` queues that can leak into the next test if
  // not drained (the regression that prompted swapping to resetAllMocks
  // earlier). Resetting GLOBALLY would also wipe the Firestore mock
  // factory's implementations (query/orderBy/limit/writeBatch) that
  // shareService internally relies on, leaving later tests with
  // undefined query objects.
  vi.clearAllMocks();
  findPetByHash.mockReset();
  getPet.mockReset();
  updatePet.mockReset();
  uploadPetLocally.mockReset();
  batchCalls.length = 0;
});

function lastBatch() {
  return batchCalls.at(-1);
}

// `uploadPet` re-hashes `genome_text` and rejects rows whose stored
// `content_hash` doesn't match — so makePet must produce a coherent
// fixture rather than a placeholder. Precomputed at module load via
// top-level await so test bodies stay synchronous.
const RAW_TEXT = '[Overview]\nCharacter=PlayerOne\nEntity=Buzz\n[Genes]\n';
const RAW_TEXT_HASH = await sha256Hex(RAW_TEXT);

function makePet(overrides = {}) {
  return {
    id: 1,
    name: 'Buzz',
    species: 'BeeWasp',
    gender: Gender.FEMALE,
    breed: '',
    breeder: 'PlayerOne',
    content_hash: RAW_TEXT_HASH,
    genome_data: JSON.stringify({ name: 'Buzz', breeder: 'PlayerOne', genes: {} }),
    genome_text: RAW_TEXT,
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

describe('shareService.uploadPet', () => {
  it('writes metadata + raw genome text in a single batch with no contentHash field in metadata', async () => {
    const result = await uploadPet(makePet());

    expect(result.status).toBe('created');
    expect(writeBatch).toHaveBeenCalledTimes(1);
    const batch = lastBatch();
    expect(batch).toHaveLength(2);

    const meta = batch.find((c) => c.ref.col === 'pets');
    const genome = batch.find((c) => c.ref.col === 'genomes');
    expect(meta).toBeDefined();
    expect(genome).toBeDefined();

    expect(Object.keys(meta.payload).sort()).toEqual(
      [
        'appVersion',
        'breed',
        'breeder',
        'character',
        'gender',
        'name',
        'notes',
        'schemaVersion',
        'species',
        'tags',
        'uploadedAt',
        'uploaderUid',
      ].sort(),
    );
    expect(meta.payload).not.toHaveProperty('contentHash');
    expect(meta.payload).not.toHaveProperty('content_hash');
    expect(meta.payload).not.toHaveProperty('genomeData');
    expect(meta.payload.uploaderUid).toBeNull();
    expect(meta.payload.uploadedAt).toBe('__SENTINEL_SERVER_TIMESTAMP__');

    // Genome doc gets the raw genome_text, NOT the JSON-stringified
    // genome_data. content_hash is sha256(raw text).
    expect(Object.keys(genome.payload)).toEqual(['genomeData']);
    expect(genome.payload.genomeData).toBe('[Overview]\nCharacter=PlayerOne\nEntity=Buzz\n[Genes]\n');
  });

  it('rejects legacy pets that lack raw genome_text (pre-migration v13)', async () => {
    await expect(uploadPet(makePet({ genome_text: '' }))).rejects.toThrow(/genome_text is required/);
    expect(writeBatch).not.toHaveBeenCalled();
  });

  it('returns already-shared when both metadata and genome docs exist after a denied create', async () => {
    const batch = createBatch();
    writeBatch.mockReturnValueOnce(batch);
    batch.commit.mockRejectedValueOnce(Object.assign(new Error('PERMISSION_DENIED'), { code: 'permission-denied' }));
    // Recheck reads BOTH halves in parallel — must mock both.
    getDoc.mockResolvedValueOnce({ exists: () => true });
    getDoc.mockResolvedValueOnce({ exists: () => true });

    const result = await uploadPet(makePet());
    expect(result.status).toBe('already-shared');
    expect(result.contentHash).toBe(RAW_TEXT_HASH);
  });

  it('re-throws the permission-denied when neither half exists (rules misconfig, not a duplicate)', async () => {
    const batch = createBatch();
    writeBatch.mockReturnValueOnce(batch);
    batch.commit.mockRejectedValueOnce(Object.assign(new Error('PERMISSION_DENIED'), { code: 'permission-denied' }));
    getDoc.mockResolvedValueOnce({ exists: () => false });
    getDoc.mockResolvedValueOnce({ exists: () => false });
    await expect(uploadPet(makePet())).rejects.toThrow(/PERMISSION_DENIED/);
  });

  it('rejects half-published state when /pets exists but /genomes does not', async () => {
    // Catching this here keeps a catalogue row from appearing in
    // listPets that no importer can ever load (the genome doc is
    // missing). Surfacing as an error gives the user actionable
    // signal and lets ops repair before more entries pile up.
    const batch = createBatch();
    writeBatch.mockReturnValueOnce(batch);
    batch.commit.mockRejectedValueOnce(Object.assign(new Error('PERMISSION_DENIED'), { code: 'permission-denied' }));
    getDoc.mockResolvedValueOnce({ exists: () => true }); // meta
    getDoc.mockResolvedValueOnce({ exists: () => false }); // genome missing
    await expect(uploadPet(makePet())).rejects.toThrow(/half-published/);
  });

  it('rejects local rows whose stored content_hash does not match sha256(genome_text)', async () => {
    // Defends against stale/restored/corrupt rows publishing a row
    // that would fail every importer's `verifySharedPet`.
    const broken = makePet({ content_hash: 'f'.repeat(64) });
    await expect(uploadPet(broken)).rejects.toThrow(/local row is corrupt/);
    expect(writeBatch).not.toHaveBeenCalled();
  });

  it('rejects when content_hash is missing', async () => {
    await expect(uploadPet(makePet({ content_hash: '' }))).rejects.toThrow(/content_hash/);
    expect(writeBatch).not.toHaveBeenCalled();
  });
});

describe('shareService.listPets', () => {
  it('asks for newest-first with the default page size, returns metadata-only pets + cursor', async () => {
    const lastSnap = {
      id: RAW_TEXT_HASH,
      __isSnapshot: true,
      data: () => ({
        name: 'Buzz',
        character: 'PlayerOne',
        species: 'BeeWasp',
        gender: Gender.FEMALE,
        breed: '',
        breeder: 'PlayerOne',
        notes: '',
        tags: ['fast'],
        schemaVersion: 1,
        appVersion: '0.6.3',
        uploadedAt: Timestamp.fromDate(new Date('2026-05-10T12:00:00Z')),
        uploaderUid: null,
      }),
    };
    getDocs.mockResolvedValueOnce({ docs: [lastSnap] });

    const { pets, cursor } = await listPets();

    expect(orderBy).toHaveBeenCalledWith('uploadedAt', 'desc');
    const lastQuery = getDocs.mock.calls.at(-1)?.[0];
    expect(lastQuery.constraints.some((c) => c.__op === 'limit' && c.n === 50)).toBe(true);
    expect(pets).toHaveLength(1);
    expect(pets[0].genomeData).toBeUndefined();
    expect(pets[0].name).toBe('Buzz');
    // Cursor is the underlying snapshot — opaque to callers.
    expect(cursor).toBe(lastSnap);
  });

  it('returns a null cursor when the page is empty', async () => {
    getDocs.mockResolvedValueOnce({ docs: [] });
    const { pets, cursor } = await listPets();
    expect(pets).toEqual([]);
    expect(cursor).toBeNull();
  });

  it('passes the opaque cursor through startAfter unchanged', async () => {
    getDocs.mockResolvedValueOnce({ docs: [] });
    const opaqueCursor = { __isSnapshot: true, id: 'whatever' };
    await listPets({ after: opaqueCursor });

    expect(startAfter).toHaveBeenCalledTimes(1);
    expect(startAfter.mock.calls[0][0]).toBe(opaqueCursor);
  });
});

describe('shareService.getSharedPet', () => {
  it('returns null when the metadata doc is missing', async () => {
    getDoc
      .mockResolvedValueOnce({ exists: () => false })
      .mockResolvedValueOnce({ exists: () => true, data: () => ({ genomeData: 'orphan' }) });
    expect(await getSharedPet(RAW_TEXT_HASH)).toBeNull();
  });

  it('combines /pets and /genomes reads into a single SharedPet with genomeData', async () => {
    getDoc
      .mockResolvedValueOnce({
        exists: () => true,
        id: RAW_TEXT_HASH,
        data: () => ({
          name: 'Buzz',
          character: 'PlayerOne',
          species: 'BeeWasp',
          gender: Gender.FEMALE,
          breed: '',
          breeder: 'PlayerOne',
          notes: '',
          tags: ['ok', 42, null, 'fine'],
          schemaVersion: 5,
          appVersion: '0.6.3',
          uploadedAt: Timestamp.fromDate(new Date('2026-05-10T12:00:00Z')),
          uploaderUid: null,
        }),
      })
      .mockResolvedValueOnce({
        exists: () => true,
        data: () => ({ genomeData: 'GENOME-BODY' }),
      });
    const pet = await getSharedPet(RAW_TEXT_HASH);
    expect(pet).toMatchObject({
      contentHash: RAW_TEXT_HASH,
      name: 'Buzz',
      tags: ['ok', 'fine'],
      genomeData: 'GENOME-BODY',
    });
    expect(pet.uploadedAt).toBeInstanceOf(Date);
    expect(pet.uploadedAt.toISOString()).toBe('2026-05-10T12:00:00.000Z');
  });

  it('returns the pet with genomeData=undefined when the genome doc is missing', async () => {
    getDoc
      .mockResolvedValueOnce({
        exists: () => true,
        id: RAW_TEXT_HASH,
        data: () => ({
          name: 'Buzz',
          character: 'PlayerOne',
          species: 'BeeWasp',
          gender: Gender.FEMALE,
          breed: '',
          breeder: 'PlayerOne',
          notes: '',
          tags: [],
          schemaVersion: 1,
          appVersion: '0.6.3',
          uploadedAt: Timestamp.fromDate(new Date('2026-05-10T12:00:00Z')),
          uploaderUid: null,
        }),
      })
      .mockResolvedValueOnce({ exists: () => false });
    const pet = await getSharedPet(RAW_TEXT_HASH);
    expect(pet?.genomeData).toBeUndefined();
  });
});

describe('shareService.sanitizeTags', () => {
  it('drops non-strings, dedupes, caps length and count', () => {
    expect(sanitizeTags(['ok', 42, null, undefined, { x: 1 }, 'fine'])).toEqual(['ok', 'fine']);
    expect(sanitizeTags(['a', 'a', 'b', 'a'])).toEqual(['a', 'b']);
    expect(sanitizeTags(['', 'ok', 'x'.repeat(65)])).toEqual(['ok']);
    expect(sanitizeTags(Array.from({ length: 50 }, (_, i) => `tag${i}`))).toHaveLength(30);
  });

  it('returns [] for non-arrays', () => {
    expect(sanitizeTags(undefined)).toEqual([]);
    expect(sanitizeTags(null)).toEqual([]);
    expect(sanitizeTags('a,b')).toEqual([]);
  });
});

describe('shareService.verifySharedPet', () => {
  it('passes when sha256(genomeData) matches contentHash', async () => {
    const genomeData = '[Overview]\nEntity=Bee\n[Genes]\n';
    const pet = { contentHash: await sha256Hex(genomeData), genomeData };
    await expect(verifySharedPet(pet)).resolves.toBeUndefined();
  });

  it('throws when the hash does not match the data', async () => {
    const pet = {
      contentHash: 'f'.repeat(64),
      genomeData: '[Overview]\nEntity=Tampered\n[Genes]\n',
    };
    await expect(verifySharedPet(pet)).rejects.toThrow(/hash mismatch/);
  });

  it('throws when genomeData is missing entirely', async () => {
    await expect(verifySharedPet({ contentHash: RAW_TEXT_HASH })).rejects.toThrow(/missing/);
  });
});

describe('shareService.importCommunityPet', () => {
  async function makeShared(seed = 'A') {
    const genomeData = `[Overview]\nCharacter=Player${seed}\nEntity=Buzz${seed}\n[Genes]\n`;
    return {
      contentHash: await sha256Hex(genomeData),
      name: `Buzz${seed}`,
      character: `Player${seed}`,
      species: 'BeeWasp',
      gender: Gender.FEMALE,
      breed: '',
      breeder: `Player${seed}`,
      notes: '',
      tags: ['fast', 'fierce'],
      schemaVersion: 1,
      appVersion: '0.6.3',
      genomeData,
      uploadedAt: new Date('2026-05-10T12:00:00Z'),
      uploaderUid: null,
    };
  }

  it('verifies hash, uploads to local DB, applies the community tag (fresh insert)', async () => {
    const shared = await makeShared('X');
    uploadPetLocally.mockResolvedValueOnce({
      status: 'success',
      kind: 'created',
      message: '',
      pet_id: 42,
      name: shared.name,
    });
    updatePet.mockResolvedValueOnce(true);

    const result = await importCommunityPet(shared);

    expect(result.status).toBe('imported');
    expect(result.pet_id).toBe(42);
    expect(result.tags).toEqual(['community', 'fast', 'fierce']);
    expect(uploadPetLocally).toHaveBeenCalledWith(shared.genomeData, expect.objectContaining({ name: shared.name }));
    expect(updatePet).toHaveBeenCalledWith(42, { tags: ['community', 'fast', 'fierce'] });
    // Outer findPetByHash short-circuit is gone — petService owns dedup now.
    expect(findPetByHash).not.toHaveBeenCalled();
  });

  it('honours a custom tag label override', async () => {
    const shared = await makeShared('Y');
    uploadPetLocally.mockResolvedValueOnce({
      status: 'success',
      kind: 'created',
      message: '',
      pet_id: 7,
      name: shared.name,
    });
    updatePet.mockResolvedValueOnce(true);

    const result = await importCommunityPet(shared, { tag: 'imported' });

    expect(result.tags?.[0]).toBe('imported');
    expect(updatePet).toHaveBeenLastCalledWith(7, { tags: ['imported', 'fast', 'fierce'] });
  });

  it('treats a legacy backfill as already-imported and still applies the community tag', async () => {
    // petService.uploadPet returns kind:'backfilled' when the user had a
    // local pet with the same content_hash but empty genome_text — see
    // migration v13. The community import should still tag it.
    const shared = await makeShared('BF');
    uploadPetLocally.mockResolvedValueOnce({
      status: 'success',
      kind: 'backfilled',
      message: 'Filled missing raw genome data',
      pet_id: 5,
      name: 'LegacyName',
    });
    updatePet.mockResolvedValueOnce(true);

    const result = await importCommunityPet(shared);

    expect(result.status).toBe('already-imported');
    expect(result.pet_id).toBe(5);
    expect(result.message).toMatch(/LegacyName/);
    expect(result.message).toMatch(/tagged/i);
    // Tag IS applied even on the backfill path.
    expect(updatePet).toHaveBeenCalledWith(5, { tags: ['community', 'fast', 'fierce'] });
  });

  it('returns already-imported on duplicate-error from petService (race-recovery)', async () => {
    const shared = await makeShared('Z');
    uploadPetLocally.mockResolvedValueOnce({
      status: 'error',
      message: "This file has already been uploaded as 'OldName' on …",
    });
    findPetByHash.mockResolvedValueOnce({
      id: 99,
      name: 'OldName',
      content_hash: shared.contentHash,
      tags: ['favourite'],
    });
    updatePet.mockResolvedValueOnce(true);

    const result = await importCommunityPet(shared);

    expect(result.status).toBe('already-imported');
    expect(result.pet_id).toBe(99);
    // The outer findPetByHash is gone; the inner one runs only in the
    // race-recovery branch after a failed upload.
    expect(findPetByHash).toHaveBeenCalledTimes(1);
    // The community tag must be applied to the pre-existing row so the
    // import contract holds, AND the user's pre-existing tags must be
    // preserved (no clobber).
    expect(updatePet).toHaveBeenCalledWith(99, { tags: ['community', 'favourite', 'fast', 'fierce'] });
  });

  it('preserves user tags on a backfill (merges, does not clobber)', async () => {
    // Backfill path: the local row pre-existed (e.g. user had a legacy
    // import) and already carries some user-applied tags. The community
    // import must merge with — not replace — those tags.
    const shared = await makeShared('BFM');
    uploadPetLocally.mockResolvedValueOnce({
      status: 'success',
      kind: 'backfilled',
      message: 'Filled missing raw genome data',
      pet_id: 11,
      name: 'LegacyName',
    });
    // Backfill path looks up tags via `getPet(pet_id)` so a parallel
    // delete-then-reinsert under the same content_hash can't return a
    // sibling row's tags. `findPetByHash` is NOT called on this branch.
    getPet.mockResolvedValueOnce({
      id: 11,
      name: 'LegacyName',
      content_hash: shared.contentHash,
      tags: ['favourite', 'wip'],
    });
    updatePet.mockResolvedValueOnce(true);

    const result = await importCommunityPet(shared);

    expect(result.status).toBe('already-imported');
    expect(getPet).toHaveBeenCalledWith(11);
    expect(findPetByHash).not.toHaveBeenCalled();
    expect(updatePet).toHaveBeenCalledWith(11, { tags: ['community', 'favourite', 'wip', 'fast', 'fierce'] });
  });

  it('handles a backfill where the pet was deleted between upload and tag-merge (TOCTOU)', async () => {
    // If the user nukes the legacy row in the window between
    // `uploadPetLocally` resolving with `kind: 'backfilled'` and the
    // tag-merge `getPet` call, the row is gone. `getPet` returns null,
    // existing tags fall back to [], and `updatePet` reports the UPDATE
    // affected zero rows. The result must reflect the partial-failure
    // so the user knows the local tag didn't land.
    const shared = await makeShared('TOC');
    uploadPetLocally.mockResolvedValueOnce({
      status: 'success',
      kind: 'backfilled',
      message: 'Filled missing raw genome data',
      pet_id: 99,
      name: 'GhostName',
    });
    getPet.mockResolvedValueOnce(null);
    updatePet.mockResolvedValueOnce(false);

    const result = await importCommunityPet(shared);

    expect(result.status).toBe('already-imported');
    expect(getPet).toHaveBeenCalledWith(99);
    expect(result.pet_id).toBe(99);
    // `updatePet` returning `false` (zero rows affected) must surface
    // as the partial-fail message, not as a misleading "tagged" success.
    expect(result.message).toMatch(/local tag couldn't be saved/i);
  });

  it("propagates updatePet's boolean — false resolution reflects in the result message", async () => {
    // Regression for an earlier revision that unconditionally returned
    // `true` from applyImportTags on resolution. If `updatePet` resolves
    // `false` (row not found, no rows affected), the caller must NOT
    // claim the tag landed.
    const shared = await makeShared('PB');
    uploadPetLocally.mockResolvedValueOnce({
      status: 'success',
      kind: 'created',
      message: '',
      pet_id: 31,
      name: shared.name,
    });
    updatePet.mockResolvedValueOnce(false);

    const result = await importCommunityPet(shared);

    expect(result.status).toBe('imported');
    expect(result.tags).toEqual([]);
    expect(result.message).toMatch(/local tag couldn't be saved/i);
  });

  it('race-recovery surfaces tag-write failure in the message', async () => {
    // When the upload failed as duplicate and `findPetByHash` recovered
    // a pre-existing row, the community tag is best-effort. A failed
    // tag write must surface in the message rather than silently
    // claiming "already in your stable" with no caveat.
    const shared = await makeShared('RT');
    uploadPetLocally.mockResolvedValueOnce({
      status: 'error',
      message: "This file has already been uploaded as 'OldName' on …",
    });
    findPetByHash.mockResolvedValueOnce({
      id: 88,
      name: 'OldName',
      content_hash: shared.contentHash,
      tags: ['favourite'],
    });
    updatePet.mockRejectedValueOnce(new Error('disk full'));

    const result = await importCommunityPet(shared);

    expect(result.status).toBe('already-imported');
    expect(result.pet_id).toBe(88);
    expect(result.message).toMatch(/local tag couldn't be saved/i);
  });

  it('surfaces a partial-success message when the tag write fails', async () => {
    // Tag application is best-effort — the pet is already committed,
    // so failing the whole import would just confuse the user. But the
    // result must not claim the community tag was applied when it
    // wasn't: empty tags array + a message that flags the partial.
    const shared = await makeShared('TF');
    uploadPetLocally.mockResolvedValueOnce({
      status: 'success',
      kind: 'created',
      message: '',
      pet_id: 21,
      name: shared.name,
    });
    updatePet.mockRejectedValueOnce(new Error('disk full'));

    const result = await importCommunityPet(shared);

    expect(result.status).toBe('imported');
    expect(result.pet_id).toBe(21);
    expect(result.tags).toEqual([]);
    expect(result.message).toMatch(/local tag couldn't be saved/i);
  });

  it('rejects when the genome does not hash to contentHash', async () => {
    const shared = await makeShared('W');
    shared.contentHash = 'f'.repeat(64);
    await expect(importCommunityPet(shared)).rejects.toThrow(/hash mismatch/);
    expect(uploadPetLocally).not.toHaveBeenCalled();
    expect(findPetByHash).not.toHaveBeenCalled();
  });

  it('rejects when genomeData is missing (caller forgot to fetch full pet)', async () => {
    const shared = await makeShared('M');
    shared.genomeData = undefined;
    await expect(importCommunityPet(shared)).rejects.toThrow(/missing/);
    expect(uploadPetLocally).not.toHaveBeenCalled();
  });

  it('surfaces error from the local upload without setting tags', async () => {
    const shared = await makeShared('V');
    uploadPetLocally.mockResolvedValueOnce({ status: 'error', message: 'Invalid genome file format' });
    findPetByHash.mockResolvedValueOnce(null);

    const result = await importCommunityPet(shared);

    expect(result.status).toBe('error');
    expect(result.message).toMatch(/Invalid genome file format/);
    expect(updatePet).not.toHaveBeenCalled();
  });
});
