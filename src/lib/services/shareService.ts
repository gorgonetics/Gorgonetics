/**
 * Client surface for the public pet sharing catalogue (Firestore `/pets`).
 *
 * The service intentionally takes an optional `db` parameter on every entry
 * point so tests (including the Firestore Emulator integration tests in
 * `tests/integration/`) can inject a non-production Firestore instance
 * without having to mock module-level state. Production callers omit the
 * argument and get the singleton from `$lib/firebase`.
 *
 * Wire-format vs interface conversions are owned here:
 *  - the upload payload does NOT carry `contentHash` (the doc ID is the
 *    hash; `firestore.rules` rejects a payload `contentHash` field).
 *  - `uploadedAt` is sent as `serverTimestamp()` on write and converted
 *    from Firestore `Timestamp` to JS `Date` on read.
 *  - `tags` is sanitized on read to defend against pre-rule documents or
 *    console tampering — non-string entries are dropped.
 */

import {
  collection,
  type DocumentData,
  type DocumentSnapshot,
  doc,
  type Firestore,
  FirestoreError,
  getDoc,
  getDocs,
  orderBy,
  query,
  limit as queryLimit,
  serverTimestamp,
  setDoc,
  startAfter,
  Timestamp,
} from 'firebase/firestore';

import { firestore as defaultFirestore } from '$lib/firebase.js';
import { CURRENT_SCHEMA_VERSION } from '$lib/services/migrationService.js';
import type { Gender, ListPetsOpts, Pet, SharedPet } from '$lib/types/index.js';
import { sha256Hex } from '$lib/utils/hash.js';

declare const __APP_VERSION__: string;
const APP_VERSION = __APP_VERSION__;

const COLLECTION = 'pets';
const DEFAULT_PAGE_SIZE = 50;
const TAG_CAP = 30;
const TAG_MAX_LEN = 64;

export type UploadStatus = 'created' | 'already-shared';

export interface UploadResult {
  status: UploadStatus;
  contentHash: string;
}

/**
 * Upload a local pet to the public catalogue. Idempotent on `content_hash`:
 * if the doc already exists, returns `{ status: 'already-shared' }` without
 * mutating it (rules deny update/delete by design).
 *
 * The caller is responsible for ensuring `pet.content_hash` matches the
 * SHA-256 of `pet.genome_data` — the petService keeps these in sync at
 * insert time, and the import flow rejects mismatched documents.
 */
export async function uploadPet(pet: Pet, db: Firestore = defaultFirestore): Promise<UploadResult> {
  if (!pet.content_hash) {
    throw new Error('uploadPet: pet.content_hash is required');
  }

  const ref = doc(db, COLLECTION, pet.content_hash);

  // Optimistic existence check first: the rules deny update, so a duplicate
  // write would surface as a generic permission-denied that's easy to
  // misdiagnose. A single getDoc is cheap (1 read against the 50k/day Spark
  // quota) and lets us return a clean status to the UI.
  const existing = await getDoc(ref);
  if (existing.exists()) {
    return { status: 'already-shared', contentHash: pet.content_hash };
  }

  const payload = buildUploadPayload(pet);

  try {
    await setDoc(ref, payload);
  } catch (err) {
    // Race: another client uploaded the same content between our read and
    // write. Rules will reject the second create with permission-denied;
    // treat it as 'already-shared' to match the deterministic case above.
    if (err instanceof FirestoreError && err.code === 'permission-denied') {
      const recheck = await getDoc(ref);
      if (recheck.exists()) {
        return { status: 'already-shared', contentHash: pet.content_hash };
      }
    }
    throw err;
  }

  return { status: 'created', contentHash: pet.content_hash };
}

/** Page through the catalogue, newest first. */
export async function listPets(opts: ListPetsOpts = {}, db: Firestore = defaultFirestore): Promise<SharedPet[]> {
  const pageSize = opts.limit ?? DEFAULT_PAGE_SIZE;

  const constraints = [orderBy('uploadedAt', 'desc'), queryLimit(pageSize)];
  if (opts.after) {
    // `startAfter` on an ordered field accepts the field value directly.
    // We previously converted Timestamp → Date on read, so reverse it here.
    constraints.splice(1, 0, startAfter(Timestamp.fromDate(opts.after.uploadedAt)));
  }

  const snap = await getDocs(query(collection(db, COLLECTION), ...constraints));
  return snap.docs.map(toSharedPet);
}

