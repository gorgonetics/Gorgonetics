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
  startAfter,
  Timestamp,
  writeBatch,
} from 'firebase/firestore';

import { firestore as defaultFirestore } from '$lib/firebase.js';
import { CURRENT_SCHEMA_VERSION } from '$lib/services/migrationService.js';
import {
  findPetByHash,
  getPet,
  getPetGenomeText,
  updatePet,
  uploadPet as uploadPetLocally,
} from '$lib/services/petService.js';
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
  // Re-hash before publishing. `petService.uploadPet` keeps content_hash
  // in sync with genome_text on the insert path, but local rows can also
  // come from backup restore / direct DB writes / older corrupt state
  // where the two have drifted. Publishing a row whose stored
  // content_hash doesn't match sha256(genome_text) would put a catalogue
  // entry on the wire that every importer's `verifySharedPet` rejects —
  // leaving a permanently-broken row. Reject it client-side instead.
  const expectedHash = await sha256Hex(pet.genome_text);
  if (expectedHash !== pet.content_hash) {
    throw new Error(
      `uploadPet: local row is corrupt — sha256(genome_text)=${expectedHash} but pet.content_hash=${pet.content_hash}. Re-import the genome file before sharing.`,
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
        // Verify BOTH halves — a stale `/pets/{hash}` without its
        // `/genomes/{hash}` twin (or vice versa) is a partial-publish
        // state, not an idempotent already-shared. Returning
        // already-shared in that case would mask a catalogue row that
        // lists but cannot be imported, with no way for the client to
        // repair (rules deny update/delete).
        const [metaSnap, genomeSnap] = await Promise.all([getDoc(metaRef), getDoc(genomeRef)]);
        if (metaSnap.exists() && genomeSnap.exists()) {
          // Both docs exist — but Firestore rules only validate the doc
          // ID shape, not that `genomeData` hashes to the ID. A corrupt
          // (or maliciously-squatted) `/genomes/{hash}` doc would let
          // listPets surface a row that fails every importer's
          // `verifySharedPet`. Re-hash here so a legitimate uploader
          // sees the corruption rather than thinking they've already
          // published their pet.
          const genomeData = (genomeSnap.data() as { genomeData?: unknown } | undefined)?.genomeData;
          if (typeof genomeData !== 'string') {
            throw new Error(
              `uploadPet: catalogue entry ${pet.content_hash} is missing a genomeData field — contact an admin to repair.`,
            );
          }
          const onWireHash = await sha256Hex(genomeData);
          if (onWireHash !== pet.content_hash) {
            throw new Error(
              `uploadPet: catalogue entry ${pet.content_hash} is corrupt — sha256(genomeData on wire) = ${onWireHash}. Rules deny overwriting, so contact an admin to repair.`,
            );
          }
          return { status: 'already-shared', contentHash: pet.content_hash };
        }
        if (metaSnap.exists() !== genomeSnap.exists()) {
          throw new Error(
            `uploadPet: catalogue is half-published for hash ${pet.content_hash} (meta=${metaSnap.exists()}, genome=${genomeSnap.exists()}). Contact an admin to repair.`,
          );
        }
      } catch (recheckErr) {
        // Re-throw any of the recheck-time integrity errors we raised
        // above (half-publish / missing field / hash mismatch). For
        // anything else (network hiccup, rules also denying reads,
        // etc.), fall through and surface the original batch error —
        // that's the one the caller can act on.
        if (recheckErr instanceof Error && recheckErr.message.startsWith('uploadPet: catalogue ')) {
          throw recheckErr;
        }
      }
    }
    throw err;
  }
}

/** Per-pet outcome of a bulk share. `skipped` = no shareable genome (legacy). */
export type BulkUploadItemStatus = 'created' | 'already-shared' | 'skipped' | 'failed';

export interface BulkUploadItemResult {
  petId: number;
  petName: string;
  status: BulkUploadItemStatus;
  contentHash?: string;
  /** Present for `failed`/`skipped` — a human-readable reason. */
  error?: string;
}

export interface BulkUploadSummary {
  created: number;
  alreadyShared: number;
  skipped: number;
  failed: number;
  items: BulkUploadItemResult[];
}

