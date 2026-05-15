/**
 * Unit tests for shareService — mocks the Firestore SDK so we can assert
 * payload shape and on-read normalisation without the emulator. The
 * emulator round-trip and rule predicates live in
 * tests/integration/shareService.emulator.test.js.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  // The per-mock `mockResolvedValueOnce` calls are consumed in order, but
  // the call-history is not — without resetting it, "not.toHaveBeenCalled"
  // assertions leak across tests in this file.
  vi.clearAllMocks();
});

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
  setTagsForPet: vi.fn(),
  uploadPet: vi.fn(),
}));

import { getDoc, getDocs, orderBy, startAfter, Timestamp, writeBatch } from 'firebase/firestore';
import { findPetByHash, setTagsForPet, uploadPet as uploadPetLocally } from '$lib/services/petService.js';
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
  batchCalls.length = 0;
});

function lastBatch() {
  return batchCalls.at(-1);
}

function makePet(overrides = {}) {
  // Production-shape, except `content_hash` is a fixed placeholder rather
  // than the actual SHA-256 of `rawText` — the mocked Firestore SDK
  // never round-trips through the hash check, so a placeholder is fine
  // here. Tests that need a genuine hash/raw-text agreement live in the
  // emulator suite and use `freshPet` which computes the real digest.
  const rawText = '[Overview]\nCharacter=PlayerOne\nEntity=Buzz\n[Genes]\n';
  return {
    id: 1,
    name: 'Buzz',
    species: 'BeeWasp',
    gender: Gender.FEMALE,
    breed: '',
    breeder: 'PlayerOne',
    content_hash: 'a'.repeat(64),
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

  it('returns already-shared when the rules reject create and the metadata doc exists', async () => {
    const batch = createBatch();
    writeBatch.mockReturnValueOnce(batch);
    batch.commit.mockRejectedValueOnce(Object.assign(new Error('PERMISSION_DENIED'), { code: 'permission-denied' }));
    getDoc.mockResolvedValueOnce({ exists: () => true });

    const result = await uploadPet(makePet());
    expect(result.status).toBe('already-shared');
    expect(result.contentHash).toBe('a'.repeat(64));
  });

  it('re-throws permission-denied if the metadata doc does not actually exist', async () => {
    const batch = createBatch();
    writeBatch.mockReturnValueOnce(batch);
    batch.commit.mockRejectedValueOnce(Object.assign(new Error('PERMISSION_DENIED'), { code: 'permission-denied' }));
    getDoc.mockResolvedValueOnce({ exists: () => false });
    await expect(uploadPet(makePet())).rejects.toThrow(/PERMISSION_DENIED/);
  });

  it('rejects when content_hash is missing', async () => {
    await expect(uploadPet(makePet({ content_hash: '' }))).rejects.toThrow(/content_hash/);
    expect(writeBatch).not.toHaveBeenCalled();
  });
});

describe('shareService.listPets', () => {
  it('asks for newest-first with the default page size, returns metadata-only pets + cursor', async () => {
    const lastSnap = {
      id: 'a'.repeat(64),
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
    expect(await getSharedPet('a'.repeat(64))).toBeNull();
  });

  it('combines /pets and /genomes reads into a single SharedPet with genomeData', async () => {
    getDoc
      .mockResolvedValueOnce({
        exists: () => true,
        id: 'a'.repeat(64),
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
    const pet = await getSharedPet('a'.repeat(64));
    expect(pet).toMatchObject({
      contentHash: 'a'.repeat(64),
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
        id: 'a'.repeat(64),
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
    const pet = await getSharedPet('a'.repeat(64));
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
    await expect(verifySharedPet({ contentHash: 'a'.repeat(64) })).rejects.toThrow(/missing/);
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

  it('verifies hash, uploads to local DB, applies the community tag', async () => {
    const shared = await makeShared('X');
    findPetByHash.mockResolvedValueOnce(null);
    uploadPetLocally.mockResolvedValueOnce({ status: 'success', message: '', pet_id: 42 });
    setTagsForPet.mockResolvedValueOnce(undefined);

    const result = await importCommunityPet(shared);

    expect(result.status).toBe('imported');
    expect(result.pet_id).toBe(42);
    expect(result.tags).toEqual(['community', 'fast', 'fierce']);
    expect(uploadPetLocally).toHaveBeenCalledWith(shared.genomeData, expect.objectContaining({ name: shared.name }));
    expect(setTagsForPet).toHaveBeenCalledWith(42, ['community', 'fast', 'fierce']);
  });

  it('honours a custom tag label override', async () => {
    const shared = await makeShared('Y');
    findPetByHash.mockResolvedValueOnce(null);
    uploadPetLocally.mockResolvedValueOnce({ status: 'success', message: '', pet_id: 7 });
    setTagsForPet.mockResolvedValueOnce(undefined);

    const result = await importCommunityPet(shared, { tag: 'imported' });

    expect(result.tags?.[0]).toBe('imported');
    expect(setTagsForPet).toHaveBeenLastCalledWith(7, ['imported', 'fast', 'fierce']);
  });

  it('returns already-imported when the local DB already has the same hash', async () => {
    const shared = await makeShared('Z');
    findPetByHash.mockResolvedValueOnce({ id: 99, name: 'OldName', content_hash: shared.contentHash });

    const result = await importCommunityPet(shared);

    expect(result.status).toBe('already-imported');
    expect(result.pet_id).toBe(99);
    expect(uploadPetLocally).not.toHaveBeenCalled();
    expect(setTagsForPet).not.toHaveBeenCalled();
  });

  it('rejects when the genome does not hash to contentHash', async () => {
    const shared = await makeShared('W');
    shared.contentHash = 'f'.repeat(64);
    await expect(importCommunityPet(shared)).rejects.toThrow(/hash mismatch/);
    expect(findPetByHash).not.toHaveBeenCalled();
  });

  it('rejects when genomeData is missing (caller forgot to fetch full pet)', async () => {
    const shared = await makeShared('M');
    shared.genomeData = undefined;
    await expect(importCommunityPet(shared)).rejects.toThrow(/missing/);
    expect(findPetByHash).not.toHaveBeenCalled();
  });

  it('surfaces error from the local upload without setting tags', async () => {
    const shared = await makeShared('V');
    findPetByHash.mockResolvedValueOnce(null);
    uploadPetLocally.mockResolvedValueOnce({ status: 'error', message: 'Invalid genome file format' });

    const result = await importCommunityPet(shared);

    expect(result.status).toBe('error');
    expect(result.message).toMatch(/Invalid genome file format/);
    expect(setTagsForPet).not.toHaveBeenCalled();
  });
});
