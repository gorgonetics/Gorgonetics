/**
 * Integration tests for shareService against the Firestore Emulator.
 *
 * Validates two things the unit suite cannot:
 *  1. The end-to-end round-trip (upload → list → fetch) works against a
 *     real Firestore implementation, not a mock.
 *  2. `firestore.rules` actually enforces each of the predicates documented
 *     in the design (one negative test per rule clause).
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

const COLLECTION = 'pets';
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
  // Clear the `pets` collection between tests. Rules deny SDK deletes, so
  // we hit the emulator's clearData REST endpoint instead — cheaper than
  // re-initializing.
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
  it('uploads, lists, and fetches a pet', async () => {
    const pet = await freshPet('A');

    const result = await uploadPet(pet, db);
    expect(result.status).toBe('created');
    expect(result.contentHash).toBe(pet.content_hash);

    const fetched = await getSharedPet(pet.content_hash, db);
    expect(fetched).not.toBeNull();
    expect(fetched.contentHash).toBe(pet.content_hash);
    expect(fetched.name).toBe('Buzz');
    expect(fetched.character).toBe('PlayerA');
    expect(fetched.uploadedAt).toBeInstanceOf(Date);

    const listed = await listPets({}, db);
    expect(listed).toHaveLength(1);
    expect(listed[0].contentHash).toBe(pet.content_hash);
  });

  it('second upload of the same content returns already-shared', async () => {
    const pet = await freshPet('B');
    expect((await uploadPet(pet, db)).status).toBe('created');
    expect((await uploadPet(pet, db)).status).toBe('already-shared');
    expect(await listPets({}, db)).toHaveLength(1);
  });

  it('lists in newest-first order and paginates via the after cursor', async () => {
    // serverTimestamp() resolves to a single request.time per commit, so
    // back-to-back writes can collide on the millisecond and break the
    // newest-first assertion. The 10ms gap is load-bearing.
    const petA = await freshPet('X');
    const petB = await freshPet('Y');
    const petC = await freshPet('Z');

    await uploadPet(petA, db);
    await new Promise((r) => setTimeout(r, 10));
    await uploadPet(petB, db);
    await new Promise((r) => setTimeout(r, 10));
    await uploadPet(petC, db);

    const firstPage = await listPets({ limit: 2 }, db);
    expect(firstPage.map((p) => p.contentHash)).toEqual([petC.content_hash, petB.content_hash]);

    const secondPage = await listPets({ limit: 2, after: firstPage[1] }, db);
    expect(secondPage.map((p) => p.contentHash)).toEqual([petA.content_hash]);
  });

  it('getSharedPet returns null for an unknown hash', async () => {
    expect(await getSharedPet('0'.repeat(64), db)).toBeNull();
  });
});

describe('firestore.rules enforces the upload schema', () => {
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
      genomeData: '[Overview]\nEntity=Buzz\n[Genes]\n',
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
    await expectRejected(setDoc(doc(db, COLLECTION, VALID_DOC_ID), { ...validBasePayload(), nope: 'x' }));
  });

  it('rejects payload missing a required field', async () => {
    const payload = validBasePayload();
    delete payload.name;
    await expectRejected(setDoc(doc(db, COLLECTION, VALID_DOC_ID), payload));
  });

  it.each([
    ['species enum violation', { species: 'Dragon' }],
    ['gender enum violation', { gender: 'Other' }],
    ['oversized name (>100 chars)', { name: 'x'.repeat(101) }],
    ['oversized genomeData (>64 KiB)', { genomeData: 'x'.repeat(65537) }],
    ['tags > 30 entries', { tags: Array.from({ length: 31 }, (_, i) => `t${i}`) }],
    ['non-string entry in tags', { tags: ['ok', 42] }],
    ['over-long tag entry (>64 chars)', { tags: ['x'.repeat(65)] }],
    ['uploaderUid != null', { uploaderUid: 'someone' }],
  ])('rejects %s', async (_label, override) => {
    await expectRejected(setDoc(doc(db, COLLECTION, VALID_DOC_ID), { ...validBasePayload(), ...override }));
  });

  it.each([
    ['short id', 'short-id'],
    ['uppercase hex', 'A'.repeat(64)],
  ])('rejects doc ID that does not match SHA-256 hex regex: %s', async (_label, badId) => {
    await expectRejected(setDoc(doc(db, COLLECTION, badId), validBasePayload()));
  });

  it('accepts a fully valid payload', async () => {
    // Positive control — proves the negative tests above are failing for the
    // right reason and not a generic emulator/setup issue.
    await setDoc(doc(db, COLLECTION, VALID_DOC_ID), validBasePayload());
    const snap = await getDocs(query(collection(db, COLLECTION)));
    expect(snap.size).toBe(1);
  });

  describe('forbids mutations after create', () => {
    it('rejects update of an existing doc', async () => {
      const pet = await freshPet('U');
      await uploadPet(pet, db);
      await expectRejected(setDoc(doc(db, COLLECTION, pet.content_hash), { name: 'rewritten' }, { merge: true }));
    });

    it('rejects deletion', async () => {
      const pet = await freshPet('D');
      await uploadPet(pet, db);
      await expectRejected(deleteDoc(doc(db, COLLECTION, pet.content_hash)));
    });
  });
});
