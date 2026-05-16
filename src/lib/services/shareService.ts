/**
 * Client surface for the public pet sharing catalogue.
 *
 * The catalogue is split across two Firestore collections:
 *   /pets/{contentHash}     — metadata only (name, tags, attribution, …)
 *   /genomes/{contentHash}  — the raw genome text, keyed by the same hash
 * so the list view can page metadata without dragging 64 KiB-cap genome
 * blobs across the wire. `listPets` only touches `/pets`; `getSharedPet`
 * reads both halves in parallel and returns the combined record.
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
  getDoc,
  getDocs,
  orderBy,
  query,
  limit as queryLimit,
  serverTimestamp,
  setDoc,
  startAfter,
  Timestamp,
  writeBatch,
} from 'firebase/firestore';

import { firestore as defaultFirestore } from '$lib/firebase.js';
import { CURRENT_SCHEMA_VERSION } from '$lib/services/migrationService.js';
import { findPetByHash, updatePet, uploadPet as uploadPetLocally } from '$lib/services/petService.js';
import { Gender, type ListPetsOpts, type Pet, type SharedPet, type SharedPetsPage } from '$lib/types/index.js';
import { sha256Hex } from '$lib/utils/hash.js';

declare const __APP_VERSION__: string;
const APP_VERSION = __APP_VERSION__;

const META_COLLECTION = 'pets';
const GENOME_COLLECTION = 'genomes';
const DEFAULT_PAGE_SIZE = 50;
const TAG_CAP = 30;
const TAG_MAX_LEN = 64;
/** Default local tag applied to pets imported from the community catalogue. */
const COMMUNITY_TAG = 'community';

export type UploadStatus = 'created' | 'already-shared';

export interface UploadResult {
  status: UploadStatus;
  contentHash: string;
}

/**
 * Upload a local pet to the public catalogue. Idempotent on `content_hash`:
 * if the doc already exists, rules deny the create (update/delete are also
 * denied by design) and we surface that as `{ status: 'already-shared' }`
 * after a single recheck — strictly cheaper than a precondition getDoc on
 * the common new-upload path.
 *
 * Writes the metadata and the genome blob atomically via `writeBatch`, so
 * a partial write (e.g. metadata committed but genome rejected) cannot
 * leave the catalogue in an inconsistent state.
 *
 * The caller is responsible for ensuring `pet.content_hash` matches the
 * SHA-256 of `pet.genome_text` (the raw file text used as the wire
 * payload). petService keeps these in sync at insert time, and the
 * import flow re-hashes via `verifySharedPet` to reject mismatched docs.
 */
export async function uploadPet(pet: Pet, db: Firestore = defaultFirestore): Promise<UploadResult> {
  if (!pet.content_hash) {
    throw new Error('uploadPet: pet.content_hash is required');
  }
  // `pet.genome_text` is the raw genome file text whose SHA-256 is the
  // doc ID. `pet.genome_data` is the parsed-and-JSON-stringified form,
  // whose hash would NOT match — using it on the wire would break the
  // hash-verify check on the importer side. See migration v13.
  if (!pet.genome_text) {
    throw new Error(
      'uploadPet: pet.genome_text is required. Pets imported before migration v13 ' +
        'do not have the raw genome text on file and must be re-imported before sharing.',
    );
  }

  const metaRef = doc(db, META_COLLECTION, pet.content_hash);
  const genomeRef = doc(db, GENOME_COLLECTION, pet.content_hash);

  try {
    const batch = writeBatch(db);
    batch.set(metaRef, buildMetadataPayload(pet));
    batch.set(genomeRef, { genomeData: pet.genome_text });
    await batch.commit();
    return { status: 'created', contentHash: pet.content_hash };
  } catch (err) {
    // The only rules-allowed reason for permission-denied on this path is
    // that one (or both) of the docs already exists (create is denied
    // because it isn't a create; update/delete are denied unconditionally).
    // A recheck disambiguates that from a genuinely misconfigured rules
    // deploy. Duck-typed on `.code` because instanceof FirestoreError is
    // fragile across module-graph re-instantiations (mocks, bundling).
    if (isPermissionDenied(err)) {
      try {
        const recheck = await getDoc(metaRef);
        if (recheck.exists()) {
          return { status: 'already-shared', contentHash: pet.content_hash };
        }
      } catch {
        // Recheck itself failed (network/emulator hiccup, rules also
        // denying reads, etc.). Fall through and surface the original
        // batch error — that's the one the caller can act on.
      }
    }
    throw err;
  }
}

/**
 * Page through the catalogue, newest first. Returns metadata-only
 * `SharedPet`s — the `genomeData` field is `undefined` on every entry to
 * keep payloads small. Call `getSharedPet(hash)` to fetch the genome
 * blob for a single row when the user actually wants to import/preview.
 *
 * Pagination uses Firestore `QueryDocumentSnapshot` as the cursor. The
 * snapshot carries the full server-side ordering tuple (nanosecond
 * `uploadedAt` + document path as tiebreaker), which a manually-encoded
 * `Timestamp.fromDate(date)` cursor cannot — JS `Date` truncates to
 * milliseconds, and same-millisecond uploads have undefined order
 * without the doc-path tiebreaker.
 */
