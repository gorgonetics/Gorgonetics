/**
 * Auto-share-on-import: when the user opts in, freshly imported pets are
 * published to the public community catalogue automatically.
 *
 * Gated by the `community.autoShareOnImport` setting, which is OFF by default —
 * sharing is privacy-sensitive (it publishes a pet to the public Firestore
 * catalogue), so nothing is ever shared unless the user explicitly enables it.
 *
 * Reuses `shareService.uploadPets`, so it inherits the bulk path's guarantees:
 * sequential writes (Spark-quota friendly), per-pet error isolation, idempotent
 * dedupe on `content_hash` (`already-shared`), and skipping legacy rows that
 * have no shareable genome text. Failures never throw out of here — the caller's
 * import must succeed regardless of whether the share did.
 *
 * Attribute gate: a freshly-imported pet only has correct attributes when they
 * were parsed from a structured name (Horse only); otherwise `petService`
 * stores all-50 defaults that the user must hand-edit. Auto-sharing those would
 * publish wrong data with no review, so auto-share only publishes pets whose
 * name parses structurally. Everything else (all BeeWasp, unstructured Horses)
 * is held back for a manual, reviewed share. The catalogue is add-only, so a
 * user who later corrects a manually-shared pet's attributes re-shares to
 * append a superseding entry.
 */
import { get } from 'svelte/store';
import { isPlaceholderConfig } from '$lib/firebase.js';
import { pets } from '$lib/stores/pets.js';
import { settings } from '$lib/stores/settings.js';
import { parseStructuredPetName } from './nameParser.js';
import { type BulkUploadSummary, uploadPets } from './shareService.js';

/** Settings key for the opt-in toggle. */
export const AUTO_SHARE_ON_IMPORT = 'community.autoShareOnImport';

/** True when the setting is on AND this build can actually reach the catalogue. */
export function autoShareEnabled(): boolean {
  return !isPlaceholderConfig && get(settings)[AUTO_SHARE_ON_IMPORT] === true;
}

/**
 * Share the just-imported pets identified by `petIds`, if auto-share is enabled.
 *
 * Resolves the ids against the live `pets` store, so callers must refresh it
 * (`loadPets()`) before calling — both import paths already do. Returns the
 * bulk summary, or `null` when sharing was skipped (disabled, not configured,
 * or nothing to share). Never rejects.
 */
export async function autoShareImportedPets(petIds: number[]): Promise<BulkUploadSummary | null> {
  if (petIds.length === 0 || !autoShareEnabled()) return null;

  const wanted = new Set(petIds);
  // Strip notes: auto-share has no per-pet review step, so — like the bulk-share
  // flow (BulkSharePetDialog) — it must never publish the private local notes
  // field. Opting notes in stays exclusive to per-pet sharing (SharePetDialog).
  const toShare = get(pets)
    .filter((p) => wanted.has(p.id))
    // Only pets with known-good (structured-name-parsed) attributes; skip the
    // rest so we never auto-publish default-50 placeholders.
    .filter((p) => parseStructuredPetName(p.name, p.species) !== null)
    .map((p) => ({ ...p, notes: '' }));
  if (toShare.length === 0) return null;

  try {
    return await uploadPets(toShare);
  } catch (err) {
    // uploadPets isolates per-pet errors internally, so reaching here means an
    // unexpected failure (e.g. genome-text loader throwing). Swallow it — a
    // failed auto-share must never break the import that triggered it.
    console.warn('auto-share on import failed:', err);
    return null;
  }
}

/** One-line, user-facing summary of an auto-share run, or null if nothing notable. */
export function summarizeAutoShare(summary: BulkUploadSummary | null): string | null {
  if (!summary) return null;
  const parts: string[] = [];
  if (summary.created > 0) parts.push(`${summary.created} shared to community`);
  if (summary.alreadyShared > 0) parts.push(`${summary.alreadyShared} already shared`);
  if (summary.failed > 0) parts.push(`${summary.failed} failed to share`);
  return parts.length > 0 ? parts.join(', ') : null;
}
