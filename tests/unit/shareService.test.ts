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
interface BatchCall {
  ref: { col?: string; path?: string; id?: string; __db?: unknown };
  payload: Record<string, unknown>;
}
const batchCalls: BatchCall[][] = [];
function createBatch() {
  const calls: BatchCall[] = [];
  batchCalls.push(calls);
  const commit = vi.fn().mockResolvedValue(undefined);
  return {
    set: (ref: BatchCall['ref'], payload: BatchCall['payload']) => calls.push({ ref, payload }),
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
  getPetGenomeText: vi.fn(),
  updatePet: vi.fn(),
  uploadPet: vi.fn(),
}));

import { getDoc, getDocs, orderBy, startAfter, Timestamp, writeBatch } from 'firebase/firestore';
import { findPetByHash, getPet, updatePet, uploadPet as uploadPetLocally } from '$lib/services/petService.js';
import type { UploadResult } from '$lib/services/shareService.js';
import {
  getSharedPet,
  importCommunityPet,
  listPets,
  sanitizeTags,
  uploadPet,
  uploadPets,
  verifySharedPet,
} from '$lib/services/shareService.js';
import { Gender, type Pet, type SharedPet } from '$lib/types/index.js';
import { sha256Hex } from '$lib/utils/hash.js';
import { makePet, DEFAULT_RAW_TEXT as RAW_TEXT, DEFAULT_RAW_TEXT_HASH as RAW_TEXT_HASH } from '../fixtures/sharePet.js';

// The Firestore SDK and petService are mocked above; `vi.mocked` re-types each
// import as its mock so the `.mock*` helpers are visible to the type-checker.
const writeBatchMock = vi.mocked(writeBatch);
const getDocMock = vi.mocked(getDoc);
const getDocsMock = vi.mocked(getDocs);
const startAfterMock = vi.mocked(startAfter);
const findPetByHashMock = vi.mocked(findPetByHash);
const getPetMock = vi.mocked(getPet);
const updatePetMock = vi.mocked(updatePet);
const uploadPetLocallyMock = vi.mocked(uploadPetLocally);

/**
 * `importCommunityPet` returns a discriminated union; the tests assert on the
 * concrete branch they exercise, so widen to the superset of fields here
 * rather than narrowing the union at every access site.
 */
type ImportResultLike = { status: string; message: string; pet_id?: number; tags?: string[] };

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
  findPetByHashMock.mockReset();
  getPetMock.mockReset();
  updatePetMock.mockReset();
  uploadPetLocallyMock.mockReset();
  batchCalls.length = 0;
});