export async function listPets(opts: ListPetsOpts = {}, db: Firestore = defaultFirestore): Promise<SharedPetsPage> {
  const pageSize = opts.limit ?? DEFAULT_PAGE_SIZE;
  const constraints = opts.after
    ? [orderBy('uploadedAt', 'desc'), startAfter(opts.after), queryLimit(pageSize)]
    : [orderBy('uploadedAt', 'desc'), queryLimit(pageSize)];

  const snap = await getDocs(query(collection(db, META_COLLECTION), ...constraints));
  return {
    pets: snap.docs.map(toMetadataSharedPet),
    cursor: snap.docs.length > 0 ? snap.docs[snap.docs.length - 1] : null,
  };
}

/**
 * Fetch one shared pet by content hash, **including its genome**. Returns
 * `null` if the metadata document is missing; missing/inconsistent genome
 * is surfaced as `genomeData: undefined` so the caller can decide whether
 * to retry or treat as broken. The two reads run in parallel.
 */
export async function getSharedPet(contentHash: string, db: Firestore = defaultFirestore): Promise<SharedPet | null> {
  const [metaSnap, genomeSnap] = await Promise.all([
    getDoc(doc(db, META_COLLECTION, contentHash)),
    getDoc(doc(db, GENOME_COLLECTION, contentHash)),
  ]);
  if (!metaSnap.exists()) return null;

  const pet = toMetadataSharedPet(metaSnap);
  const genomeData = genomeSnap.exists() ? (genomeSnap.data().genomeData as unknown) : undefined;
  pet.genomeData = typeof genomeData === 'string' ? genomeData : undefined;
  return pet;
}

/**
 * Throws if `pet.genomeData` does not hash to `pet.contentHash`. The import
 * flow MUST call this before inserting a fetched community pet into the
 * local DB — `firestore.rules` cannot enforce hash agreement (it can't run
 * SHA-256 in CEL), so the client is the last line of defence against a
 * malicious uploader putting a misleading hash on arbitrary genome text.
 */
export async function verifySharedPet(pet: SharedPet): Promise<void> {
  if (!pet.genomeData) {
    throw new Error('verifySharedPet: genomeData is missing — call getSharedPet to load the genome before verifying');
  }
  const expected = await sha256Hex(pet.genomeData);
  if (expected !== pet.contentHash) {
    throw new Error(`verifySharedPet: hash mismatch — contentHash=${pet.contentHash}, sha256(genomeData)=${expected}`);
  }
}

export type ImportResult =
  | { status: 'imported'; message: string; pet_id: number; tags: string[] }
  | { status: 'already-imported'; message: string; pet_id: number }
  | { status: 'error'; message: string };

/**
 * Import a fetched community pet into the local stable. Requires
 * `shared.genomeData` to be populated (caller should fetch via
 * `getSharedPet`, not just `listPets`).
 *
 * Flow: verify hash → delegate the insert/dedup decision to
 * `petService.uploadPet` (it owns the content_hash UNIQUE constraint and
 * the legacy-row-backfill branch from migration v13) → apply the
 * community tag to whichever row resulted.
 *
 * Three success-shaped outcomes from petService:
 *  - `kind: 'created'`   → fresh pet, status `'imported'`.
 *  - `kind: 'backfilled'` → user already had a legacy row with the same
 *    content_hash but empty `genome_text`; petService filled it. We
 *    return `'already-imported'` (the pet was indeed already there) but
 *    apply the community tag, so the row is now shareable AND marked as
 *    a community import.
 *  - `status: 'error'` with the duplicate message → a different importer
 *    raced us; recheck and map to `'already-imported'`.
 */
