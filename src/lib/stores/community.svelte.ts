/**
 * Reactive state for the Community catalogue browser. Holds the current
 * page of fetched pets, the pagination cursor, the selection, and the
 * load/import status flags.
 *
 * Caching across tab toggles: `loadInitial` short-circuits whenever the
 * cache is younger than `STALE_AFTER_MS` — including the empty-catalogue
 * case, so an empty result doesn't refetch on every tab toggle. The
 * "Try again" button forces a fresh fetch via
 * `loadInitial({ force: true })`, which also bypasses the in-flight
 * dedupe so a stuck/slow load can be superseded.
 *
 * Fetching and importing themselves live in shareService / petService —
 * this store is the UI glue layer only.
 */

import { isPlaceholderConfig } from '$lib/firebase.js';
import { type ImportResult, importCommunityPet, listPets } from '$lib/services/shareService.js';
import { appState } from '$lib/stores/pets.js';
import type { SharedPet } from '$lib/types/index.js';
import { errorMessage } from '$lib/utils/error.js';

const PAGE_SIZE = 50;
/**
 * How long a `loadInitial` result counts as fresh. Tab toggles within
 * this window reuse the cached page instead of refetching. Five minutes
 * matches the rough cadence of a hobby-catalogue and keeps the store
 * cheap against the Spark 50k-reads/day quota: a user toggling tabs
 * once a minute for an hour burns one full page-fetch (50 reads),
 * not 60.
 */
const STALE_AFTER_MS = 5 * 60 * 1000;

let lastLoadedAt = 0;
/**
 * Monotonic generation counter for in-flight `loadInitial` calls. The
 * non-force path also has a fast-skip on `communityView.loading`, but a
 * force-refresh (the "Try again" button, or any external opt-in) must
 * be able to interrupt a slow in-flight load — and when it does, the
 * older `await listPets` must not be allowed to overwrite the fresher
 * result on resolution. Each call snapshots `loadGeneration` at start
 * and discards its own result on return if the counter has moved.
 */
let loadGeneration = 0;

export const communityView = $state({
  pets: [] as SharedPet[],
  loading: false,
  loadingMore: false,
  error: null as string | null,
  hasMore: true,
  /**
   * Opaque pagination cursor (Firestore `QueryDocumentSnapshot`) for the
   * NEXT page. Tracked separately from `pets` because the SharedPet
   * shape doesn't (and shouldn't) carry server-side nanosecond
   * timestamps — encoding the cursor through
   * `Timestamp.fromDate(uploadedAt)` would truncate to milliseconds and
   * break ordering at page boundaries when two uploads share a
   * millisecond.
   */
  cursor: null as unknown,
  selectedHash: null as string | null,
  /**
   * Hash of the currently-importing pet, or null when no import is in
   * flight. Single-slot rather than per-hash because we serialize imports
   * — kicking off a second one while the first is pending would risk
   * `appState.loadPets()` races and double-toasts.
   */
  importingHash: null as string | null,
});

/**
 * Discover the currently-selected pet from the loaded page. Returns
 * `null` when nothing is selected. The `find` fallback also returns
 * `null` if the selection were ever to fall out of the loaded list,
 * but every code path that mutates `pets` either preserves a
 * still-present selection or synchronously clears `selectedHash`, so
 * the dangling-selection state is currently unreachable.
 *
 * A regular function rather than a `$derived` because `$derived` cannot
 * appear at module scope outside a component context in Svelte 5. Consumers
 * call it inside their own `$derived` to wire reactivity.
 */
export function selectedSharedPet(): SharedPet | null {
  if (!communityView.selectedHash) return null;
  return communityView.pets.find((p) => p.contentHash === communityView.selectedHash) ?? null;
}

/**
 * Load the first page. By default short-circuits when the cached page is
 * fresh (see `STALE_AFTER_MS`) — pass `{ force: true }` to bypass the
 * cache (used by the "Try again" button in the error state).
 *
 * Selection is intentionally preserved across reloads — if the user
 * navigates away from the tab and returns, the pet they were
 * inspecting stays selected (provided it's still in the loaded page).
 */
export async function loadInitial(opts: { force?: boolean } = {}): Promise<void> {
  if (isPlaceholderConfig) {
    communityView.error = 'Public sharing is not configured in this build — see docs/firebase-setup.md.';
    communityView.pets = [];
    communityView.hasMore = false;
    return;
  }
  if (!opts.force) {
    // Skip when a load is already in flight — two concurrent fetches
    // would otherwise both pass the cache check and race to write
    // `communityView.pets` (last-writer-wins, which can leave the
    // store on the older snapshot).
    if (communityView.loading) return;
    // `lastLoadedAt > 0` keeps the first-ever call from short-circuiting
    // against the Unix-epoch delta. An empty catalogue is still
    // considered cached — without this the store would refetch on every
    // tab toggle once the catalogue happened to be empty, burning Spark
    // read quota.
    if (lastLoadedAt > 0 && Date.now() - lastLoadedAt < STALE_AFTER_MS) return;
  }
  const myGeneration = ++loadGeneration;
  communityView.loading = true;
  communityView.error = null;
  try {
    const { pets, cursor } = await listPets({ limit: PAGE_SIZE });
    if (myGeneration !== loadGeneration) return;
    communityView.pets = pets;
    communityView.cursor = cursor;
    communityView.hasMore = pets.length === PAGE_SIZE;
    lastLoadedAt = Date.now();
    // If the previously-selected pet was paginated out of the new first
    // page (e.g., a forced refresh after several uploads pushed it
    // below the cursor), clear the dangling selectedHash so the detail
    // pane returns to the empty state.
    if (communityView.selectedHash && !pets.some((p) => p.contentHash === communityView.selectedHash)) {
      communityView.selectedHash = null;
    }
  } catch (err) {
    if (myGeneration !== loadGeneration) return;
    communityView.error = `Failed to load catalogue: ${errorMessage(err)}`;
    // On error we keep the existing `pets` array so a transient failure
    // doesn't blow away whatever the user was already looking at. The
    // "Try again" button retries with `{ force: true }`.
    if (communityView.pets.length === 0) {
      communityView.cursor = null;
      communityView.hasMore = false;
    }
  } finally {
    if (myGeneration === loadGeneration) communityView.loading = false;
  }
}