function lastBatch(): BatchCall[] {
  const batch = batchCalls.at(-1);
  if (!batch) throw new Error('no batch recorded');
  return batch;
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
    if (!meta || !genome) throw new Error('expected meta and genome batch entries');

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

  it('returns already-shared when both metadata and genome docs exist and the on-wire genome hashes correctly', async () => {
    const batch = createBatch();
    writeBatchMock.mockReturnValueOnce(batch as unknown as ReturnType<typeof writeBatch>);
    batch.commit.mockRejectedValueOnce(Object.assign(new Error('PERMISSION_DENIED'), { code: 'permission-denied' }));
    // Recheck reads BOTH halves in parallel — must mock both, AND the
    // genome doc must carry `genomeData` that hashes to the
    // content_hash so the new integrity-recheck path passes.
    getDocMock.mockResolvedValueOnce({ exists: () => true, data: () => ({}) } as never); // meta
    getDocMock.mockResolvedValueOnce({ exists: () => true, data: () => ({ genomeData: RAW_TEXT }) } as never);

    const result = await uploadPet(makePet());
    expect(result.status).toBe('already-shared');
    expect(result.contentHash).toBe(RAW_TEXT_HASH);
  });

  it('rejects on duplicate recheck when the catalogue genome doc is missing its genomeData field', async () => {
    // A doc that exists but doesn't carry a `genomeData` string is
    // structurally invalid (rules require it on create, but admin /
    // schema-migrating writes can bypass that). Surface explicitly
    // rather than masking as already-shared.
    const batch = createBatch();
    writeBatchMock.mockReturnValueOnce(batch as unknown as ReturnType<typeof writeBatch>);
    batch.commit.mockRejectedValueOnce(Object.assign(new Error('PERMISSION_DENIED'), { code: 'permission-denied' }));
    getDocMock.mockResolvedValueOnce({ exists: () => true, data: () => ({}) } as never);
    getDocMock.mockResolvedValueOnce({ exists: () => true, data: () => ({}) } as never); // no genomeData
    await expect(uploadPet(makePet())).rejects.toThrow(/missing a genomeData field/);
  });

  it('rejects on duplicate recheck when the on-wire genome does not hash to the content_hash', async () => {
    // Detects a corrupt / squatted catalogue entry: the genome blob
    // on the wire doesn't match the doc ID hash, so every importer's
    // `verifySharedPet` would reject the row. Block the legitimate
    // uploader from getting a misleading already-shared response.
    const batch = createBatch();
    writeBatchMock.mockReturnValueOnce(batch as unknown as ReturnType<typeof writeBatch>);
    batch.commit.mockRejectedValueOnce(Object.assign(new Error('PERMISSION_DENIED'), { code: 'permission-denied' }));
    getDocMock.mockResolvedValueOnce({ exists: () => true, data: () => ({}) } as never);
    getDocMock.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ genomeData: 'TAMPERED — not the raw text whose sha256 matches content_hash' }),
    } as never);
    await expect(uploadPet(makePet())).rejects.toThrow(/corrupt/);
  });

  it('re-throws the permission-denied when neither half exists (rules misconfig, not a duplicate)', async () => {
    const batch = createBatch();
    writeBatchMock.mockReturnValueOnce(batch as unknown as ReturnType<typeof writeBatch>);
    batch.commit.mockRejectedValueOnce(Object.assign(new Error('PERMISSION_DENIED'), { code: 'permission-denied' }));
    getDocMock.mockResolvedValueOnce({ exists: () => false } as never);
    getDocMock.mockResolvedValueOnce({ exists: () => false } as never);
    await expect(uploadPet(makePet())).rejects.toThrow(/PERMISSION_DENIED/);
  });

  it('rejects half-published state when /pets exists but /genomes does not', async () => {
    // Catching this here keeps a catalogue row from appearing in
    // listPets that no importer can ever load (the genome doc is
    // missing). Surfacing as an error gives the user actionable
    // signal and lets ops repair before more entries pile up.
    const batch = createBatch();
    writeBatchMock.mockReturnValueOnce(batch as unknown as ReturnType<typeof writeBatch>);
    batch.commit.mockRejectedValueOnce(Object.assign(new Error('PERMISSION_DENIED'), { code: 'permission-denied' }));
    getDocMock.mockResolvedValueOnce({ exists: () => true } as never); // meta
    getDocMock.mockResolvedValueOnce({ exists: () => false } as never); // genome missing
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
    getDocsMock.mockResolvedValueOnce({ docs: [lastSnap] } as never);

    const { pets, cursor } = await listPets();

    expect(orderBy).toHaveBeenCalledWith('uploadedAt', 'desc');
    const lastQuery = getDocsMock.mock.calls.at(-1)?.[0] as unknown as { constraints: { __op: string; n?: number }[] };
    expect(lastQuery.constraints.some((c) => c.__op === 'limit' && c.n === 50)).toBe(true);
    expect(pets).toHaveLength(1);
    expect(pets[0].genomeData).toBeUndefined();
    expect(pets[0].name).toBe('Buzz');
    // Cursor is the underlying snapshot — opaque to callers.
    expect(cursor).toBe(lastSnap);
  });

  it('returns a null cursor when the page is empty', async () => {
    getDocsMock.mockResolvedValueOnce({ docs: [] } as never);
    const { pets, cursor } = await listPets();
    expect(pets).toEqual([]);
    expect(cursor).toBeNull();
  });

  it('passes the opaque cursor through startAfter unchanged', async () => {
    getDocsMock.mockResolvedValueOnce({ docs: [] } as never);
    const opaqueCursor = { __isSnapshot: true, id: 'whatever' };
    await listPets({ after: opaqueCursor });

    expect(startAfter).toHaveBeenCalledTimes(1);
    expect(startAfterMock.mock.calls[0][0]).toBe(opaqueCursor);
  });
});