/** Fetch one shared pet by content hash. `null` if no such document. */
export async function getSharedPet(contentHash: string, db: Firestore = defaultFirestore): Promise<SharedPet | null> {
  const snap = await getDoc(doc(db, COLLECTION, contentHash));
  return snap.exists() ? toSharedPet(snap) : null;
}

/**
 * Throws if `pet.genomeData` does not hash to `pet.contentHash`. The import
 * flow MUST call this before inserting a fetched community pet into the
 * local DB — `firestore.rules` cannot enforce hash agreement (it can't run
 * SHA-256 in CEL), so the client is the last line of defence against a
 * malicious uploader putting a misleading hash on arbitrary genome text.
 */
export async function verifySharedPet(pet: SharedPet): Promise<void> {
  const expected = await sha256Hex(pet.genomeData);
  if (expected !== pet.contentHash) {
    throw new Error(
      `verifySharedPet: hash mismatch — contentHash=${pet.contentHash}, ` + `sha256(genomeData)=${expected}`,
    );
  }
}

// --- internals ---

interface UploadPayload {
  name: string;
  character: string;
  species: string;
  gender: Gender;
  breed: string;
  breeder: string;
  notes: string;
  tags: string[];
  schemaVersion: number;
  appVersion: string;
  genomeData: string;
  uploadedAt: ReturnType<typeof serverTimestamp>;
  uploaderUid: string | null;
}

function buildUploadPayload(pet: Pet): UploadPayload {
  return {
    name: pet.name,
    character: extractCharacter(pet.genome_data),
    species: pet.species,
    gender: pet.gender,
    breed: pet.breed,
    breeder: pet.breeder,
    notes: pet.notes ?? '',
    tags: sanitizeTags(pet.tags),
    schemaVersion: CURRENT_SCHEMA_VERSION,
    appVersion: APP_VERSION,
    genomeData: pet.genome_data,
    uploadedAt: serverTimestamp(),
    uploaderUid: null,
  };
}

/**
 * Parse the `Character=` line out of the genome's `[Overview]` block.
 * Returns an empty string if the line isn't present — the rules accept
 * empty strings, and the existing genome format doesn't guarantee a
 * Character line on every export.
 */
function extractCharacter(genomeText: string): string {
  for (const rawLine of genomeText.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith('Character=')) {
      return line.slice('Character='.length).trim();
    }
    if (line.startsWith('[Genes]')) break;
  }
  return '';
}

/**
 * Drop non-string entries and over-long entries, dedupe, and cap at 30 —
 * mirrors the per-element constraint enforced by `isValidTagList` in
 * firestore.rules. Applied symmetrically on upload (defence) and on read
 * (display safety for any pre-rule documents).
 */
function sanitizeTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tags) {
    if (typeof t !== 'string') continue;
    if (t.length === 0 || t.length > TAG_MAX_LEN) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= TAG_CAP) break;
  }
  return out;
}

function toSharedPet(snap: DocumentSnapshot<DocumentData>): SharedPet {
  const data = snap.data() ?? {};
  const uploadedAt = data.uploadedAt instanceof Timestamp ? data.uploadedAt.toDate() : new Date(0);

  return {
    contentHash: snap.id,
    name: typeof data.name === 'string' ? data.name : '',
    character: typeof data.character === 'string' ? data.character : '',
    species: typeof data.species === 'string' ? data.species : '',
    gender: (data.gender === 'Male' || data.gender === 'Female' ? data.gender : 'Male') as Gender,
    breed: typeof data.breed === 'string' ? data.breed : '',
    breeder: typeof data.breeder === 'string' ? data.breeder : '',
    notes: typeof data.notes === 'string' ? data.notes : '',
    tags: sanitizeTags(data.tags),
    schemaVersion: typeof data.schemaVersion === 'number' ? data.schemaVersion : 0,
    appVersion: typeof data.appVersion === 'string' ? data.appVersion : '',
    genomeData: typeof data.genomeData === 'string' ? data.genomeData : '',
    uploadedAt,
    uploaderUid: typeof data.uploaderUid === 'string' ? data.uploaderUid : null,
  };
}

// Exported for tests only — the unit suite asserts the exact upload payload
// shape against firestore.rules without round-tripping through the SDK.
export const __test__ = { buildUploadPayload, extractCharacter, sanitizeTags, toSharedPet };
