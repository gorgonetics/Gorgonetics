/**
 * Unit tests for shareService — mocks the Firestore SDK so we can assert
 * the exact upload payload shape and the on-read normalisation logic
 * without needing the emulator. The emulator round-trip and rule
 * predicates are covered by tests/integration/shareService.emulator.test.js.
 */

import { describe, expect, it, vi } from 'vitest';

// firebase/firestore is hoisted; the mock is in place before the service
// module loads so the singleton `firestore` import is harmless.
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

import { __test__, getSharedPet, listPets, uploadPet, verifySharedPet } from '$lib/services/shareService.js';

const { buildUploadPayload, extractCharacter, sanitizeTags, toSharedPet } = __test__;

import { getDoc, getDocs, orderBy, setDoc, startAfter, Timestamp } from 'firebase/firestore';

function makePet(overrides = {}) {
  return {
    id: 1,
    name: 'Buzz',
    species: 'BeeWasp',
    gender: 'Female',
    breed: '',
    breeder: '',
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

describe('shareService.buildUploadPayload', () => {
  it('builds a payload that matches the rules schema exactly', () => {
    const payload = buildUploadPayload(makePet());

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

    expect(payload.uploaderUid).toBeNull();
    expect(payload.uploadedAt).toBe('__SENTINEL_SERVER_TIMESTAMP__');
  });

  it('does NOT include contentHash in the payload (rules reject it)', () => {
    const payload = buildUploadPayload(makePet());
    expect(payload).not.toHaveProperty('contentHash');
    expect(payload).not.toHaveProperty('content_hash');
  });

  it('extracts character from the [Overview] block', () => {
    const payload = buildUploadPayload(makePet());
    expect(payload.character).toBe('PlayerOne');
  });

  it('falls back to empty character if line is missing', () => {
    const pet = makePet({ genome_data: '[Overview]\nEntity=Anon\n[Genes]\n' });
    const payload = buildUploadPayload(pet);
    expect(payload.character).toBe('');
  });
});

describe('shareService.sanitizeTags', () => {
  it('drops non-strings', () => {
    expect(sanitizeTags(['ok', 42, null, undefined, { x: 1 }, 'fine'])).toEqual(['ok', 'fine']);
  });

  it('dedupes', () => {
    expect(sanitizeTags(['a', 'a', 'b', 'a'])).toEqual(['a', 'b']);
  });

  it('caps at 30 entries', () => {
    const many = Array.from({ length: 50 }, (_, i) => `tag${i}`);
    expect(sanitizeTags(many)).toHaveLength(30);
  });

  it('drops empty and over-long strings', () => {
    expect(sanitizeTags(['', 'ok', 'x'.repeat(65)])).toEqual(['ok']);
  });

  it('returns [] for non-arrays', () => {
    expect(sanitizeTags(undefined)).toEqual([]);
    expect(sanitizeTags(null)).toEqual([]);
    expect(sanitizeTags('a,b')).toEqual([]);
  });
});

describe('shareService.uploadPet', () => {
  it('returns already-shared when the doc already exists', async () => {
    getDoc.mockResolvedValueOnce({ exists: () => true });
    const result = await uploadPet(makePet());
    expect(result.status).toBe('already-shared');
    expect(result.contentHash).toBe('a'.repeat(64));
    expect(setDoc).not.toHaveBeenCalled();
  });

  it('writes a new doc when none exists', async () => {
    getDoc.mockResolvedValueOnce({ exists: () => false });
    setDoc.mockResolvedValueOnce(undefined);

    const result = await uploadPet(makePet());

    expect(result.status).toBe('created');
    expect(setDoc).toHaveBeenCalledTimes(1);
    const [, payload] = setDoc.mock.calls[0];
    expect(payload).not.toHaveProperty('contentHash');
    expect(payload.uploaderUid).toBeNull();
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
    // limit was passed as a constraint; the value goes through queryLimit
    const lastQuery = getDocs.mock.calls.at(-1)?.[0];
    expect(lastQuery.constraints.some((c) => c.__op === 'limit' && c.n === 50)).toBe(true);
  });

  it('passes the cursor through startAfter as a Timestamp', async () => {
    getDocs.mockResolvedValueOnce({ docs: [] });
    const cursor = {
      contentHash: 'b'.repeat(64),
      uploadedAt: new Date('2026-05-10T12:00:00Z'),
      // other fields irrelevant for cursor extraction
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
    const result = await getSharedPet('a'.repeat(64));
    expect(result).toBeNull();
  });

  it('maps a doc snapshot to SharedPet', async () => {
    getDoc.mockResolvedValueOnce({
      exists: () => true,
      id: 'a'.repeat(64),
      data: () => ({
        name: 'Buzz',
        character: 'PlayerOne',
        species: 'BeeWasp',
        gender: 'Female',
        breed: '',
        breeder: '',
        notes: '',
        tags: ['fast', 'fierce'],
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
      character: 'PlayerOne',
      tags: ['fast', 'fierce'],
      uploaderUid: null,
    });
    expect(result.uploadedAt).toBeInstanceOf(Date);
    expect(result.uploadedAt.toISOString()).toBe('2026-05-10T12:00:00.000Z');
  });
});

describe('shareService.toSharedPet', () => {
  it('sanitizes tags from a tampered document', () => {
    const snap = {
      exists: () => true,
      id: 'c'.repeat(64),
      data: () => ({
        name: 'Roach',
        character: 'PlayerTwo',
        species: 'Horse',
        gender: 'Male',
        breed: 'Standardbred',
        breeder: 'Studio',
        notes: '',
        tags: ['ok', 42, null, 'fine', { x: 1 }],
        schemaVersion: 5,
        appVersion: '0.6.3',
        genomeData: 'GENOME',
        uploadedAt: Timestamp.fromDate(new Date('2026-05-10T00:00:00Z')),
        uploaderUid: null,
      }),
    };
    expect(toSharedPet(snap).tags).toEqual(['ok', 'fine']);
  });
});

describe('shareService.verifySharedPet', () => {
  it('passes when sha256(genomeData) matches contentHash', async () => {
    const genomeData = '[Overview]\nEntity=Bee\n[Genes]\n';
    // SHA-256 of that exact string, computed in this test for symmetry.
    const enc = new TextEncoder().encode(genomeData);
    const digest = await crypto.subtle.digest('SHA-256', enc);
    const expected = Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    const pet = { contentHash: expected, genomeData };
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

describe('shareService.extractCharacter', () => {
  it('returns the value after Character=', () => {
    expect(extractCharacter('[Overview]\nCharacter=Foo\n[Genes]\n')).toBe('Foo');
  });

  it('stops at [Genes] block', () => {
    expect(extractCharacter('[Overview]\n[Genes]\nCharacter=Late\n')).toBe('');
  });

  it('handles CRLF line endings', () => {
    expect(extractCharacter('[Overview]\r\nCharacter=Win\r\n[Genes]\r\n')).toBe('Win');
  });
});