describe('shareService.getSharedPet', () => {
  it('returns null when the metadata doc is missing', async () => {
    getDocMock
      .mockResolvedValueOnce({ exists: () => false } as never)
      .mockResolvedValueOnce({ exists: () => true, data: () => ({ genomeData: 'orphan' }) } as never);
    expect(await getSharedPet(RAW_TEXT_HASH)).toBeNull();
  });

  it('combines /pets and /genomes reads into a single SharedPet with genomeData', async () => {
    getDocMock
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
      } as never)
      .mockResolvedValueOnce({
        exists: () => true,
        data: () => ({ genomeData: 'GENOME-BODY' }),
      } as never);
    const pet = await getSharedPet(RAW_TEXT_HASH);
    expect(pet).toMatchObject({
      contentHash: RAW_TEXT_HASH,
      name: 'Buzz',
      tags: ['ok', 'fine'],
      genomeData: 'GENOME-BODY',
    });
    expect(pet).not.toBeNull();
    if (!pet) throw new Error('expected pet');
    expect(pet.uploadedAt).toBeInstanceOf(Date);
    expect(pet.uploadedAt.toISOString()).toBe('2026-05-10T12:00:00.000Z');
  });

  it('returns the pet with genomeData=undefined when the genome doc is missing', async () => {
    getDocMock
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
      } as never)
      .mockResolvedValueOnce({ exists: () => false } as never);
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
    await expect(verifySharedPet(pet as unknown as SharedPet)).resolves.toBeUndefined();
  });

  it('throws when the hash does not match the data', async () => {
    const pet = {
      contentHash: 'f'.repeat(64),
      genomeData: '[Overview]\nEntity=Tampered\n[Genes]\n',
    };
    await expect(verifySharedPet(pet as unknown as SharedPet)).rejects.toThrow(/hash mismatch/);
  });

  it('throws when genomeData is missing entirely', async () => {
    await expect(verifySharedPet({ contentHash: RAW_TEXT_HASH } as unknown as SharedPet)).rejects.toThrow(/missing/);
  });
});

