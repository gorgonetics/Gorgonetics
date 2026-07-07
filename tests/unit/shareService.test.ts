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
    // Default to "nothing published yet": a bare `getDoc`/`getDocs` reads as
    // absent so the first-share path runs without per-test wiring. Tests that
    // exercise already-shared / correction / recheck paths override with
    // `mockResolvedValueOnce` (consumed before the default).
    getDoc: vi.fn(async () => ({ exists: () => false })),
    getDocs: vi.fn(async () => ({ docs: [] })),
    setDoc: vi.fn(),
    writeBatch: vi.fn(() => createBatch()),
    serverTimestamp: vi.fn(() => '__SENTINEL_SERVER_TIMESTAMP__'),
    doc: vi.fn((db, col, id) => ({ __db: db, path: id ? `${col}/${id}` : `${col}/__auto__`, id, col })),
    collection: vi.fn((db, col) => ({ __db: db, path: col })),
    query: vi.fn((coll, ...constraints) => ({ __coll: coll, constraints })),
    orderBy: vi.fn((field, dir) => ({ __op: 'orderBy', field, dir })),
    limit: vi.fn((n) => ({ __op: 'limit', n })),
    startAfter: vi.fn((value) => ({ __op: 'startAfter', value })),
    where: vi.fn((field, op, value) => ({ __op: 'where', field, op, value })),
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

import { getDoc, getDocs, orderBy, setDoc, startAfter, Timestamp, writeBatch } from 'firebase/firestore';
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
const setDocMock = vi.mocked(setDoc);
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

/** The eight attribute columns of the default fixture pet (all 50, temperament 0). */
const FIXTURE_ATTRS = {
  intelligence: 50,
  toughness: 50,
  friendliness: 50,
  ruggedness: 50,
  enthusiasm: 50,
  virility: 50,
  ferocity: 50,
  temperament: 0,
};

/** Catalogue metadata that matches `makePet()` field-for-field (an idempotent re-share). */
function matchingMeta(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'Buzz',
    character: 'PlayerOne',
    species: 'BeeWasp',
    gender: Gender.FEMALE,
    breed: '',
    breeder: 'PlayerOne',
    notes: '',
    tags: ['fast', 'fierce'],
    attributes: { ...FIXTURE_ATTRS },
    schemaVersion: 1,
    appVersion: '0.6.3',
    uploadedAt: Timestamp.fromDate(new Date('2026-05-10T12:00:00Z')),
    uploaderUid: null,
    ...overrides,
  };
}

/** A read snapshot double. `getDoc` reads: base then genome, in that call order. */
function readSnap(data: unknown, { exists = true, id }: { exists?: boolean; id?: string } = {}) {
  return { exists: () => exists, id, data: () => data } as never;
}

describe('shareService.uploadPet — first share', () => {
  it('writes metadata + raw genome text in a single batch with no contentHash field in metadata', async () => {
    const result = await uploadPet(makePet());

    expect(result.status).toBe('created');
    expect(writeBatch).toHaveBeenCalledTimes(1);
    expect(setDoc).not.toHaveBeenCalled();
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
        'attributes',
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
    // Attributes are published as a nested, clamped 0–100 int map.
    expect(meta.payload.attributes).toEqual(FIXTURE_ATTRS);

    // Genome doc gets the raw genome_text, NOT the JSON-stringified
    // genome_data. content_hash is sha256(raw text).
    expect(Object.keys(genome.payload)).toEqual(['genomeData']);
    expect(genome.payload.genomeData).toBe('[Overview]\nCharacter=PlayerOne\nEntity=Buzz\n[Genes]\n');
  });

  it('rejects legacy pets that lack raw genome_text (pre-migration v13)', async () => {
    await expect(uploadPet(makePet({ genome_text: '' }))).rejects.toThrow(/genome_text is required/);
    expect(writeBatch).not.toHaveBeenCalled();
  });

  it('rejects local rows whose stored content_hash does not match sha256(genome_text)', async () => {
    const broken = makePet({ content_hash: 'f'.repeat(64) });
    await expect(uploadPet(broken)).rejects.toThrow(/local row is corrupt/);
    expect(writeBatch).not.toHaveBeenCalled();
  });

  it('rejects when content_hash is missing', async () => {
    await expect(uploadPet(makePet({ content_hash: '' }))).rejects.toThrow(/content_hash/);
    expect(writeBatch).not.toHaveBeenCalled();
  });
});

