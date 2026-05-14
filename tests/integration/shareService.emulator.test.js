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

import { deleteApp, initializeApp } from 'firebase/app';
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
import { sha256Hex } from '$lib/utils/hash.js';

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
  await deleteApp(app);
});

afterEach(async () => {
  // Clear the `pets` collection between tests. setDoc-as-admin via the
  // emulator is allowed because we delete using the SDK (which goes through
  // the same rules) — but `delete` is rejected by rules. Workaround: hit
  // the emulator's clearData REST endpoint instead. Cheaper than
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
    gender: 'Female',
    breed: '',
    breeder: '',
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
  return makePet(genomeData, { content_hash });
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

    const all = await listPets({}, db);
    expect(all).toHaveLength(1);
  });

  it('lists in newest-first order and paginates via the after cursor', async () => {
    const petA = await freshPet('X');
    const petB = await freshPet('Y');
    const petC = await freshPet('Z');

    await uploadPet(petA, db);
    await new Promise((r) => setTimeout(r, 10));
    await uploadPet(petB, db);
    await new Promise((r) => setTimeout(r, 10));
    await uploadPet(petC, db);

    const firstPage = await listPets({ limit: 2 }, db);
    expect(firstPage).toHaveLength(2);
    expect(firstPage[0].contentHash).toBe(petC.content_hash);
    expect(firstPage[1].contentHash).toBe(petB.content_hash);

    const secondPage = await listPets({ limit: 2, after: firstPage[1] }, db);
    expect(secondPage).toHaveLength(1);
    expect(secondPage[0].contentHash).toBe(petA.content_hash);
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
      gender: 'Female',
      breed: '',
      breeder: '',
      notes: '',
      tags: ['fast'],
      schemaVersion: 1,
      appVersion: '0.6.3',
      genomeData: '[Overview]\nEntity=Buzz\n[Genes]\n',
      // Rules require `uploadedAt == request.time`, so the only way to
      // satisfy that is to let the server pick the value via the sentinel.
      uploadedAt: serverTimestamp(),
      uploaderUid: null,
    };
  }

  function validDocId() {
    // Any 64-char lowercase hex value passes the rule regex; the rules
    // can't verify hash agreement (the SHA-256 → genomeData binding is
    // enforced client-side via verifySharedPet).
    return 'a'.repeat(64);
  }

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
    const payload = { ...validBasePayload(), nope: 'extra' };
    await expectRejected(setDoc(doc(db, 'pets', validDocId()), payload));
  });

  it('rejects payload missing a required field', async () => {
    const payload = validBasePayload();
    delete payload.name;
    await expectRejected(setDoc(doc(db, 'pets', validDocId()), payload));
  });

  it('rejects species outside the allowed enum', async () => {
    await expectRejected(setDoc(doc(db, 'pets', validDocId()), { ...validBasePayload(), species: 'Dragon' }));
  });

  it('rejects gender outside the allowed enum', async () => {
    await expectRejected(setDoc(doc(db, 'pets', validDocId()), { ...validBasePayload(), gender: 'Other' }));
  });

  it('rejects oversized name (>100 chars)', async () => {
    await expectRejected(setDoc(doc(db, 'pets', validDocId()), { ...validBasePayload(), name: 'x'.repeat(101) }));
  });

  it('rejects oversized genomeData (>64 KiB)', async () => {
    await expectRejected(
      setDoc(doc(db, 'pets', validDocId()), {
        ...validBasePayload(),
        genomeData: 'x'.repeat(65537),
      }),
    );
  });

  it('rejects tags list with >30 entries', async () => {
    await expectRejected(
      setDoc(doc(db, 'pets', validDocId()), {
        ...validBasePayload(),
        tags: Array.from({ length: 31 }, (_, i) => `t${i}`),
      }),
    );
  });

  it('rejects a non-string entry inside tags', async () => {
    await expectRejected(setDoc(doc(db, 'pets', validDocId()), { ...validBasePayload(), tags: ['ok', 42] }));
  });

  it('rejects an over-long tag entry (>64 chars)', async () => {
    await expectRejected(setDoc(doc(db, 'pets', validDocId()), { ...validBasePayload(), tags: ['x'.repeat(65)] }));
  });

  it('rejects uploaderUid != null in v1', async () => {
    await expectRejected(setDoc(doc(db, 'pets', validDocId()), { ...validBasePayload(), uploaderUid: 'someone' }));
  });

  it('rejects doc ID that does not match the SHA-256 hex regex', async () => {
    await expectRejected(setDoc(doc(db, 'pets', 'short-id'), validBasePayload()));
    await expectRejected(setDoc(doc(db, 'pets', 'A'.repeat(64)), validBasePayload())); // uppercase
  });

  it('accepts a fully valid payload', async () => {
    // Positive control — proves the negative tests above are failing for the
    // right reason and not a generic emulator/setup issue.
    await setDoc(doc(db, 'pets', validDocId()), validBasePayload());
    const snap = await getDocs(query(collection(db, 'pets')));
    expect(snap.size).toBe(1);
  });
});

describe('firestore.rules forbids updates and deletes', () => {
  it('rejects update of an existing doc', async () => {
    const pet = await freshPet('U');
    await uploadPet(pet, db);

    let threw = false;
    try {
      await setDoc(doc(db, 'pets', pet.content_hash), { name: 'rewritten' }, { merge: true });
    } catch (e) {
      threw = true;
      expect(String(e)).toMatch(/permission/i);
    }
    expect(threw).toBe(true);
  });

  it('rejects deletion', async () => {
    const pet = await freshPet('D');
    await uploadPet(pet, db);

    let threw = false;
    try {
      await deleteDoc(doc(db, 'pets', pet.content_hash));
    } catch (e) {
      threw = true;
      expect(String(e)).toMatch(/permission/i);
    }
    expect(threw).toBe(true);
  });
});
