/**
 * Reactive state for the Community catalogue browser. Holds the current
 * page of fetched pets, the pagination cursor, the selection, and the
 * load/import status flags. Lives at module scope so cursor + scroll
 * position survive a tab switch back into the Community view within the
 * same session.
 *
 * Fetching and importing themselves live in shareService / petService —
 * this store is the UI glue layer only.
 */

import { isPlaceholderConfig } from '$lib/firebase.js';
import { type ImportResult, importCommunityPet, listPets } from '$lib/services/shareService.js';
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
 * Import the currently-selected community pet into the local stable.
 * The caller (CommunityPetDetail) handles surfacing the toast.
 */
export async function importSelected(): Promise<ImportOutcome> {
  const pet = selectedSharedPet();
  if (!pet) return { status: 'error', message: 'No pet selected' };

  communityView.importingHash = pet.contentHash;
  try {
    return await importCommunityPet(pet);
  } catch (err) {
    return { status: 'error', message: errMsg(err) };
  } finally {
    communityView.importingHash = null;
  }
}