describe('shareService.uploadPet — concurrent first-share race (batch permission-denied → recheck)', () => {
  // The upfront reads see nothing published, so uploadPet takes the
  // first-share batch path. A racer creates the docs before commit, so
  // commit trips permission-denied and the recheck runs. getDoc call order
  // per attempt: [upfront base, upfront genome, recheck meta, recheck genome].
  function racingBatch() {
    const batch = createBatch();
    writeBatchMock.mockReturnValueOnce(batch as unknown as ReturnType<typeof writeBatch>);
    batch.commit.mockRejectedValueOnce(Object.assign(new Error('PERMISSION_DENIED'), { code: 'permission-denied' }));
  }

  it('returns already-shared when the recheck finds both halves and the genome hashes correctly', async () => {
    racingBatch();
    getDocMock
      .mockResolvedValueOnce(readSnap(null, { exists: false })) // upfront base
      .mockResolvedValueOnce(readSnap(null, { exists: false })) // upfront genome
      .mockResolvedValueOnce(readSnap({})) // recheck meta
      .mockResolvedValueOnce(readSnap({ genomeData: RAW_TEXT })); // recheck genome

    const result = await uploadPet(makePet());
    expect(result.status).toBe('already-shared');
    expect(result.contentHash).toBe(RAW_TEXT_HASH);
  });

  it('rejects when the raced-in genome doc is missing its genomeData field', async () => {
    racingBatch();
    getDocMock
      .mockResolvedValueOnce(readSnap(null, { exists: false }))
      .mockResolvedValueOnce(readSnap(null, { exists: false }))
      .mockResolvedValueOnce(readSnap({}))
      .mockResolvedValueOnce(readSnap({})); // exists but no genomeData
    await expect(uploadPet(makePet())).rejects.toThrow(/missing a genomeData field/);
  });

  it('rejects when the raced-in genome does not hash to the content_hash', async () => {
    racingBatch();
    getDocMock
      .mockResolvedValueOnce(readSnap(null, { exists: false }))
      .mockResolvedValueOnce(readSnap(null, { exists: false }))
      .mockResolvedValueOnce(readSnap({}))
      .mockResolvedValueOnce(readSnap({ genomeData: 'TAMPERED — not the raw text whose sha256 matches content_hash' }));
    await expect(uploadPet(makePet())).rejects.toThrow(/corrupt/);
  });

  it('re-throws permission-denied when neither half exists on recheck (rules misconfig, not a race)', async () => {
    racingBatch();
    getDocMock
      .mockResolvedValueOnce(readSnap(null, { exists: false }))
      .mockResolvedValueOnce(readSnap(null, { exists: false }))
      .mockResolvedValueOnce(readSnap(null, { exists: false }))
      .mockResolvedValueOnce(readSnap(null, { exists: false }));
    await expect(uploadPet(makePet())).rejects.toThrow(/PERMISSION_DENIED/);
  });

  it('rejects half-published state when the recheck finds /pets but not /genomes', async () => {
    racingBatch();
    getDocMock
      .mockResolvedValueOnce(readSnap(null, { exists: false }))
      .mockResolvedValueOnce(readSnap(null, { exists: false }))
      .mockResolvedValueOnce(readSnap({})) // meta exists
      .mockResolvedValueOnce(readSnap(null, { exists: false })); // genome missing
    await expect(uploadPet(makePet())).rejects.toThrow(/half-published/);
  });
});