export interface UploadPetsOptions {
  /** Reports progress after each pet completes (0…total). */
  onProgress?: (done: number, total: number) => void;
  /** Abort early when this returns true (e.g. a user-cancelled dialog). */
  shouldCancel?: () => boolean;
  db?: Firestore;
  /**
   * Pause between pets, in ms, to stay under Firestore's per-second write
   * quota on large stables (Spark plan). Default 0 (no pause). The delay is
   * applied after each pet that did a network write, never after the last.
   */
  interRequestDelayMs?: number;
  /**
   * When an upload trips a quota / `resource-exhausted` error, retry that pet
   * up to this many times with exponential backoff before giving up and
   * marking it `failed`. Default 0 (no retry). Backoff is
   * `quotaBackoffBaseMs * 2 ** attempt`.
   */
  maxQuotaRetries?: number;
  /** Base delay for quota backoff, in ms. Default 1000. */
  quotaBackoffBaseMs?: number;
  /** Injectable seams for testing. */
  upload?: (pet: Pet, db?: Firestore) => Promise<UploadResult>;
  loadGenomeText?: (petId: number) => Promise<string | null>;
  /** Injectable sleep, for deterministic throttle/backoff tests. */
  sleep?: (ms: number) => Promise<void>;
}

/** Firestore signals a quota / rate breach with code `resource-exhausted`. */
function isResourceExhausted(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'resource-exhausted';
}

/**
 * Share many local pets to the public catalogue, one at a time.
 *
 * Sequential by design: each pet is two Firestore writes, and a burst of
 * hundreds of parallel writes risks tripping Spark-plan quotas and gives no
 * usable progress signal. A single pet failing (network, corruption) never
 * aborts the batch — its error is captured in `items` and the rest proceed.
 *
 * The in-memory pet list drops `genome_text` (see petService LIST_PET_COLUMNS),
 * so the raw genome is loaded per pet here. A pet with no stored genome text
 * (imported before migration v13) can't be shared and is reported as
 * `skipped` rather than `failed` — it needs re-importing, not retrying.
 */
