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

import { deleteApp, type FirebaseApp, getApp, initializeApp } from 'firebase/app';
import {
  collection,
  connectFirestoreEmulator,
  deleteDoc,
  doc,
  type Firestore,
  getDocs,
  getFirestore,
  query,
  serverTimestamp,
  setDoc,
  writeBatch,
} from 'firebase/firestore';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { getSharedPet, listPets, uploadPet } from '$lib/services/shareService.js';
import { Gender } from '$lib/types/index.js';
import { sha256Hex } from '$lib/utils/hash.js';
import { freshPet } from '../fixtures/sharePet.js';

const META_COLLECTION = 'pets';
const GENOME_COLLECTION = 'genomes';
const EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST?.split(':')[0] ?? 'localhost';
const EMULATOR_PORT = Number(process.env.FIRESTORE_EMULATOR_HOST?.split(':')[1] ?? 8080);
const PROJECT_ID = `demo-gorgonetics-${Date.now()}`;

let app: FirebaseApp;
let db: Firestore;

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

describe('shareService end-to-end via emulator', () => {
  it('uploads, lists (metadata only), then fetches the full pet with genome', async () => {
    const pet = await freshPet('A');

    const result = await uploadPet(pet, db);
    expect(result.status).toBe('created');
    expect(result.contentHash).toBe(pet.content_hash);

    const { pets, cursor } = await listPets({}, db);
    expect(pets).toHaveLength(1);
    expect(cursor).not.toBeNull();
    expect(pets[0].contentHash).toBe(pet.content_hash);
    expect(pets[0].name).toBe('Buzz');
    expect(pets[0].character).toBe('PlayerA');
    // The whole point of the split: list rows do NOT carry the genome.
    expect(pets[0].genomeData).toBeUndefined();

    const fetched = await getSharedPet(pet.content_hash, db);
    // The genome doc carries the RAW genome_text, NOT the JSON-stringified
    // genome_data — that's what content_hash is the SHA-256 of.
    expect(fetched?.genomeData).toBe(pet.genome_text);
    expect(fetched?.uploadedAt).toBeInstanceOf(Date);
  });

  it('share → fetch → verify roundtrip succeeds (hash matches over the wire)', async () => {
    const pet = await freshPet('R');
    await uploadPet(pet, db);

    const fetched = await getSharedPet(pet.content_hash, db);
    expect(fetched).not.toBeNull();
    // Re-hash the genomeData we just got back from Firestore — it must
    // match the content_hash that was the doc ID. This is the property
    // that the JSON-vs-raw bug masks: if uploadPet sent the JSON form,
    // sha256(fetched.genomeData) wouldn't equal pet.content_hash.
    const refetchedHash = await sha256Hex(fetched?.genomeData ?? '');
    expect(refetchedHash).toBe(pet.content_hash);
  });

  it('rejects sharing a pet that lacks genome_text (legacy pre-v13)', async () => {
    const pet = await freshPet('L');
    await expect(uploadPet({ ...pet, genome_text: '' }, db)).rejects.toThrow(/genome_text is required/);
    // Nothing should have landed in either collection.
    const { pets } = await listPets({}, db);
    expect(pets).toHaveLength(0);
  });

  it('second upload of the same content returns already-shared', async () => {
    const pet = await freshPet('B');
    expect((await uploadPet(pet, db)).status).toBe('created');
    expect((await uploadPet(pet, db)).status).toBe('already-shared');
    const { pets } = await listPets({}, db);
    expect(pets).toHaveLength(1);
  });

  it('paginates deterministically via the opaque cursor, even with same-request.time uploads', async () => {
    // Putting all three pets in ONE writeBatch forces every metadata doc
    // to share the same `request.time` (Firestore commits a batch
    // atomically with a single server timestamp). Sequential awaited
    // uploads might land in different milliseconds and miss the
    // tiebreaker case the snapshot cursor is meant to handle. The
    // shared timestamp is exactly the regression we want under test.
    const petA = await freshPet('X');
    const petB = await freshPet('Y');
    const petC = await freshPet('Z');

    const batch = writeBatch(db);
    for (const pet of [petA, petB, petC]) {
      batch.set(doc(db, META_COLLECTION, pet.content_hash), {
        name: pet.name,
        character: pet.breeder,
        species: pet.species,
        gender: pet.gender,
        breed: pet.breed,
        breeder: pet.breeder,
        notes: pet.notes,
        tags: pet.tags,
        schemaVersion: 1,
        appVersion: '0.6.3',
        uploadedAt: serverTimestamp(),
        uploaderUid: null,
      });
      batch.set(doc(db, GENOME_COLLECTION, pet.content_hash), { genomeData: pet.genome_text });
    }
    await batch.commit();

    const first = await listPets({ limit: 2 }, db);
    const second = await listPets({ limit: 2, after: first.cursor }, db);

    // Every pet appears exactly once across the two pages with no overlap.
    const firstHashes = first.pets.map((p) => p.contentHash);
    const secondHashes = second.pets.map((p) => p.contentHash);
    expect(first.pets).toHaveLength(2);
    expect(second.pets).toHaveLength(1);
    expect([...firstHashes, ...secondHashes].sort()).toEqual(
      [petA.content_hash, petB.content_hash, petC.content_hash].sort(),
    );
    expect(firstHashes.some((h) => secondHashes.includes(h))).toBe(false);
  });

  it('getSharedPet returns null for an unknown hash', async () => {
    expect(await getSharedPet('0'.repeat(64), db)).toBeNull();
  });
});

