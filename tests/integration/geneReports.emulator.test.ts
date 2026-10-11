/**
 * `firestore.rules` for `/geneReports` against the Firestore Emulator.
 *
 * Each negative case breaks one clause of `isValidGeneReport` on an
 * otherwise valid payload, so a pass proves that clause rejects it; the
 * positive controls prove the setup itself accepts a valid report.
 *
 * Run with `pnpm test:firestore` (see shareService.emulator.test.ts).
 */

import { deleteApp, type FirebaseApp, initializeApp } from 'firebase/app';
import {
  collection,
  connectFirestoreEmulator,
  deleteDoc,
  doc,
  type Firestore,
  getDoc,
  getDocs,
  getFirestore,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
} from 'firebase/firestore';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { GeneReport } from '$lib/types/index.js';

const COLLECTION = 'geneReports';
const EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST?.split(':')[0] ?? 'localhost';
const EMULATOR_PORT = Number(process.env.FIRESTORE_EMULATOR_HOST?.split(':')[1] ?? 8080);
const PROJECT_ID = `demo-gorgonetics-reports-${Date.now()}`;

let app: FirebaseApp;
let db: Firestore;

beforeAll(() => {
  app = initializeApp({ projectId: PROJECT_ID }, `gene-report-test-${PROJECT_ID}`);
  db = getFirestore(app);
  connectFirestoreEmulator(db, EMULATOR_HOST, EMULATOR_PORT);
});

afterAll(async () => {
  await deleteApp(app);
});

