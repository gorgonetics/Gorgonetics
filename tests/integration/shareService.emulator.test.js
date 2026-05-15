/**
 * Integration tests for shareService against the Firestore Emulator.
 *
 * Validates two things the unit suite cannot:
 *  1. The end-to-end round-trip (upload → list → fetch) works against a
 *     real Firestore implementation, not a mock — including the
 *     metadata/genome split (listPets returns metadata only; getSharedPet
 *     combines both reads).
 *  2. `firestore.rules` actually enforces each of the predicates documented
 *     in the design across BOTH collections (`/pets/{hash}` and
 *     `/genomes/{hash}`).
 *
 * Run with `pnpm test:firestore`, which wraps this file in
 * `firebase emulators:exec --only firestore` so the emulator is up before
 * the tests start and torn down after. Without that wrapper, the tests will
 * fail to connect — see docs/firebase-setup.md.
 */

import { deleteApp, getApp, initializeApp } from 'firebase/app';
import {
  collection,
  connectFirestoreEmulator,
  deleteDoc,
  doc,
  getDocs,
  getFirestore,
  query,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { getSharedPet, listPets, uploadPet } from '$lib/services/shareService.js';
import { Gender } from '$lib/types/index.js';
import { sha256Hex } from '$lib/utils/hash.js';

const META_COLLECTION = 'pets';
const GENOME_COLLECTION = 'genomes';
const EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST?.split(':')[0] ?? 'localhost';
const EMULATOR_PORT = Number(process.env.FIRESTORE_EMULATOR_HOST?.split(':')[1] ?? 8080);
const PROJECT_ID = `demo-gorgonetics-${Date.now()}`;

let app;
let db;

beforeAll(() => {
  app = initializeApp({ projectId: PROJECT_ID }, `share-test-${PROJECT_ID}`);
  db = getFirestore(app);
  connectFirestoreEmulator(db, EMULATOR_HOST, EMULATOR_PORT);
});

afterAll(async () => {
  // The default Firebase app gets initialised as a side-effect of importing
  // shareService → $lib/firebase. The integration tests never use it, but
  // leaving it open holds a gRPC channel until process exit — a real leak
  // for any long-running test harness. The test-scoped app is its own
  // cleanup below.
  await deleteApp(getApp()).catch(() => {});
  await deleteApp(app);
});

afterEach(async () => {
  // Clear both collections between tests. Rules deny SDK deletes, so we
  // hit the emulator's clearData REST endpoint — cheaper than re-init.
  await fetch(
    `http://${EMULATOR_HOST}:${EMULATOR_PORT}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
    { method: 'DELETE' },
  );
});

function makePet(genomeData, overrides = {}) {
  return {
    id: 1,
    name: 'Buzz',
    species: 'BeeWasp',
    gender: Gender.FEMALE,
    breed: '',
    breeder: 'PlayerOne',
    content_hash: '',
    genome_data: genomeData,
    notes: '',
    tags: ['fast'],
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

async function freshPet(seed = 'pet') {
  const genomeData = `[Overview]\nCharacter=Player${seed}\nEntity=Buzz${seed}\n[Genes]\n`;
  const content_hash = await sha256Hex(genomeData);
  return makePet(genomeData, { content_hash, breeder: `Player${seed}` });
}

describe('shareService end-to-end via emulator', () => {
  it('uploads, lists (metadata only), then fetches the full pet with genome', async () => {
    const pet = await freshPet('A');

    const result = await uploadPet(pet, db);
    expect(result.status).toBe('created');
    expect(result.contentHash).toBe(pet.content_hash);

    const listed = await listPets({}, db);
    expect(listed).toHaveLength(1);
    expect(listed[0].contentHash).toBe(pet.content_hash);
    expect(listed[0].name).toBe('Buzz');
    expect(listed[0].character).toBe('PlayerA');
    // The whole point of the split: list rows do NOT carry the genome.
    expect(listed[0].genomeData).toBeUndefined();

    const fetched = await getSharedPet(pet.content_hash, db);
    expect(fetched?.genomeData).toBe(pet.genome_data);
    expect(fetched?.uploadedAt).toBeInstanceOf(Date);
  });

  it('second upload of the same content returns already-shared', async () => {
    const pet = await freshPet('B');
    expect((await uploadPet(pet, db)).status).toBe('created');
    expect((await uploadPet(pet, db)).status).toBe('already-shared');
    expect(await listPets({}, db)).toHaveLength(1);
  });

  it('lists in newest-first order and paginates via the after cursor', async () => {
    // serverTimestamp() resolves to a single request.time per commit, so
    // back-to-back writes can collide on the millisecond. 100ms is a
    // generous gap against slow CI runners without being painful locally.
    const petA = await freshPet('X');
    const petB = await freshPet('Y');
    const petC = await freshPet('Z');

    await uploadPet(petA, db);
    await new Promise((r) => setTimeout(r, 100));
    await uploadPet(petB, db);
    await new Promise((r) => setTimeout(r, 100));
    await uploadPet(petC, db);

    const firstPage = await listPets({ limit: 2 }, db);
    const secondPage = await listPets({ limit: 2, after: firstPage[1] }, db);

    // Timing-independent invariants: pagination yields every pet exactly
    // once with no overlap between pages.
    const firstHashes = firstPage.map((p) => p.contentHash);
    const secondHashes = secondPage.map((p) => p.contentHash);
    expect(firstPage).toHaveLength(2);
    expect(secondPage).toHaveLength(1);
    expect([...firstHashes, ...secondHashes].sort()).toEqual(
      [petA.content_hash, petB.content_hash, petC.content_hash].sort(),
    );
    expect(firstHashes.some((h) => secondHashes.includes(h))).toBe(false);

    // Timing-dependent invariant: newest first. Guarded by the 100ms gaps
    // above; if this ever flakes on CI the gaps need to grow, not the
    // assertion to weaken.
    expect(firstHashes).toEqual([petC.content_hash, petB.content_hash]);
  });

  it('getSharedPet returns null for an unknown hash', async () => {
    expect(await getSharedPet('0'.repeat(64), db)).toBeNull();
  });
});

describe('firestore.rules — /pets metadata schema', () => {
  // Each test deliberately builds a payload that violates one rule clause
  // and expects setDoc to be rejected. We bypass the service layer here
  // because the service is built to produce valid payloads — these tests
  // assert the server-side guard, not the client.

  function validBasePayload() {
    return {
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
      // Rules require `uploadedAt == request.time`, so the only way to
      // satisfy that is the server-side sentinel.
      uploadedAt: serverTimestamp(),
      uploaderUid: null,
    };
  }

  // Any 64-char lowercase hex value passes the rule regex; the rules
  // can't verify hash agreement (the SHA-256 ↔ genomeData binding is
  // enforced client-side via verifySharedPet).
  const VALID_DOC_ID = 'a'.repeat(64);

  async function expectRejected(promise) {
    let threw = false;
    try {
      await promise;
    } catch (e) {
      threw = true;
      expect(String(e)).toMatch(/permission|invalid/i);
    }
    expect(threw).toBe(true);
  }

  it('rejects payload with an extra unknown field', async () => {
    await expectRejected(setDoc(doc(db, META_COLLECTION, VALID_DOC_ID), { ...validBasePayload(), nope: 'x' }));
  });

  it('rejects a payload that still carries genomeData (legacy schema attempt)', async () => {
    await expectRejected(
      setDoc(doc(db, META_COLLECTION, VALID_DOC_ID), {
        ...validBasePayload(),
        genomeData: '[Overview]\nEntity=Buzz\n[Genes]\n',
      }),
    );
  });

  it('rejects payload missing a required field', async () => {
    const payload = validBasePayload();
    delete payload.name;
    await expectRejected(setDoc(doc(db, META_COLLECTION, VALID_DOC_ID), payload));
  });

  it.each([
    ['species enum violation', { species: 'Dragon' }],
    ['gender enum violation', { gender: 'Other' }],
    ['oversized name (>100 chars)', { name: 'x'.repeat(101) }],
    ['tags > 30 entries', { tags: Array.from({ length: 31 }, (_, i) => `t${i}`) }],
    ['non-string entry in tags', { tags: ['ok', 42] }],
    ['over-long tag entry (>64 chars)', { tags: ['x'.repeat(65)] }],
    ['uploaderUid != null', { uploaderUid: 'someone' }],
  ])('rejects %s', async (_label, override) => {
    await expectRejected(setDoc(doc(db, META_COLLECTION, VALID_DOC_ID), { ...validBasePayload(), ...override }));
  });

  it.each([
    ['short id', 'short-id'],
    ['uppercase hex', 'A'.repeat(64)],
  ])('rejects /pets doc ID that does not match SHA-256 hex regex: %s', async (_label, badId) => {
    await expectRejected(setDoc(doc(db, META_COLLECTION, badId), validBasePayload()));
  });

  it('accepts a fully valid metadata payload', async () => {
    // Positive control — proves the negative tests above are failing for the
    // right reason and not a generic emulator/setup issue.
    await setDoc(doc(db, META_COLLECTION, VALID_DOC_ID), validBasePayload());
    const snap = await getDocs(query(collection(db, META_COLLECTION)));
    expect(snap.size).toBe(1);
  });
});

describe('firestore.rules — /genomes blob schema', () => {
  const VALID_DOC_ID = 'a'.repeat(64);

  async function expectRejected(promise) {
    let threw = false;
    try {
      await promise;
    } catch (e) {
      threw = true;
      expect(String(e)).toMatch(/permission|invalid/i);
    }
    expect(threw).toBe(true);
  }

  it('accepts a valid genome blob', async () => {
    await setDoc(doc(db, GENOME_COLLECTION, VALID_DOC_ID), { genomeData: '[Overview]\nEntity=Buzz\n[Genes]\n' });
    const snap = await getDocs(query(collection(db, GENOME_COLLECTION)));
    expect(snap.size).toBe(1);
  });

  it('rejects empty genome data', async () => {
    await expectRejected(setDoc(doc(db, GENOME_COLLECTION, VALID_DOC_ID), { genomeData: '' }));
  });

  it('rejects oversized genome data (>64 KiB)', async () => {
    await expectRejected(setDoc(doc(db, GENOME_COLLECTION, VALID_DOC_ID), { genomeData: 'x'.repeat(65537) }));
  });

  it('rejects extra keys beyond genomeData', async () => {
    await expectRejected(setDoc(doc(db, GENOME_COLLECTION, VALID_DOC_ID), { genomeData: 'ok', extra: 1 }));
  });

  it.each([
    ['short id', 'short-id'],
    ['uppercase hex', 'A'.repeat(64)],
  ])('rejects /genomes doc ID that does not match SHA-256 hex regex: %s', async (_label, badId) => {
    await expectRejected(setDoc(doc(db, GENOME_COLLECTION, badId), { genomeData: 'ok' }));
  });
});

describe('firestore.rules — forbids mutations after create', () => {
  async function expectRejected(promise) {
    let threw = false;
    try {
      await promise;
    } catch (e) {
      threw = true;
      expect(String(e)).toMatch(/permission|invalid/i);
    }
    expect(threw).toBe(true);
  }

  it('rejects update of an existing /pets doc', async () => {
    const pet = await freshPet('U');
    await uploadPet(pet, db);
    await expectRejected(setDoc(doc(db, META_COLLECTION, pet.content_hash), { name: 'rewritten' }, { merge: true }));
  });

  it('rejects deletion from /pets', async () => {
    const pet = await freshPet('D');
    await uploadPet(pet, db);
    await expectRejected(deleteDoc(doc(db, META_COLLECTION, pet.content_hash)));
  });

  it('rejects update of an existing /genomes doc', async () => {
    const pet = await freshPet('UG');
    await uploadPet(pet, db);
    await expectRejected(
      setDoc(doc(db, GENOME_COLLECTION, pet.content_hash), { genomeData: 'tampered' }, { merge: true }),
    );
  });

  it('rejects deletion from /genomes', async () => {
    const pet = await freshPet('DG');
    await uploadPet(pet, db);
    await expectRejected(deleteDoc(doc(db, GENOME_COLLECTION, pet.content_hash)));
  });
});