/** Append the next page after the last loaded pet. */
export async function loadMore(): Promise<void> {
  if (communityView.loadingMore || !communityView.hasMore) return;
  if (!communityView.cursor) return;
  // Also skip while a first-page load is in flight. Without this,
  // `loadMore` captures the same `loadGeneration` as the upcoming
  // refresh but uses the OLD cursor — when the refresh resolves
  // first the generation check still passes, so the old page-2 lands
  // appended onto the new page-1 (duplicates or gaps at the
  // boundary). The "Load more" button mirrors this gate in
  // CommunityPetTable.
  if (communityView.loading) return;
  // Snapshot the current generation: if a forced `loadInitial` runs
  // in parallel and resets the page (incrementing `loadGeneration`),
  // this pagination request's result is appending against a stale
  // cursor and would corrupt the page boundary — drop it on return.
  const myGeneration = loadGeneration;
  communityView.loadingMore = true;
  communityView.error = null;
  try {
    const { pets, cursor } = await listPets({ limit: PAGE_SIZE, after: communityView.cursor });
    if (myGeneration !== loadGeneration) return;
    communityView.pets = [...communityView.pets, ...pets];
    communityView.cursor = cursor;
    communityView.hasMore = pets.length === PAGE_SIZE;
  } catch (err) {
    if (myGeneration !== loadGeneration) return;
    communityView.error = `Failed to load more: ${errorMessage(err)}`;
  } finally {
    // `loadingMore` is the UI lock that gates the "Load more" button.
    // Clear it on EVERY return path — including the
    // stale-supersession case where the page-state writes are
    // skipped — otherwise a forced refresh during pagination leaves
    // the button permanently disabled. Single-flight is enforced
    // at the top of this function, so no other concurrent loadMore
    // could be relying on the flag.
    communityView.loadingMore = false;
  }
}

/**
 * Test-only escape hatch — resets the module-level `lastLoadedAt`
 * cache stamp and the in-flight generation counter so unit suites
 * can run from a pristine state. Not exported via the public
 * `$lib/stores/community` barrel; only the test file imports it
 * directly. Real callers should not use this.
 */
export function _resetCommunityStoreState(): void {
  lastLoadedAt = 0;
  loadGeneration = 0;
}

export function selectPet(hash: string): void {
  communityView.selectedHash = hash;
}

export function clearSelection(): void {
  communityView.selectedHash = null;
}

/**
 * Import a community pet into the local stable. Caller must pass a *full*
 * SharedPet (with `genomeData` populated) — `listPets` returns metadata
 * only, so the detail component is responsible for lazy-loading the
 * genome via `getSharedPet` before invoking this. The caller
 * (CommunityPetDetail) handles surfacing the toast.
 *
 * Rejects with an `error` result if another import is already in flight:
 * we serialize imports per-store to avoid `appState.loadPets()` races
 * and duplicate toasts.
 */
export async function importSelected(fullPet: SharedPet): Promise<ImportResult> {
  if (communityView.importingHash !== null) {
    return { status: 'error', message: 'Another import is already in progress — wait for it to finish.' };
  }
  communityView.importingHash = fullPet.contentHash;
  try {
    const result = await importCommunityPet(fullPet);
    // Refresh the local pets store so the Pets / Stable views see the change
    // without a manual reload. We deliberately don't await — the toast can
    // land before the background refetch completes. A refresh failure is a
    // UI sync issue, not an import failure; the Pets tab's onMount picks it
    // up on next navigation.
    if (result.status === 'imported') {
      // Fresh insert at MAX(sort_order)+1 — append just that row (#256)
      // instead of an O(N) full reload.
      appState.appendPet(result.pet_id).catch(() => {});
    } else if (result.status === 'already-imported') {
      // Backfill / race-recheck branch mutated an existing row's community
      // tag + genome_text in place, so a targeted append won't reflect it —
      // fall back to a full reload. loadPets() handles its own errors and
      // never rejects, so fire-and-forget with void.
      void appState.loadPets();
    }
    return result;
  } catch (err) {
    return { status: 'error', message: errorMessage(err) };
  } finally {
    communityView.importingHash = null;
  }
}