describe('shareService.importCommunityPet', () => {
  async function makeShared(seed = 'A'): Promise<SharedPet> {
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
    uploadPetLocallyMock.mockResolvedValueOnce({
      status: 'success',
      kind: 'created',
      message: '',
      pet_id: 42,
      name: shared.name,
    });
    updatePetMock.mockResolvedValueOnce(true);

    const result = (await importCommunityPet(shared)) as ImportResultLike;

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
    uploadPetLocallyMock.mockResolvedValueOnce({
      status: 'success',
      kind: 'created',
      message: '',
      pet_id: 7,
      name: shared.name,
    });
    updatePetMock.mockResolvedValueOnce(true);

    const result = (await importCommunityPet(shared, { tag: 'imported' })) as ImportResultLike;

    expect(result.tags?.[0]).toBe('imported');
    // `toHaveBeenCalledWith` rather than `toHaveBeenLastCalledWith`:
    // a fresh import also calls `updatePet` to apply shared metadata
    // (name/breed/gender), so the last call isn't the tag write.
    expect(updatePet).toHaveBeenCalledWith(7, { tags: ['imported', 'fast', 'fierce'] });
  });

  it('treats a legacy backfill as already-imported and still applies the community tag', async () => {
    // petService.uploadPet returns kind:'backfilled' when the user had a
    // local pet with the same content_hash but empty genome_text — see
    // migration v13. The community import should still tag it.
    const shared = await makeShared('BF');
    uploadPetLocallyMock.mockResolvedValueOnce({
      status: 'success',
      kind: 'backfilled',
      message: 'Filled missing raw genome data',
      pet_id: 5,
      name: 'LegacyName',
    });
    updatePetMock.mockResolvedValueOnce(true);

    const result = (await importCommunityPet(shared)) as ImportResultLike;

    expect(result.status).toBe('already-imported');
    expect(result.pet_id).toBe(5);
    expect(result.message).toMatch(/LegacyName/);
    expect(result.message).toMatch(/tagged/i);
    // Tag IS applied even on the backfill path.
    expect(updatePet).toHaveBeenCalledWith(5, { tags: ['community', 'fast', 'fierce'] });
  });

  it('returns already-imported on duplicate-error from petService (race-recovery)', async () => {
    const shared = await makeShared('Z');
    uploadPetLocallyMock.mockResolvedValueOnce({
      status: 'error',
      message: "This file has already been uploaded as 'OldName' on …",
    });
    findPetByHashMock.mockResolvedValueOnce({
      id: 99,
      name: 'OldName',
      content_hash: shared.contentHash,
      tags: ['favourite'],
    } as never);
    updatePetMock.mockResolvedValueOnce(true);

    const result = (await importCommunityPet(shared)) as ImportResultLike;

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
    uploadPetLocallyMock.mockResolvedValueOnce({
      status: 'success',
      kind: 'backfilled',
      message: 'Filled missing raw genome data',
      pet_id: 11,
      name: 'LegacyName',
    });
    // Backfill path looks up tags via `getPet(pet_id)` so a parallel
    // delete-then-reinsert under the same content_hash can't return a
    // sibling row's tags. `findPetByHash` is NOT called on this branch.
    getPetMock.mockResolvedValueOnce({
      id: 11,
      name: 'LegacyName',
      content_hash: shared.contentHash,
      tags: ['favourite', 'wip'],
    } as never);
    updatePetMock.mockResolvedValueOnce(true);

    const result = (await importCommunityPet(shared)) as ImportResultLike;

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
    uploadPetLocallyMock.mockResolvedValueOnce({
      status: 'success',
      kind: 'backfilled',
      message: 'Filled missing raw genome data',
      pet_id: 99,
      name: 'GhostName',
    });
    getPetMock.mockResolvedValueOnce(null);
    updatePetMock.mockResolvedValueOnce(false);

    const result = (await importCommunityPet(shared)) as ImportResultLike;

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
    uploadPetLocallyMock.mockResolvedValueOnce({
      status: 'success',
      kind: 'created',
      message: '',
      pet_id: 31,
      name: shared.name,
    });
    updatePetMock.mockResolvedValueOnce(false);

    const result = (await importCommunityPet(shared)) as ImportResultLike;

    expect(result.status).toBe('imported');
    expect(result.tags).toEqual([]);
    expect(result.message).toMatch(/local tag couldn't be saved/i);
  });

  it('applies shared metadata (name / breed / gender) after a fresh import', async () => {
    // The local insert path re-parses the raw genome and uses the
    // genome's Entity-derived name + parsed breed — NOT the
    // catalogue-displayed metadata. Without an explicit override, a
    // community pet whose uploader renamed it (or edited breed) would
    // import under the original parsed values, leaving user B looking
    // at a different name than the catalogue preview they clicked.
    const shared = await makeShared('META');
    shared.name = 'CustomName';
    shared.breed = 'Kurbone';
    shared.gender = Gender.MALE;
    uploadPetLocallyMock.mockResolvedValueOnce({
      status: 'success',
      kind: 'created',
      message: '',
      pet_id: 55,
      name: shared.name,
    });
    updatePetMock.mockResolvedValue(true);

    const result = (await importCommunityPet(shared)) as ImportResultLike;

    expect(result.status).toBe('imported');
    expect(updatePet).toHaveBeenCalledWith(55, {
      name: 'CustomName',
      breed: 'Kurbone',
      gender: Gender.MALE,
    });
  });

  it('does NOT override metadata on a backfilled import (preserves user edits)', async () => {
    // The backfilled row pre-existed; the user may have edited
    // name/breed/gender locally, and those edits are authoritative.
    // Only fresh imports inherit the shared metadata.
    const shared = await makeShared('NOOVR');
    shared.name = 'PublishedName';
    shared.breed = 'SomeBreed';
    uploadPetLocallyMock.mockResolvedValueOnce({
      status: 'success',
      kind: 'backfilled',
      message: '',
      pet_id: 56,
      name: 'PublishedName',
    });
    getPetMock.mockResolvedValueOnce({ id: 56, tags: [] } as never);
    updatePetMock.mockResolvedValue(true);

    await importCommunityPet(shared);

    // Only the tag write should have happened — no name/breed/gender
    // overwrite on the backfill path.
    expect(updatePet).not.toHaveBeenCalledWith(56, expect.objectContaining({ name: expect.any(String) }));
    expect(updatePet).not.toHaveBeenCalledWith(56, expect.objectContaining({ breed: expect.any(String) }));
  });

  it('preserves all pre-existing user tags on backfill even past the 30-tag wire cap', async () => {
    // sanitizeTags caps merged lists at 30 for the wire format. Using
    // it for the local-row merge would drop user-applied tags when
    // existing.length + 1 exceeds 30 — e.g., a pet with 30 user tags
    // would lose one when the community tag is prepended. The local
    // merge must use the count-cap-free helper instead.
    const shared = await makeShared('CAP');
    shared.tags = []; // simplify: only the community tag is prepended
    const existing30 = Array.from({ length: 30 }, (_, i) => `user-tag-${i}`);
    uploadPetLocallyMock.mockResolvedValueOnce({
      status: 'success',
      kind: 'backfilled',
      message: '',
      pet_id: 71,
      name: 'BigTagPet',
    });
    getPetMock.mockResolvedValueOnce({ id: 71, tags: existing30 } as never);
    updatePetMock.mockResolvedValue(true);

    await importCommunityPet(shared);

    const tagCall = updatePetMock.mock.calls.find(([id, payload]) => id === 71 && Array.isArray(payload?.tags));
    expect(tagCall).toBeDefined();
    if (!tagCall) throw new Error('expected tag write');
    const writtenTags = tagCall[1].tags as string[];
    expect(writtenTags).toHaveLength(31);
    // Community tag first, then every user tag — none dropped.
    expect(writtenTags[0]).toBe('community');
    for (const t of existing30) {
      expect(writtenTags).toContain(t);
    }
  });

  it('normalises tags case + whitespace before merging (matches DB-side normalisation)', async () => {
    // `petService.setTagsForPet` does `trim().toLowerCase()` before
    // INSERT. The import flow's local merge must mirror that
    // normalisation BEFORE the dedupe check — otherwise
    // `result.tags` returns both 'Fast' and 'fast' while the DB
    // collapses them, and the caller sees a tag list that disagrees
    // with what was actually stored.
    const shared = await makeShared('NORM');
    shared.tags = ['Fast', '  FIERCE  ', 'fast']; // mixed case + whitespace + duplicate-after-normalise
    uploadPetLocallyMock.mockResolvedValueOnce({
      status: 'success',
      kind: 'created',
      message: '',
      pet_id: 81,
      name: shared.name,
    });
    updatePetMock.mockResolvedValue(true);

    const result = (await importCommunityPet(shared)) as ImportResultLike;

    expect(result.status).toBe('imported');
    // Result.tags must reflect what setTagsForPet will store: lowercased,
    // trimmed, deduped. 'Fast' / 'fast' collapse to one 'fast'.
    expect(result.tags).toEqual(['community', 'fast', 'fierce']);
    // The local merge call to updatePet receives the same normalised
    // form, so a re-read of pet_tags would agree byte-for-byte.
    expect(updatePet).toHaveBeenCalledWith(81, { tags: ['community', 'fast', 'fierce'] });
  });

  it('preserves a user-owned long tag (> wire 64-char cap) on a backfill merge', async () => {
    // `pet_tags.tag` has no length constraint and
    // `petService.setTagsForPet` doesn't enforce one either. The wire
    // 64-char cap belongs in `sanitizeTags` for the publish path —
    // applying it to the local-row merge would silently delete a
    // user's pre-existing long tag when a community pet imports
    // onto an existing row.
    const shared = await makeShared('LONGTAG');
    shared.tags = [];
    const longTag = 'a'.repeat(120); // well over the 64-char wire cap
    uploadPetLocallyMock.mockResolvedValueOnce({
      status: 'success',
      kind: 'backfilled',
      message: '',
      pet_id: 91,
      name: 'BigTagPet',
    });
    getPetMock.mockResolvedValueOnce({ id: 91, tags: ['favourite', longTag] } as never);
    updatePetMock.mockResolvedValue(true);

    await importCommunityPet(shared);

    const tagCall = updatePetMock.mock.calls.find(([id, payload]) => id === 91 && Array.isArray(payload?.tags));
    expect(tagCall).toBeDefined();
    if (!tagCall) throw new Error('expected tag write');
    const writtenTags = tagCall[1].tags as string[];
    expect(writtenTags).toContain(longTag);
    expect(writtenTags).toContain('favourite');
    expect(writtenTags).toContain('community');
  });

  it('race-recovery surfaces tag-write failure in the message', async () => {
    // When the upload failed as duplicate and `findPetByHash` recovered
    // a pre-existing row, the community tag is best-effort. A failed
    // tag write must surface in the message rather than silently
    // claiming "already in your stable" with no caveat.
    const shared = await makeShared('RT');
    uploadPetLocallyMock.mockResolvedValueOnce({
      status: 'error',
      message: "This file has already been uploaded as 'OldName' on …",
    });
    findPetByHashMock.mockResolvedValueOnce({
      id: 88,
      name: 'OldName',
      content_hash: shared.contentHash,
      tags: ['favourite'],
    } as never);
    updatePetMock.mockRejectedValueOnce(new Error('disk full'));

    const result = (await importCommunityPet(shared)) as ImportResultLike;

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
    uploadPetLocallyMock.mockResolvedValueOnce({
      status: 'success',
      kind: 'created',
      message: '',
      pet_id: 21,
      name: shared.name,
    });
    updatePetMock.mockRejectedValueOnce(new Error('disk full'));

    const result = (await importCommunityPet(shared)) as ImportResultLike;

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
    uploadPetLocallyMock.mockResolvedValueOnce({ status: 'error', message: 'Invalid genome file format' });
    findPetByHashMock.mockResolvedValueOnce(null);

    const result = (await importCommunityPet(shared)) as ImportResultLike;

    expect(result.status).toBe('error');
    expect(result.message).toMatch(/Invalid genome file format/);
    expect(updatePet).not.toHaveBeenCalled();
  });
});

