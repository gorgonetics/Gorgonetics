/**
 * Unit tests for shareService — mocks the Firestore SDK so we can assert
 * payload shape and on-read normalisation without the emulator. The
 * emulator round-trip and rule predicates live in
 * tests/integration/shareService.emulator.test.js.
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('firebase/firestore', async () => {
  const actual = await vi.importActual('firebase/firestore');
  return {
    ...actual,
    getDoc: vi.fn(),
    getDocs: vi.fn(),
    setDoc: vi.fn(),
    serverTimestamp: vi.fn(() => '__SENTINEL_SERVER_TIMESTAMP__'),
    doc: vi.fn((db, col, id) => ({ __db: db, path: `${col}/${id}`, id })),
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

import { getDoc, getDocs, orderBy, setDoc, startAfter, Timestamp } from 'firebase/firestore';
import { getSharedPet, listPets, sanitizeTags, uploadPet, verifySharedPet } from '$lib/services/shareService.js';
import { Gender } from '$lib/types/index.js';
import { sha256Hex } from '$lib/utils/hash.js';

function makePet(overrides = {}) {
  return {
    id: 1,
    name: 'Buzz',
    species: 'BeeWasp',
    gender: Gender.FEMALE,
    breed: '',
    breeder: 'PlayerOne',
    content_hash: 'a'.repeat(64),
    genome_data: '[Overview]\nCharacter=PlayerOne\nEntity=Buzz\n[Genes]\n',
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
  it('writes a payload matching the rules schema exactly', async () => {
    setDoc.mockResolvedValueOnce(undefined);
    const result = await uploadPet(makePet());

    expect(result.status).toBe('created');
    expect(setDoc).toHaveBeenCalledTimes(1);

    const [, payload] = setDoc.mock.calls[0];
    expect(Object.keys(payload).sort()).toEqual(
      [
        'appVersion',
        'breed',
        'breeder',
        'character',
        'gender',
        'genomeData',
        'name',
        'notes',
        'schemaVersion',
        'species',
        'tags',
        'uploadedAt',
        'uploaderUid',
      ].sort(),
    );
    expect(payload).not.toHaveProperty('contentHash');
    expect(payload).not.toHaveProperty('content_hash');
    expect(payload.uploaderUid).toBeNull();
    expect(payload.uploadedAt).toBe('__SENTINEL_SERVER_TIMESTAMP__');
    expect(payload.character).toBe('PlayerOne');
  });

  it('returns already-shared when the rules reject create and the doc exists', async () => {
    setDoc.mockRejectedValueOnce(Object.assign(new Error('PERMISSION_DENIED'), { code: 'permission-denied' }));
    getDoc.mockResolvedValueOnce({ exists: () => true });

    const result = await uploadPet(makePet());
    expect(result.status).toBe('already-shared');
    expect(result.contentHash).toBe('a'.repeat(64));
  });

  it('re-throws permission-denied if the doc does not actually exist', async () => {
    setDoc.mockRejectedValueOnce(Object.assign(new Error('PERMISSION_DENIED'), { code: 'permission-denied' }));
    getDoc.mockResolvedValueOnce({ exists: () => false });
    await expect(uploadPet(makePet())).rejects.toThrow(/PERMISSION_DENIED/);
  });

  it('rejects when content_hash is missing', async () => {
    await expect(uploadPet(makePet({ content_hash: '' }))).rejects.toThrow(/content_hash/);
  });
});

describe('shareService.listPets', () => {
  it('asks for newest-first with the default page size', async () => {
    getDocs.mockResolvedValueOnce({ docs: [] });
    await listPets();
    expect(orderBy).toHaveBeenCalledWith('uploadedAt', 'desc');
    const lastQuery = getDocs.mock.calls.at(-1)?.[0];
    expect(lastQuery.constraints.some((c) => c.__op === 'limit' && c.n === 50)).toBe(true);
  });

  it('passes the cursor through startAfter as a Timestamp', async () => {
    getDocs.mockResolvedValueOnce({ docs: [] });
    const cursor = {
      contentHash: 'b'.repeat(64),
      uploadedAt: new Date('2026-05-10T12:00:00Z'),
    };
    await listPets({ after: cursor });

    expect(startAfter).toHaveBeenCalledTimes(1);
    const arg = startAfter.mock.calls[0][0];
    expect(arg).toBeInstanceOf(Timestamp);
    expect(arg.toDate().toISOString()).toBe('2026-05-10T12:00:00.000Z');
  });
});

describe('shareService.getSharedPet', () => {
  it('returns null for missing docs', async () => {
    getDoc.mockResolvedValueOnce({ exists: () => false });
    expect(await getSharedPet('a'.repeat(64))).toBeNull();
  });

  it('maps a doc snapshot to SharedPet (with Timestamp → Date and tag sanitisation)', async () => {
    getDoc.mockResolvedValueOnce({
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
        tags: ['ok', 42, null, 'fine', { x: 1 }],
        schemaVersion: 5,
        appVersion: '0.6.3',
        genomeData: 'GENOME',
        uploadedAt: Timestamp.fromDate(new Date('2026-05-10T12:00:00Z')),
        uploaderUid: null,
      }),
    });
    const result = await getSharedPet('a'.repeat(64));
    expect(result).toMatchObject({
      contentHash: 'a'.repeat(64),
      name: 'Buzz',
      tags: ['ok', 'fine'],
      uploaderUid: null,
    });
    expect(result.uploadedAt).toBeInstanceOf(Date);
    expect(result.uploadedAt.toISOString()).toBe('2026-05-10T12:00:00.000Z');
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
});
