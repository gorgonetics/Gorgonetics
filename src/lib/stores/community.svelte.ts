/**
 * Reactive state for the Community catalogue browser. Holds the current
 * page of fetched pets, the pagination cursor, the selection, and the
 * load/import status flags. Note that `loadInitial` currently resets the
 * page and clears the selection on every call (the tab remounts on every
 * navigation back), so cursor + selection do NOT in fact survive a tab
 * toggle — caching across toggles is tracked in #243.
 *
 * Fetching and importing themselves live in shareService / petService —
 * this store is the UI glue layer only.
 */

import { isPlaceholderConfig } from '$lib/firebase.js';
import { type ImportResult, importCommunityPet, listPets } from '$lib/services/shareService.js';
import { appState } from '$lib/stores/pets.js';
import type { SharedPet } from '$lib/types/index.js';

export type ImportOutcome = ImportResult;

const PAGE_SIZE = 50;

export const communityView = $state({
  pets: [] as SharedPet[],
  loading: false,
  loadingMore: false,
  error: null as string | null,
  hasMore: true,
  selectedHash: null as string | null,
  /**
   * Hash of the currently-importing pet, or null when no import is in
   * flight. Single-slot rather than per-hash because we serialize imports
   * — kicking off a second one while the first is pending would risk
   * `appState.loadPets()` races and double-toasts.
   */
  importingHash: null as string | null,
});

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Discover the currently-selected pet from the loaded page. Returns null
 * when nothing is selected or the selection was paginated out.
 *
 * A regular function rather than a `$derived` because `$derived` cannot
 * appear at module scope outside a component context in Svelte 5. Consumers
 * call it inside their own `$derived` to wire reactivity.
 */
export function selectedSharedPet(): SharedPet | null {
  if (!communityView.selectedHash) return null;
  return communityView.pets.find((p) => p.contentHash === communityView.selectedHash) ?? null;
}

/** Reset to a fresh first page. */
export async function loadInitial(): Promise<void> {
  if (isPlaceholderConfig) {
    communityView.error = 'Public sharing is not configured in this build — see docs/firebase-setup.md.';
    communityView.pets = [];
    communityView.hasMore = false;
    return;
  }
  communityView.loading = true;
  communityView.error = null;
  communityView.selectedHash = null;
  try {
    const page = await listPets({ limit: PAGE_SIZE });
    communityView.pets = page;
    communityView.hasMore = page.length === PAGE_SIZE;
  } catch (err) {
    communityView.error = `Failed to load catalogue: ${errMsg(err)}`;
    communityView.pets = [];
    communityView.hasMore = false;
  } finally {
    communityView.loading = false;
  }
}

/** Append the next page after the last loaded pet. */
export async function loadMore(): Promise<void> {
  if (communityView.loadingMore || !communityView.hasMore) return;
  const last = communityView.pets.at(-1);
  if (!last) return;
  communityView.loadingMore = true;
  communityView.error = null;
  try {
    const page = await listPets({ limit: PAGE_SIZE, after: last });
    communityView.pets = [...communityView.pets, ...page];
    communityView.hasMore = page.length === PAGE_SIZE;
  } catch (err) {
    communityView.error = `Failed to load more: ${errMsg(err)}`;
  } finally {
    communityView.loadingMore = false;
  }
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
export async function importSelected(fullPet: SharedPet): Promise<ImportOutcome> {
  if (communityView.importingHash !== null) {
    return { status: 'error', message: 'Another import is already in progress — wait for it to finish.' };
  }
  communityView.importingHash = fullPet.contentHash;
  try {
    const result = await importCommunityPet(fullPet);
    // Refresh the local pets store on success so the freshly-imported pet
    // shows up in the Pets / Stable views without a manual reload. We
    // deliberately don't await this — the toast can land before the
    // background refetch completes.
    if (result.status === 'imported') {
      appState.loadPets().catch(() => {
        // The pet is committed locally; a refresh failure is a UI sync
        // issue, not an import failure. The Pets tab's own onMount will
        // pick it up on next navigation.
      });
    }
    return result;
  } catch (err) {
    return { status: 'error', message: errMsg(err) };
  } finally {
    communityView.importingHash = null;
  }
}