describe('shareService.uploadPets', () => {
  // uploadPets is exercised through its injectable `upload` / `loadGenomeText`
  // seams so these stay pure — no Firestore, no real petService.
  const pet = (id: number, over: Record<string, unknown> = {}) =>
    ({ id, name: `Pet ${id}`, genome_text: `genome-${id}`, content_hash: `h${id}`, ...over }) as unknown as Pet;

  function fakeUpload(byHash: Record<string, UploadResult['status'] | 'throw'>) {
    return vi.fn(async (p: Pet): Promise<UploadResult> => {
      const outcome = byHash[p.content_hash ?? ''] ?? 'created';
      if (outcome === 'throw') throw new Error(`network failure for ${p.content_hash}`);
      return { status: outcome, contentHash: p.content_hash ?? '' };
    });
  }

  it('partitions outcomes into created / already-shared / skipped / failed', async () => {
    const pets = [pet(1), pet(2), pet(3, { genome_text: null }), pet(4)];
    const upload = fakeUpload({ h1: 'created', h2: 'already-shared', h4: 'throw' });
    // Pet 3 has no in-memory genome_text and the loader also returns null → skipped.
    const loadGenomeText = vi.fn().mockResolvedValue(null);

    const summary = await uploadPets(pets, { upload, loadGenomeText });

    expect(summary.created).toBe(1);
    expect(summary.alreadyShared).toBe(1);
    expect(summary.skipped).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.items.map((i) => i.status)).toEqual(['created', 'already-shared', 'skipped', 'failed']);
    // A single failure never aborts the batch — pet 4 was still attempted.
    expect(upload).toHaveBeenCalledTimes(3); // pets 1, 2, 4 (3 was skipped before upload)
    expect(summary.items[3].error).toMatch(/network failure/);
  });

  it('reports progress once per pet, in order', async () => {
    const pets = [pet(1), pet(2), pet(3)];
    const onProgress = vi.fn();
    await uploadPets(pets, { upload: fakeUpload({}), loadGenomeText: vi.fn(), onProgress });
    expect(onProgress.mock.calls).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
  });

  it('lazy-loads genome_text only when the pet lacks it', async () => {
    const pets = [pet(1, { genome_text: 'inline' }), pet(2, { genome_text: undefined })];
    const upload = fakeUpload({});
    const loadGenomeText = vi.fn().mockResolvedValue('loaded-text');

    await uploadPets(pets, { upload, loadGenomeText });

    // Pet 1 carried its text; only pet 2 triggers a load.
    expect(loadGenomeText).toHaveBeenCalledTimes(1);
    expect(loadGenomeText).toHaveBeenCalledWith(2);
    expect(upload.mock.calls[0][0].genome_text).toBe('inline');
    expect(upload.mock.calls[1][0].genome_text).toBe('loaded-text');
  });

  it('stops early when shouldCancel returns true', async () => {
    const pets = [pet(1), pet(2), pet(3)];
    const upload = fakeUpload({});
    let calls = 0;
    const shouldCancel = () => ++calls > 2; // allow pets 1 and 2, cancel before 3

    const summary = await uploadPets(pets, { upload, loadGenomeText: vi.fn(), shouldCancel });

    expect(summary.items).toHaveLength(2);
    expect(upload).toHaveBeenCalledTimes(2);
  });
});