// Any 64-char lowercase hex value passes the rule regex; the rules
// can't verify hash agreement (the SHA-256 ↔ genomeData binding is
// enforced client-side via verifySharedPet).
const VALID_DOC_ID = 'a'.repeat(64);

function validMetadata() {
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

function validGenome() {
  return { genomeData: '[Overview]\nEntity=Buzz\n[Genes]\n' };
}

/**
 * Write both halves atomically. With `existsAfter()` in the rules, a
 * single-collection setDoc is always rejected — the rule-by-rule
 * negative tests below override one half of the batch to exercise
 * individual predicates without tripping the existsAfter check.
 */
function batchWrite(hash: string, metaOverride = {}, genomeOverride = {}) {
  const batch = writeBatch(db);
  batch.set(doc(db, META_COLLECTION, hash), { ...validMetadata(), ...metaOverride });
  batch.set(doc(db, GENOME_COLLECTION, hash), { ...validGenome(), ...genomeOverride });
  return batch.commit();
}

async function expectRejected(promise: Promise<unknown>) {
  let threw = false;
  try {
    await promise;
  } catch (e) {
    threw = true;
    expect(String(e)).toMatch(/permission|invalid/i);
  }
  expect(threw).toBe(true);
}

describe('firestore.rules — /pets metadata schema', () => {
  // Each test deliberately builds a metadata payload that violates one
  // rule clause and expects the batch (still atomic, genome half valid)
  // to be rejected. We bypass the service layer here because the
  // service is built to produce valid payloads — these tests assert the
  // server-side guard, not the client.

  it('rejects payload with an extra unknown field', async () => {
    await expectRejected(batchWrite(VALID_DOC_ID, { nope: 'x' }));
  });

  it('rejects a payload that still carries genomeData (legacy schema attempt)', async () => {
    await expectRejected(batchWrite(VALID_DOC_ID, { genomeData: '[Overview]\nEntity=Buzz\n[Genes]\n' }));
  });

  it('rejects payload missing a required field', async () => {
    const meta: Record<string, unknown> = validMetadata();
    delete meta.name;
    const batch = writeBatch(db);
    batch.set(doc(db, META_COLLECTION, VALID_DOC_ID), meta);
    batch.set(doc(db, GENOME_COLLECTION, VALID_DOC_ID), validGenome());
    await expectRejected(batch.commit());
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
    await expectRejected(batchWrite(VALID_DOC_ID, override));
  });

  it.each([
    ['short id', 'short-id'],
    ['uppercase hex', 'A'.repeat(64)],
  ])('rejects /pets doc ID that does not match SHA-256 hex regex: %s', async (_label, badId) => {
    await expectRejected(batchWrite(badId));
  });

  it('accepts a fully valid batched payload', async () => {
    // Positive control — proves the negative tests above are failing for the
    // right reason and not a generic emulator/setup issue.
    await batchWrite(VALID_DOC_ID);
    const snap = await getDocs(query(collection(db, META_COLLECTION)));
    expect(snap.size).toBe(1);
  });
});

describe('firestore.rules — /genomes blob schema', () => {
  it('accepts a valid genome blob (batched with valid /pets twin)', async () => {
    await batchWrite(VALID_DOC_ID);
    const snap = await getDocs(query(collection(db, GENOME_COLLECTION)));
    expect(snap.size).toBe(1);
  });

  it('rejects empty genome data', async () => {
    await expectRejected(batchWrite(VALID_DOC_ID, {}, { genomeData: '' }));
  });

  it('rejects oversized genome data (>64 KiB)', async () => {
    await expectRejected(batchWrite(VALID_DOC_ID, {}, { genomeData: 'x'.repeat(65537) }));
  });

  it('rejects extra keys beyond genomeData', async () => {
    await expectRejected(batchWrite(VALID_DOC_ID, {}, { extra: 1 }));
  });

  it.each([
    ['short id', 'short-id'],
    ['uppercase hex', 'A'.repeat(64)],
  ])('rejects /genomes doc ID that does not match SHA-256 hex regex: %s', async (_label, badId) => {
    await expectRejected(batchWrite(badId));
  });
});

describe('firestore.rules — existsAfter() bans orphan docs', () => {
  it('rejects a single-collection write to /pets (no matching /genomes)', async () => {
    await expectRejected(setDoc(doc(db, META_COLLECTION, VALID_DOC_ID), validMetadata()));
  });

  it('rejects a single-collection write to /genomes (no matching /pets)', async () => {
    await expectRejected(setDoc(doc(db, GENOME_COLLECTION, VALID_DOC_ID), validGenome()));
  });
});

describe('firestore.rules — forbids mutations after create', () => {
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