afterEach(async () => {
  // Rules deny SDK deletes; clear through the emulator REST endpoint. Every
  // test reuses DOC_ID, so a failed clear would turn the next create into an
  // update — denied for the wrong reason. Fail loudly instead.
  const res = await fetch(
    `http://${EMULATOR_HOST}:${EMULATOR_PORT}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
    { method: 'DELETE' },
  );
  if (!res.ok) throw new Error(`emulator clear failed: HTTP ${res.status}`);
});

const DOC_ID = 'b'.repeat(64);

function validReport(): GeneReport {
  return {
    species: 'horse',
    gene: '26B3',
    bundledDominant: 'Toughness+',
    bundledRecessive: 'None',
    proposedDominant: 'Ruggedness+',
    proposedRecessive: 'None',
    note: '',
    templateBundleHash: 'c'.repeat(64),
    appVersion: '0.10.3',
    schemaVersion: 1,
  };
}

function write(override: Record<string, unknown> = {}, id = DOC_ID) {
  return setDoc(doc(db, COLLECTION, id), { ...validReport(), submittedAt: serverTimestamp(), ...override });
}

/** Only a rules denial counts: an SDK-side `invalid-argument` never reached the rules. */
async function expectRejected(promise: Promise<unknown>) {
  let threw = false;
  try {
    await promise;
  } catch (e) {
    threw = true;
    expect((e as { code?: string }).code).toBe('permission-denied');
  }
  expect(threw).toBe(true);
}

describe('firestore.rules — /geneReports create', () => {
  it('accepts a valid horse report', async () => {
    await write();
  });

  it('accepts a valid beewasp report', async () => {
    await write({ species: 'beewasp', gene: '01A1', proposedDominant: 'Ferocity-' });
  });

  it('accepts a report that changes only the recessive effect', async () => {
    await write({ proposedDominant: 'Toughness+', proposedRecessive: 'Virility-' });
  });

  it('accepts a 1000-char note and a 32-char appVersion', async () => {
    await write({ note: 'x'.repeat(1000), appVersion: 'v'.repeat(32) });
  });

  it.each([
    'species',
    'gene',
    'bundledDominant',
    'bundledRecessive',
    'proposedDominant',
    'proposedRecessive',
    'note',
    'templateBundleHash',
    'appVersion',
    'schemaVersion',
  ])('rejects a report missing %s', async (field) => {
    const report: Record<string, unknown> = { ...validReport(), submittedAt: serverTimestamp() };
    delete report[field];
    await expectRejected(setDoc(doc(db, COLLECTION, DOC_ID), report));
  });

  it('rejects a report missing submittedAt', async () => {
    await expectRejected(setDoc(doc(db, COLLECTION, DOC_ID), validReport()));
  });

  it.each([
    ['an extra field', { extra: 'x' }],
    ['an unknown species', { species: 'dragon' }],
    ['a capitalised species', { species: 'Horse' }],
    ['a non-string species', { species: 1 }],
    ['a non-string gene', { gene: 263 }],
    ['a malformed gene ID', { gene: '26B' }],
    ['a gene ID with a two-digit tail', { gene: '26B31' }],
    ['a lower-case gene ID', { gene: '26b3' }],
    ['an unknown effect', { proposedDominant: 'Speed+' }],
    ['an effect without a sign', { proposedDominant: 'Toughness' }],
    ['a beewasp effect on a horse', { proposedDominant: 'Ferocity+' }],
    ['a horse effect on a beewasp', { species: 'beewasp', proposedDominant: 'Temperament+' }],
    ['a bad bundled effect', { bundledRecessive: 'Nothing' }],
    ['a proposal equal to the bundled values', { proposedDominant: 'Toughness+' }],
    ['a note over 1000 chars', { note: 'x'.repeat(1001) }],
    ['a non-string note', { note: 5 }],
    ['a short templateBundleHash', { templateBundleHash: 'c'.repeat(63) }],
    ['an upper-case templateBundleHash', { templateBundleHash: 'C'.repeat(64) }],
    ['a non-string templateBundleHash', { templateBundleHash: 7 }],
    ['a padded templateBundleHash', { templateBundleHash: 'c'.repeat(5000) }],
    ['an empty appVersion', { appVersion: '' }],
    ['a 33-char appVersion', { appVersion: 'v'.repeat(33) }],
    ['a non-string appVersion', { appVersion: 10 }],
    ['schemaVersion 2', { schemaVersion: 2 }],
    ['a non-integer schemaVersion', { schemaVersion: 1.5 }],
    ['a string schemaVersion', { schemaVersion: '1' }],
    ['a client-set submittedAt', { submittedAt: Timestamp.fromMillis(0) }],
    ['a non-timestamp submittedAt', { submittedAt: 'now' }],
  ])('rejects %s', async (_label, override) => {
    await expectRejected(write(override));
  });

  it.each(['bundledDominant', 'bundledRecessive', 'proposedDominant', 'proposedRecessive'])(
    'rejects a non-string %s',
    async (field) => {
      await expectRejected(write({ [field]: 1 }));
    },
  );

  it.each([
    ['a short ID', 'short-id'],
    ['an upper-case hex ID', 'B'.repeat(64)],
  ])('rejects a doc ID that is %s', async (_label, id) => {
    await expectRejected(write({}, id));
  });
});

describe('firestore.rules — /geneReports after create', () => {
  it('rejects a second create with the same ID', async () => {
    await write();
    await expectRejected(write());
  });

  it('rejects an update', async () => {
    await write();
    await expectRejected(updateDoc(doc(db, COLLECTION, DOC_ID), { note: 'changed' }));
  });

  it('rejects a delete', async () => {
    await write();
    await expectRejected(deleteDoc(doc(db, COLLECTION, DOC_ID)));
  });

  it('allows a get by ID, so a denied create can be checked for a duplicate', async () => {
    await write();
    const snap = await getDoc(doc(db, COLLECTION, DOC_ID));
    expect(snap.exists()).toBe(true);
    expect(snap.data()?.gene).toBe('26B3');
  });

  it('a get by an unknown ID finds nothing', async () => {
    const snap = await getDoc(doc(db, COLLECTION, 'd'.repeat(64)));
    expect(snap.exists()).toBe(false);
  });

  it('rejects a collection query', async () => {
    await expectRejected(getDocs(collection(db, COLLECTION)));
  });
});