export async function importCommunityPet(shared: SharedPet, opts: { tag?: string } = {}): Promise<ImportResult> {
  await verifySharedPet(shared);
  // verifySharedPet narrows shared.genomeData to a string but TS doesn't
  // see across the throw — assert here.
  const genomeData = shared.genomeData as string;

  const upload = await uploadPetLocally(genomeData, {
    name: shared.name,
    gender: shared.gender,
    notes: shared.notes,
    sourcePath: `community:${shared.contentHash}`,
  });

  const localTag = opts.tag ?? COMMUNITY_TAG;

  if (upload.status === 'success' && upload.pet_id) {
    // Merge the community tag (+ uploader tags) with whatever already
    // lived on the local row — for `kind: 'backfilled'` the row is a
    // pre-existing legacy pet that may carry user-applied tags we must
    // preserve. For `kind: 'created'` the merge is a no-op (the pet was
    // just inserted with no tags).
    const existing = upload.kind === 'backfilled' ? (await findPetByHash(shared.contentHash))?.tags ?? [] : [];
    const tagsApplied = await applyImportTags(upload.pet_id, existing, localTag, shared.tags);
    if (upload.kind === 'backfilled') {
      return {
        status: 'already-imported',
        message: tagsApplied
          ? `Linked existing "${upload.name ?? shared.name}" to the community version and tagged it.`
          : `Linked existing "${upload.name ?? shared.name}" to the community version. The local tag couldn't be saved — apply it manually if you want it surfaced.`,
        pet_id: upload.pet_id,
      };
    }
    return {
      status: 'imported',
      message: tagsApplied
        ? `Imported "${shared.name}" to your stable.`
        : `Imported "${shared.name}" but the local tag couldn't be saved — apply it manually if you want it surfaced.`,
      pet_id: upload.pet_id,
      tags: tagsApplied ? sanitizeTags([localTag, ...shared.tags]) : [],
    };
  }

  // Failure path: typically the petService duplicate check rejected a
  // truly identical pet (already-shared, non-legacy). Recheck so the
  // result is the idempotent `already-imported` rather than a flat error
  // — and apply the community tag to the existing row so the contract
  // ("community imports are tagged automatically") holds even when the
  // pet pre-existed locally.
  const racer = await findPetByHash(shared.contentHash);
  if (racer) {
    await applyImportTags(racer.id, racer.tags ?? [], localTag, shared.tags);
    return {
      status: 'already-imported',
      message: `"${racer.name}" is already in your stable.`,
      pet_id: racer.id,
    };
  }
  return { status: 'error', message: upload.message };
}

/**
 * Merge the community tag (and the uploader's tags) with whatever the
 * local row already had, then write the union back via the public
 * `updatePet` entry point. Returns `true` when the write committed,
 * `false` when it failed — the caller decides whether a tag-write
 * failure should be surfaced in the user-facing message. The import
 * itself stays committed either way; forcing the user to retry the
 * whole flow over a tag write would just push them into the
 * already-imported branch on the next attempt.
 */
async function applyImportTags(
  petId: number,
  existingTags: string[],
  communityTag: string,
  sharedTags: string[],
): Promise<boolean> {
  // sanitizeTags handles dedupe, length cap, and the 30-tag count cap —
  // running it over the combined list normalises the local tag the same
  // way uploader tags get normalised and avoids a separate dedupe step.
  const merged = sanitizeTags([communityTag, ...existingTags, ...sharedTags]);
  try {
    await updatePet(petId, { tags: merged });
    return true;
  } catch (err) {
    console.warn('importCommunityPet: failed to apply tags to pet', petId, err);
    return false;
  }
}

/**
 * Drop non-string entries and over-long entries, dedupe, and cap at 30 —
 * mirrors the per-element constraint enforced by `isValidTagList` in
 * firestore.rules. Applied symmetrically on upload (defence) and on read
 * (display safety for any pre-rule documents). Exported because PR 3's
 * "preview before upload" dialog will want to show the same normalised
 * list the user is about to publish.
 */
export function sanitizeTags(tags: unknown): string[] {
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

// --- internals ---

function isPermissionDenied(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'permission-denied';
}

function buildMetadataPayload(pet: Pet) {
  // Pet.breeder holds the genome's [Overview] Character= value (set by
  // petService.uploadPet at insert time), so we don't re-parse here.
  return {
    name: pet.name,
    character: pet.breeder,
    species: pet.species,
    gender: pet.gender,
    breed: pet.breed,
    breeder: pet.breeder,
    notes: pet.notes ?? '',
    tags: sanitizeTags(pet.tags),
    schemaVersion: CURRENT_SCHEMA_VERSION,
    appVersion: APP_VERSION,
    uploadedAt: serverTimestamp(),
    uploaderUid: null as string | null,
  };
}

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const num = (v: unknown, fallback = 0): number => (typeof v === 'number' ? v : fallback);
const strOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null);

function toMetadataSharedPet(snap: DocumentSnapshot<DocumentData>): SharedPet {
  const data = snap.data() ?? {};
  const uploadedAt = data.uploadedAt instanceof Timestamp ? data.uploadedAt.toDate() : new Date(0);
  const gender = data.gender === Gender.MALE || data.gender === Gender.FEMALE ? data.gender : Gender.MALE;

  return {
    contentHash: snap.id,
    name: str(data.name),
    character: str(data.character),
    species: str(data.species),
    gender,
    breed: str(data.breed),
    breeder: str(data.breeder),
    notes: str(data.notes),
    tags: sanitizeTags(data.tags),
    schemaVersion: num(data.schemaVersion),
    appVersion: str(data.appVersion),
    // genomeData is intentionally absent on metadata-only reads.
    uploadedAt,
    uploaderUid: strOrNull(data.uploaderUid),
  };
}
