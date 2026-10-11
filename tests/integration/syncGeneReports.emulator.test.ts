/**
 * The Firestore adapter of scripts/sync-gene-reports.mjs against the
 * Firestore Emulator: page order by (submittedAt, doc ID) including equal
 * timestamps, the cursor round trip at stored precision, and the
 * per-gene count. The sync logic itself is unit-tested with fakes.
 *
 * Run with `pnpm test:firestore`.
 */

import { type App, deleteApp, initializeApp } from 'firebase-admin/app';
import * as firestoreModule from 'firebase-admin/firestore';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { firestoreStore } from '../../scripts/sync-gene-reports.mjs';

const EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? 'localhost:8080';
const PROJECT_ID = `demo-gorgonetics-sync-${Date.now()}`;

let app: App;
let db: firestoreModule.Firestore;
let store: ReturnType<typeof firestoreStore>;

beforeAll(() => {
  process.env.FIRESTORE_EMULATOR_HOST = EMULATOR_HOST;
  app = initializeApp({ projectId: PROJECT_ID }, `sync-test-${PROJECT_ID}`);
  db = firestoreModule.getFirestore(app);
  store = firestoreStore(firestoreModule, db);
});

afterAll(async () => {
  await deleteApp(app);
});

afterEach(async () => {
  const res = await fetch(`http://${EMULATOR_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error(`emulator clear failed: HTTP ${res.status}`);
});

function put(id: string, gene: string, seconds: number, nanoseconds = 0) {
  return db
    .collection('geneReports')
    .doc(id)
    .set({
      species: 'horse',
      gene,
      bundledDominant: 'Toughness+',
      bundledRecessive: 'None',
      proposedDominant: 'Ruggedness+',
      proposedRecessive: 'None',
      note: '',
      templateBundleHash: 'c'.repeat(64),
      appVersion: '0.10.3',
      schemaVersion: 1,
      submittedAt: new firestoreModule.Timestamp(seconds, nanoseconds),
    });
}

const FAR_FUTURE = { seconds: 4_000_000_000, nanoseconds: 0 };

describe('firestoreStore', () => {
  it('returns only reports submitted before the cut-off', async () => {
    await put('a'.repeat(64), '01A1', 100);
    await put('b'.repeat(64), '01A2', 200);
    const page = await store.pageAfter(null, 10, { seconds: 150, nanoseconds: 0 });
    expect(page.map((r) => r.id[0])).toEqual(['a']);
  });

  it('pages in (submittedAt, doc ID) order, including equal timestamps', async () => {
    await put('c'.repeat(64), '01A1', 100);
    await put('a'.repeat(64), '01A2', 100);
    await put('b'.repeat(64), '01A3', 50);
    await put('d'.repeat(64), '01A4', 100, 1000);

    const ids: string[] = [];
    let after = null;
    for (;;) {
      const page = await store.pageAfter(after, 1, FAR_FUTURE);
      if (page.length === 0) break;
      ids.push(page[0].id[0]);
      after = { submittedAt: page[0].submittedAt, docId: page[0].id };
    }
    expect(ids).toEqual(['b', 'a', 'c', 'd']);
  });

  it('round-trips the cursor at full stored precision', async () => {
    expect(await store.readCursor()).toBeNull();
    // Firestore keeps timestamps to the microsecond, as server timestamps
    // are, so a cursor taken from a report round-trips exactly.
    const cursor = { submittedAt: { seconds: 1_790_000_000, nanoseconds: 123_456_000 }, docId: 'a'.repeat(64) };
    await store.writeCursor(cursor);
    expect(await store.readCursor()).toEqual(cursor);
  });

  it('counts every report of one gene on the server', async () => {
    await put('a'.repeat(64), '26B3', 1);
    await put('b'.repeat(64), '26B3', 2);
    await put('c'.repeat(64), '26B4', 3);
    expect(await store.countForGene('horse', '26B3')).toBe(2);
    expect(await store.countForGene('horse', '01A1')).toBe(0);
  });
});