describe('shareService.uploadPet — add-only corrections', () => {
  it('is an idempotent no-op when the latest entry already matches (no write)', async () => {
    getDocMock
      .mockResolvedValueOnce(readSnap(matchingMeta(), { id: RAW_TEXT_HASH })) // base exists, matches
      .mockResolvedValueOnce(readSnap({ genomeData: RAW_TEXT })); // genome valid
    // corrections query → default empty

    const result = await uploadPet(makePet());
    expect(result.status).toBe('already-shared');
    expect(result.contentHash).toBe(RAW_TEXT_HASH);
    expect(writeBatch).not.toHaveBeenCalled();
    expect(setDoc).not.toHaveBeenCalled();
  });

  it('appends a correction doc (auto-ID, with contentHash back-reference) when attributes differ', async () => {
    getDocMock
      .mockResolvedValueOnce(
        readSnap(matchingMeta({ attributes: { ...FIXTURE_ATTRS, intelligence: 99 } }), { id: RAW_TEXT_HASH }),
      )
      .mockResolvedValueOnce(readSnap({ genomeData: RAW_TEXT }));

    const result = await uploadPet(makePet());
    expect(result.status).toBe('created');
    // Add-only: a NEW metadata doc is set; the genome blob is untouched.
    expect(writeBatch).not.toHaveBeenCalled();
    expect(setDoc).toHaveBeenCalledTimes(1);
    const payload = setDocMock.mock.calls[0][1] as Record<string, unknown>;
    expect(payload.contentHash).toBe(RAW_TEXT_HASH);
    expect(payload.attributes).toEqual(FIXTURE_ATTRS);
    expect(payload).not.toHaveProperty('genomeData');
  });

  it('appends a correction when only the tags differ', async () => {
    getDocMock
      .mockResolvedValueOnce(readSnap(matchingMeta({ tags: ['fast'] }), { id: RAW_TEXT_HASH }))
      .mockResolvedValueOnce(readSnap({ genomeData: RAW_TEXT }));

    const result = await uploadPet(makePet());
    expect(result.status).toBe('created');
    expect(setDoc).toHaveBeenCalledTimes(1);
  });

  it('pins the correction identity fields to the first-share doc, not the local pet (issue #393)', async () => {
    // The catalogue entry's identity belongs to the first share — rules
    // reject a correction whose identity differs. The local pet was
    // renamed and re-bred; the appended correction must carry the BASE
    // doc's identity so the write passes the rules, while still
    // publishing the corrected attributes.
    getDocMock
      .mockResolvedValueOnce(
        readSnap(
          matchingMeta({
            name: 'CatalogueName',
            breed: 'CatalogueBreed',
            attributes: { ...FIXTURE_ATTRS, intelligence: 99 },
          }),
          { id: RAW_TEXT_HASH },
        ),
      )
      .mockResolvedValueOnce(readSnap({ genomeData: RAW_TEXT }));

    const result = await uploadPet(makePet({ name: 'LocalRename', breed: 'LocalBreed' }));
    expect(result.status).toBe('created');
    expect(setDoc).toHaveBeenCalledTimes(1);
    const payload = setDocMock.mock.calls[0][1] as Record<string, unknown>;
    expect(payload.name).toBe('CatalogueName');
    expect(payload.breed).toBe('CatalogueBreed');
    expect(payload.character).toBe('PlayerOne');
    expect(payload.species).toBe('BeeWasp');
    expect(payload.gender).toBe(Gender.FEMALE);
    expect(payload.breeder).toBe('PlayerOne');
    // The correction-eligible payload still comes from the local pet.
    expect(payload.attributes).toEqual(FIXTURE_ATTRS);
    expect(payload.contentHash).toBe(RAW_TEXT_HASH);
  });

  it('treats a rename-only local change as already-shared (identity is not correction-eligible)', async () => {
    // Identity fields can't be published via a correction, so a local
    // rename with identical notes/tags/attributes must be an idempotent
    // no-op — NOT an appended no-op correction on every re-share.
    getDocMock
      .mockResolvedValueOnce(readSnap(matchingMeta(), { id: RAW_TEXT_HASH }))
      .mockResolvedValueOnce(readSnap({ genomeData: RAW_TEXT }));

    const result = await uploadPet(makePet({ name: 'RenamedLocally' }));
    expect(result.status).toBe('already-shared');
    expect(setDoc).not.toHaveBeenCalled();
    expect(writeBatch).not.toHaveBeenCalled();
  });

  it('resolves the latest entry across base + corrections before deciding', async () => {
    // Base (older) differs, but a correction (newer) already matches → no-op.
    getDocMock
      .mockResolvedValueOnce(
        readSnap(matchingMeta({ tags: ['stale'], uploadedAt: Timestamp.fromDate(new Date('2026-05-01T00:00:00Z')) }), {
          id: RAW_TEXT_HASH,
        }),
      )
      .mockResolvedValueOnce(readSnap({ genomeData: RAW_TEXT }));
    getDocsMock.mockResolvedValueOnce({
      docs: [
        readSnap(
          matchingMeta({
            contentHash: RAW_TEXT_HASH,
            uploadedAt: Timestamp.fromDate(new Date('2026-06-01T00:00:00Z')),
          }),
          { id: 'auto-123' },
        ),
      ],
    } as never);

    const result = await uploadPet(makePet());
    expect(result.status).toBe('already-shared');
    expect(setDoc).not.toHaveBeenCalled();
  });

  it('rejects a half-published entry (base exists, genome missing) rather than piling on a correction', async () => {
    getDocMock
      .mockResolvedValueOnce(readSnap(matchingMeta(), { id: RAW_TEXT_HASH }))
      .mockResolvedValueOnce(readSnap(null, { exists: false })); // genome missing
    await expect(uploadPet(makePet())).rejects.toThrow(/half-published/);
    expect(setDoc).not.toHaveBeenCalled();
  });

  it('rejects when the existing genome blob is corrupt (does not hash to its ID)', async () => {
    getDocMock
      .mockResolvedValueOnce(readSnap(matchingMeta(), { id: RAW_TEXT_HASH }))
      .mockResolvedValueOnce(readSnap({ genomeData: 'TAMPERED' }));
    await expect(uploadPet(makePet())).rejects.toThrow(/corrupt/);
    expect(setDoc).not.toHaveBeenCalled();
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

  it('flags correction docs with isCorrection so read-side merges can find the base entry', async () => {
    getDocsMock.mockResolvedValueOnce({
      docs: [
        readSnap(matchingMeta({ contentHash: RAW_TEXT_HASH }), { id: 'auto-1' }),
        readSnap(matchingMeta(), { id: RAW_TEXT_HASH }),
      ],
    } as never);

    const { pets } = await listPets();
    expect(pets[0].isCorrection).toBe(true);
    expect(pets[0].contentHash).toBe(RAW_TEXT_HASH);
    expect(pets[1].isCorrection).toBe(false);
    expect(pets[1].contentHash).toBe(RAW_TEXT_HASH);
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

  it('resolves the latest correction over the base entry (latest-wins), identity from the base', async () => {
    // Base entry (older) + a correction doc (newer, carries the hash as a
    // field). getSharedPet must return the newest correction-eligible
    // fields (attributes/tags/notes) — but the identity fields stay the
    // base entry's (issue #393).
    getDocMock
      .mockResolvedValueOnce(
        readSnap(matchingMeta({ name: 'OldName', uploadedAt: Timestamp.fromDate(new Date('2026-05-01T00:00:00Z')) }), {
          id: RAW_TEXT_HASH,
        }),
      )
      .mockResolvedValueOnce(readSnap({ genomeData: 'GENOME-BODY' }));
    getDocsMock.mockResolvedValueOnce({
      docs: [
        readSnap(
          matchingMeta({
            contentHash: RAW_TEXT_HASH,
            notes: 'corrected notes',
            attributes: { ...FIXTURE_ATTRS, intelligence: 90 },
            uploadedAt: Timestamp.fromDate(new Date('2026-06-01T00:00:00Z')),
          }),
          { id: 'auto-9' },
        ),
      ],
    } as never);

    const pet = await getSharedPet(RAW_TEXT_HASH);
    expect(pet?.name).toBe('OldName');
    expect(pet?.contentHash).toBe(RAW_TEXT_HASH);
    expect(pet?.notes).toBe('corrected notes');
    expect(pet?.attributes).toEqual({ ...FIXTURE_ATTRS, intelligence: 90 });
    expect(pet?.genomeData).toBe('GENOME-BODY');
  });

  it('ignores identity fields on a hostile correction (defacement attempt, issue #393)', async () => {
    // A pre-rule "correction" that tries to rewrite someone else's entry:
    // new name/character/species/gender/breed/breeder. The read must pin
    // every identity field to the first-share doc and honour only the
    // correction-eligible attributes/tags/notes.
    getDocMock
      .mockResolvedValueOnce(
        readSnap(matchingMeta({ uploadedAt: Timestamp.fromDate(new Date('2026-05-01T00:00:00Z')) }), {
          id: RAW_TEXT_HASH,
        }),
      )
      .mockResolvedValueOnce(readSnap({ genomeData: 'GENOME-BODY' }));
    getDocsMock.mockResolvedValueOnce({
      docs: [
        readSnap(
          matchingMeta({
            contentHash: RAW_TEXT_HASH,
            name: 'HACKED',
            character: 'Mallory',
            species: 'Horse',
            gender: Gender.MALE,
            breed: 'FakeBreed',
            breeder: 'Mallory',
            notes: 'rude notes',
            tags: ['defaced'],
            attributes: { ...FIXTURE_ATTRS, ferocity: 100 },
            uploadedAt: Timestamp.fromDate(new Date('2026-06-01T00:00:00Z')),
          }),
          { id: 'auto-evil' },
        ),
      ],
    } as never);

    const pet = await getSharedPet(RAW_TEXT_HASH);
    // Identity: first-share values, not the hostile correction's.
    expect(pet?.name).toBe('Buzz');
    expect(pet?.character).toBe('PlayerOne');
    expect(pet?.species).toBe('BeeWasp');
    expect(pet?.gender).toBe(Gender.FEMALE);
    expect(pet?.breed).toBe('');
    expect(pet?.breeder).toBe('PlayerOne');
    // Correction-eligible fields still resolve latest-wins.
    expect(pet?.notes).toBe('rude notes');
    expect(pet?.tags).toEqual(['defaced']);
    expect(pet?.attributes).toEqual({ ...FIXTURE_ATTRS, ferocity: 100 });
  });

  it('reads a complete attribute map into SharedPet.attributes, undefined when incomplete', async () => {
    getDocMock
      .mockResolvedValueOnce(readSnap(matchingMeta({ attributes: { intelligence: 10 } }), { id: RAW_TEXT_HASH }))
      .mockResolvedValueOnce(readSnap({ genomeData: 'X' }));
    // Partial attribute maps are treated as absent so the importer falls back
    // to genome-derived values.
    const pet = await getSharedPet(RAW_TEXT_HASH);
    expect(pet?.attributes).toBeUndefined();
  });

  it.each([
    ['a non-integer (float) attribute', { ...FIXTURE_ATTRS, intelligence: 50.5 }],
    ['an out-of-range attribute (>100)', { ...FIXTURE_ATTRS, toughness: 101 }],
    ['a negative attribute', { ...FIXTURE_ATTRS, ferocity: -1 }],
  ])('treats %s as absent (tampered/pre-rule doc) so import falls back to genome-derived values', async (_label, attributes) => {
    getDocMock
      .mockResolvedValueOnce(readSnap(matchingMeta({ attributes }), { id: RAW_TEXT_HASH }))
      .mockResolvedValueOnce(readSnap({ genomeData: 'X' }));
    const pet = await getSharedPet(RAW_TEXT_HASH);
    expect(pet?.attributes).toBeUndefined();
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

  it('applies corrected attributes from the shared entry after a fresh import', async () => {
    // petService re-derives attributes from the genome/name (all-50 defaults
    // for an unstructured name). When the catalogue entry carries corrected
    // attributes, those must supersede the re-derived ones.
    const shared = await makeShared('ATTR');
    shared.attributes = {
      intelligence: 88,
      toughness: 12,
      friendliness: 50,
      ruggedness: 50,
      enthusiasm: 50,
      virility: 50,
      ferocity: 73,
      temperament: 0,
    };
    uploadPetLocallyMock.mockResolvedValueOnce({
      status: 'success',
      kind: 'created',
      message: '',
      pet_id: 61,
      name: shared.name,
    });
    updatePetMock.mockResolvedValue(true);

    await importCommunityPet(shared);

    expect(updatePet).toHaveBeenCalledWith(61, expect.objectContaining({ attributes: shared.attributes }));
  });

  it('does not touch attributes when the shared entry is legacy (no attributes)', async () => {
    const shared = await makeShared('LEGACY');
    shared.name = 'Renamed';
    // attributes intentionally left undefined (pre-attribute catalogue entry)
    uploadPetLocallyMock.mockResolvedValueOnce({
      status: 'success',
      kind: 'created',
      message: '',
      pet_id: 62,
      name: shared.name,
    });
    updatePetMock.mockResolvedValue(true);

    await importCommunityPet(shared);

    expect(updatePet).not.toHaveBeenCalledWith(62, expect.objectContaining({ attributes: expect.anything() }));
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
    const pets = [pet(1), pet(2), pet(3, { genome_text: undefined }), pet(4)];
    const upload = fakeUpload({ h1: 'created', h2: 'already-shared', h4: 'throw' });
    // Mirror production legacy semantics: the list projection drops genome_text
    // (so the pet field is `undefined`), and getPetGenomeText returns '' for a
    // pre-v13 row with no stored raw text. Both → skipped.
    const loadGenomeText = vi.fn().mockResolvedValue('');

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

  // Quota / throttle behaviour. `sleep` is injected so these are instant and
  // can assert the exact delays the throttle/backoff would have waited.
  const quotaError = () => Object.assign(new Error('quota exceeded'), { code: 'resource-exhausted' });

  it('throttles between network writes but never after the last pet', async () => {
    const pets = [pet(1), pet(2), pet(3)];
    const sleeps: number[] = [];
    const sleep = vi.fn(async (ms: number) => {
      sleeps.push(ms);
    });

    await uploadPets(pets, { upload: fakeUpload({}), loadGenomeText: vi.fn(), interRequestDelayMs: 50, sleep });

    expect(sleeps).toEqual([50, 50]); // after pets 1 and 2, not 3
  });

  it('does not throttle after a skipped pet (no network write)', async () => {
    const pets = [pet(1, { genome_text: undefined }), pet(2)];
    const sleep = vi.fn(async () => {});
    // pet 1 has no genome text → skipped → no throttle; pet 2 is last → no throttle.
    await uploadPets(pets, {
      upload: fakeUpload({}),
      loadGenomeText: vi.fn().mockResolvedValue(''),
      interRequestDelayMs: 50,
      sleep,
    });
    expect(sleep).not.toHaveBeenCalled();
  });

  it('retries a quota error with exponential backoff, then succeeds', async () => {
    const sleeps: number[] = [];
    const sleep = vi.fn(async (ms: number) => {
      sleeps.push(ms);
    });
    const upload = vi
      .fn<(p: Pet) => Promise<UploadResult>>()
      .mockRejectedValueOnce(quotaError())
      .mockRejectedValueOnce(quotaError())
      .mockResolvedValueOnce({ status: 'created', contentHash: 'h1' });

    const summary = await uploadPets([pet(1)], {
      upload,
      loadGenomeText: vi.fn(),
      maxQuotaRetries: 5,
      quotaBackoffBaseMs: 1000,
      sleep,
    });

    expect(upload).toHaveBeenCalledTimes(3);
    expect(sleeps).toEqual([1000, 2000]); // 1000 * 2**0, 1000 * 2**1
    expect(summary.created).toBe(1);
    expect(summary.failed).toBe(0);
  });

  it('gives up after maxQuotaRetries and marks the pet failed', async () => {
    const sleep = vi.fn(async () => {});
    const upload = vi.fn<(p: Pet) => Promise<UploadResult>>().mockRejectedValue(quotaError());

    const summary = await uploadPets([pet(1)], {
      upload,
      loadGenomeText: vi.fn(),
      maxQuotaRetries: 2,
      quotaBackoffBaseMs: 1000,
      sleep,
    });

    expect(upload).toHaveBeenCalledTimes(3); // initial + 2 retries
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(summary.failed).toBe(1);
  });

  it('does not retry a non-quota error', async () => {
    const sleep = vi.fn(async () => {});
    const upload = vi.fn<(p: Pet) => Promise<UploadResult>>().mockRejectedValue(new Error('corrupt row'));

    const summary = await uploadPets([pet(1)], { upload, loadGenomeText: vi.fn(), maxQuotaRetries: 5, sleep });

    expect(upload).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
    expect(summary.failed).toBe(1);
  });
});
