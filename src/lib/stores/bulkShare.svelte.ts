/**
 * Background bulk-share job — the "Share all pets" flow.
 *
 * Runs `shareService.uploadPets` fire-and-forget so the app stays interactive
 * while a (potentially large) stable uploads. State is module-scoped, so it
 * survives tab switches and component unmounts; the global BulkShareProgress
 * component renders it wherever the user navigates.
 *
 * Throttled by default (inter-request delay + exponential backoff on Firestore
 * `resource-exhausted`) so a few-hundred-pet share doesn't trip the Spark-plan
 * per-second write quota.
 */
import { isPlaceholderConfig } from '$lib/firebase.js';
import { type BulkUploadSummary, uploadPets } from '$lib/services/shareService.js';
import type { Pet } from '$lib/types/index.js';

/** Pause between pets. Conservative: ~6–7 writes/s keeps clear of Spark limits. */
const SHARE_ALL_DELAY_MS = 150;
/** Retries per pet on a quota breach before it's marked failed. */
const SHARE_ALL_QUOTA_RETRIES = 5;

export type BulkShareStatus = 'idle' | 'running' | 'done';

export const bulkShareJob = $state({
  status: 'idle' as BulkShareStatus,
  total: 0,
  done: 0,
  summary: null as BulkUploadSummary | null,
  /** Batch-wide failure (e.g. genome loader threw); per-pet errors live in `summary`. */
  error: null as string | null,
});

let cancelRequested = false;

/** Fraction complete, 0–100. */
export function bulkSharePercent(): number {
  return bulkShareJob.total > 0 ? Math.round((bulkShareJob.done / bulkShareJob.total) * 100) : 0;
}

/**
 * Start sharing `pets` in the background. No-op when a job is already running,
 * the list is empty, or this build can't reach the catalogue. Does NOT await the
 * upload — returns once the job is kicked off; callers read `bulkShareJob`.
 */
export function startBulkShare(pets: Pet[]): void {
  if (bulkShareJob.status === 'running' || pets.length === 0 || isPlaceholderConfig) return;

  cancelRequested = false;
  bulkShareJob.status = 'running';
  bulkShareJob.total = pets.length;
  bulkShareJob.done = 0;
  bulkShareJob.summary = null;
  bulkShareJob.error = null;

  // Notes are intentionally dropped from bulk shares — there's no per-pet
  // review step, so the local notes field is never published (mirrors
  // BulkSharePetDialog). Per-pet sharing remains the way to opt notes in.
  const petsToShare = pets.map((p) => ({ ...p, notes: '' }));

  void (async () => {
    try {
      bulkShareJob.summary = await uploadPets(petsToShare, {
        interRequestDelayMs: SHARE_ALL_DELAY_MS,
        maxQuotaRetries: SHARE_ALL_QUOTA_RETRIES,
        onProgress: (d) => {
          bulkShareJob.done = d;
        },
        shouldCancel: () => cancelRequested,
      });
    } catch (err) {
      bulkShareJob.error = err instanceof Error ? err.message : String(err);
    } finally {
      bulkShareJob.status = 'done';
    }
  })();
}

/** Request cancellation; pets already uploaded stay shared. */
export function cancelBulkShare(): void {
  cancelRequested = true;
}

/** Clear a finished job's banner. No-op while running. */
export function dismissBulkShare(): void {
  if (bulkShareJob.status !== 'done') return;
  bulkShareJob.status = 'idle';
  bulkShareJob.summary = null;
  bulkShareJob.error = null;
  bulkShareJob.total = 0;
  bulkShareJob.done = 0;
}