export async function uploadPets(pets: Pet[], options: UploadPetsOptions = {}): Promise<BulkUploadSummary> {
  const upload = options.upload ?? uploadPet;
  const loadGenomeText = options.loadGenomeText ?? getPetGenomeText;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const interRequestDelayMs = options.interRequestDelayMs ?? 0;
  const maxQuotaRetries = options.maxQuotaRetries ?? 0;
  const quotaBackoffBaseMs = options.quotaBackoffBaseMs ?? 1000;
  const items: BulkUploadItemResult[] = [];
  let done = 0;

  for (let index = 0; index < pets.length; index++) {
    const pet = pets[index];
    if (options.shouldCancel?.()) break;
    const petName = pet.name ?? `Pet ${pet.id}`;
    let didNetworkWrite = false;
    try {
      // `genome_text` isn't on the list-projected pet; load it on demand.
      const genomeText = pet.genome_text ?? (await loadGenomeText(pet.id)) ?? undefined;
      if (!genomeText) {
        items.push({
          petId: pet.id,
          petName,
          status: 'skipped',
          error: 'No stored genome text — re-import this pet before sharing.',
        });
        continue;
      }
      didNetworkWrite = true;
      // Retry only on quota / resource-exhausted, backing off exponentially —
      // that's the recoverable "slow down" signal. Any other error (corruption,
      // permission) fails the pet immediately so the batch keeps moving.
      let attempt = 0;
      for (;;) {
        try {
          const result = await upload({ ...pet, genome_text: genomeText }, options.db);
          items.push({
            petId: pet.id,
            petName,
            status: result.status === 'created' ? 'created' : 'already-shared',
            contentHash: result.contentHash,
          });
          break;
        } catch (err) {
          if (isResourceExhausted(err) && attempt < maxQuotaRetries && !options.shouldCancel?.()) {
            await sleep(quotaBackoffBaseMs * 2 ** attempt);
            attempt++;
            continue;
          }
          throw err;
        }
      }
    } catch (err) {
      items.push({ petId: pet.id, petName, status: 'failed', error: errorText(err) });
    } finally {
      done++;
      options.onProgress?.(done, pets.length);
    }
    // Throttle between network writes to ease per-second quota pressure; never
    // after the last pet, and skip when nothing was written (skipped pet).
    if (interRequestDelayMs > 0 && didNetworkWrite && index < pets.length - 1 && !options.shouldCancel?.()) {
      await sleep(interRequestDelayMs);
    }
  }

  return {
    created: items.filter((i) => i.status === 'created').length,
    alreadyShared: items.filter((i) => i.status === 'already-shared').length,
    skipped: items.filter((i) => i.status === 'skipped').length,
    failed: items.filter((i) => i.status === 'failed').length,
    items,
  };
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
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
    //
    // Look up the row by `pet_id` (the operation target) rather than by
    // `content_hash`: if the user deleted the legacy row in the window
    // between `uploadPetLocally` and this read, `findPetByHash` could
    // still resolve to a same-hash row owned by a parallel re-import,
    // and we'd merge against the wrong tag set. `getPet(pet_id)` either
    // returns the row we just updated or `null` if it's been deleted.
    const existing = upload.kind === 'backfilled' ? ((await getPet(upload.pet_id))?.tags ?? []) : [];
    const tagsApplied = await applyImportTags(upload.pet_id, existing, localTag, shared.tags);

    // Apply the shared metadata that wouldn't survive a fresh re-parse
    // of the raw genome. `petService.uploadPet` uses the genome's
    // Entity-derived name and parsed breed by default, so a community
    // pet whose uploader had renamed it (or edited the breed) would
    // otherwise come in under the original parsed values — different
    // from what the user saw in the catalogue preview. Only apply on
    // `kind: 'created'` (a fresh insert); for `kind: 'backfilled'` the
    // local row pre-existed and the user's own edits are authoritative.
    if (upload.kind === 'created') {
      await applyImportMetadata(upload.pet_id, shared);
    }

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
      tags: tagsApplied ? mergeLocalTags([localTag, ...existing, ...shared.tags]) : [],
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
    const applied = await applyImportTags(racer.id, racer.tags ?? [], localTag, shared.tags);
    return {
      status: 'already-imported',
      message: applied
        ? `"${racer.name}" is already in your stable.`
        : `"${racer.name}" is already in your stable. The local tag couldn't be saved — apply it manually if you want it surfaced.`,
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
  // Use the local-only merge (no count cap) — the 30-tag wire cap from
  // `sanitizeTags` is for publishing to Firestore, not for local
  // storage. Applying it here would drop a user's pre-existing tags
  // when the merge crosses the cap; e.g., a pet with 30 user-applied
  // tags would lose one when the community tag is prepended.
  const merged = mergeLocalTags([communityTag, ...existingTags, ...sharedTags]);
  try {
    // Propagate `updatePet`'s actual boolean: `false` means the UPDATE
    // affected zero rows (typically the pet was deleted between the
    // earlier read and now), and the caller needs to know so the
    // user-facing message doesn't claim the tag landed when it didn't.
    return await updatePet(petId, { tags: merged });
  } catch (err) {
    console.warn('importCommunityPet: failed to apply tags to pet', petId, err);
    return false;
  }
}

/**
 * Local-only tag merger for the import flow. Mirrors what
 * `petService.setTagsForPet` will actually do on write:
 *  - normalise each entry with `trim().toLowerCase()`
 *  - dedupe on the normalised form
 *  - drop empty strings (the only constraint setTagsForPet enforces)
 *
 * Deliberately does NOT apply the Firestore wire caps
 * (`TAG_MAX_LEN`, `TAG_CAP`) — `pet_tags.tag` has no length
 * constraint and the 30-tag count cap is meant for what we publish,
 * not what we keep locally. Applying the length cap here would
 * silently delete a user's pre-existing long tag when a community
 * pet imports onto an existing row; applying the count cap would
 * drop pre-existing user tags when the community tag is prepended.
 */
function mergeLocalTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tags) {
    if (typeof t !== 'string') continue;
    const normalized = t.trim().toLowerCase();
    if (normalized.length === 0) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

/**
 * Apply the shared metadata that won't survive a re-parse of the raw
 * genome on the local insert path: name, breed, and gender. The
 * uploader's catalogue preview shows these values, so the importer
 * should land on the same view rather than the parsed-from-Entity
 * defaults. Best-effort — failures are logged but don't fail the
 * whole import (the pet is committed by this point and overrides can
 * still be applied manually).
 */
async function applyImportMetadata(petId: number, shared: SharedPet): Promise<void> {
  const updates: Record<string, unknown> = {};
  if (shared.name) updates.name = shared.name;
  if (shared.gender) updates.gender = shared.gender;
  // `breed` may be the empty string for unstructured genomes — only
  // apply when the uploader explicitly set one, so we don't clobber a
  // locally-parsed breed with empty.
  if (shared.breed) updates.breed = shared.breed;
  if (Object.keys(updates).length === 0) return;
  try {
    await updatePet(petId, updates);
  } catch (err) {
    console.warn('importCommunityPet: failed to apply shared metadata to pet', petId, err);
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
