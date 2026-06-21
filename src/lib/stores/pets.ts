import { derived, type Writable, writable } from 'svelte/store';
import type { UploadPetOptions } from '$lib/services/petService.js';
import * as petService from '$lib/services/petService.js';
import type { Pet } from '$lib/types/index.js';
import { errorMessage } from '$lib/utils/error.js';

export type Tab = 'pets' | 'editor' | 'compare' | 'stable' | 'breeding' | 'community' | 'library' | 'reference';

/** Boolean pet flags toggled in-place via `setPetMarker` (no full reload). */
export type MarkerKey = 'starred' | 'stabled' | 'is_pet_quality';

export const pets: Writable<Pet[]> = writable([]);
export const selectedPet: Writable<Pet | null> = writable(null);
export const loading = writable(false);
export const error: Writable<string | null> = writable(null);
export const geneEditingView: Writable<unknown> = writable(null);
export const activeTab: Writable<Tab> = writable('pets');

// Bounded back-stack of previously-active tabs (oldest first, newest last),
// driving the TopBar "back" control (#276). Capped so long sessions of tab
// hopping don't grow it without bound.
const MAX_TAB_HISTORY = 50;
const tabHistory: Writable<Tab[]> = writable([]);
/** True when `appState.goBack()` has a previous tab to return to. */
export const canGoBack = derived(tabHistory, (h) => h.length > 0);

/** All unique tags across all pets, sorted. Shared by PetEditor and PetList. */
export const allTags = derived(pets, ($pets) => [...new Set($pets.flatMap((p) => p.tags ?? []))].sort());

function getCurrentValue<T>(store: Writable<T>): T | undefined {
  let value: T | undefined;
  const unsubscribe = store.subscribe((v) => (value = v));
  unsubscribe();
  return value;
}

const clearSelectionAndGeneView = () => {
  selectedPet.set(null);
  geneEditingView.set(null);
};

/**
 * Per-tab state-reset hook for `switchTab`. Keyed by the full `Tab`
 * union so the compiler catches a missed branch when a new tab is added.
 */
const TAB_STATE_RESETS: Record<Tab, () => void> = {
  pets: () => geneEditingView.set(null),
  editor: () => selectedPet.set(null),
  compare: clearSelectionAndGeneView,
  stable: clearSelectionAndGeneView,
  breeding: clearSelectionAndGeneView,
  community: clearSelectionAndGeneView,
  // The Library drives its own selection (libraryView.selectedIds); clear the
  // legacy single-pet/gene-edit state so it can't leak into the workspace.
  library: clearSelectionAndGeneView,
  // Reference (gene-template editing) is its own destination, like 'editor';
  // clear any selected pet so the legacy detail view doesn't bleed through.
  reference: () => selectedPet.set(null),
};

// Monotonic generation counter for in-flight `loadPets` calls. Concurrent
// callers (auto-scan + community import + manual upload finishing in any
// order) all race to `pets.set(items)` — without this guard the older
// `getAllPets()` result can resolve last and overwrite a fresher list,
// leaving the Pets/Stable tab on a stale snapshot until the next refresh.
let loadGeneration = 0;

// Tracks the latest in-flight `setPetMarker` op per `${petId}:${key}`. A
// rapid re-toggle of the same marker supersedes the earlier op; when an
// earlier (now-stale) write later fails, its rollback/error must be skipped
// so it can't clobber the newer optimistic value or flash a stale error.
let markerOpSeq = 0;
const markerOps = new Map<string, number>();

export const appState = {
  async loadPets() {
    const myGeneration = ++loadGeneration;
    try {
      loading.set(true);
      error.set(null);
      const { items } = await petService.getAllPets();
      if (myGeneration !== loadGeneration) return;
      pets.set(items as Pet[]);
    } catch (err: unknown) {
      if (myGeneration !== loadGeneration) return;
      error.set(`Failed to load pets: ${errorMessage(err)}`);
    } finally {
      if (myGeneration === loadGeneration) loading.set(false);
    }
  },

  selectPet(pet: Pet) {
    selectedPet.set(pet);
  },

  async deletePet(petId: number) {
    try {
      loading.set(true);
      error.set(null);
      await petService.deletePet(petId);
      await this.loadPets();

      const currentPet = getCurrentValue(selectedPet);
      if (currentPet && currentPet.id === petId) {
        selectedPet.set(null);
      }
    } catch (err: unknown) {
      error.set(`Failed to delete pet: ${errorMessage(err)}`);
    } finally {
      loading.set(false);
    }
  },

  async updatePet(petId: number, updateData: Record<string, unknown>) {
    try {
      loading.set(true);
      error.set(null);
      await petService.updatePet(petId, updateData);
      await this.loadPets();
    } catch (err: unknown) {
      error.set(`Failed to update pet: ${errorMessage(err)}`);
      throw err;
    } finally {
      loading.set(false);
    }
  },

  /**
   * Flip a single boolean marker (starred/stabled/pet-quality) in place.
   *
   * Unlike `updatePet`, this does NOT reload the whole pet list or raise the
   * global `loading` flag — both make a one-field toggle feel sluggish (#275).
   * The change is applied optimistically to `pets` (and `selectedPet` if it
   * matches), persisted in the background, and rolled back if the write fails.
   */
  async setPetMarker(petId: number, key: MarkerKey, value: boolean) {
    // Optimistically flip the field, capturing the prior boolean for
    // rollback. `found` keeps us from writing (and later restoring an
    // `undefined`) for a pet that isn't in the current list.
    let found = false;
    let previous = false;
    pets.update((list) =>
      list.map((p) => {
        if (p.id !== petId) return p;
        found = true;
        previous = p[key];
        return { ...p, [key]: value };
      }),
    );
    if (!found) return;

    // Claim the latest-op slot for this pet+key. A later toggle bumps this,
    // marking us stale (see `markerOps`).
    const opKey = `${petId}:${key}`;
    const opId = ++markerOpSeq;
    markerOps.set(opKey, opId);
    const isLatest = () => markerOps.get(opKey) === opId;

    // Mirror onto `selectedPet` only while it still points at this pet —
    // re-read on each write so we never overwrite a selection the user
    // changed during the in-flight DB write.
    const applyToSelected = (v: boolean) => {
      const cur = getCurrentValue(selectedPet);
      if (cur && cur.id === petId) selectedPet.set({ ...cur, [key]: v });
    };
    applyToSelected(value);

    try {
      const committed = await petService.updatePet(petId, { [key]: value });
      if (!committed) throw new Error(`pet ${petId} not found`);
    } catch (err: unknown) {
      // A newer toggle superseded us: leave its optimistic value (and any
      // error it may raise) intact rather than reverting to our stale baseline.
      if (isLatest()) {
        pets.update((list) => list.map((p) => (p.id === petId ? { ...p, [key]: previous } : p)));
        applyToSelected(previous);
        error.set(`Failed to update pet: ${errorMessage(err)}`);
      }
      throw err;
    } finally {
      if (isLatest()) markerOps.delete(opKey);
    }
  },

  async uploadPet(content: string, options: UploadPetOptions = {}) {
    try {
      loading.set(true);
      error.set(null);
      const result = await petService.uploadPet(content, options);
      // petService surfaces validation/duplicate failures via the
      // result envelope (no throw), so silently reloading would hide
      // those from the user.
      if (result.status === 'error') {
        error.set(`Failed to upload pet: ${result.message}`);
        return result;
      }
      await this.loadPets();
      return result;
    } catch (err: unknown) {
      error.set(`Failed to upload pet: ${errorMessage(err)}`);
      return { status: 'error' as const, message: errorMessage(err) };
    } finally {
      loading.set(false);
    }
  },

  async uploadPetQuiet(content: string, options: UploadPetOptions = {}) {
    return petService.uploadPet(content, options);
  },

  /**
   * Append a single freshly-created pet to the in-memory list instead of the
   * O(N) full `loadPets()` reload (#256). Community imports land at
   * `MAX(sort_order)+1`, so the new row sorts last under getAllPets'
   * `ORDER BY sort_order, name` — appending matches that order. The heavy
   * `genome_text` / `genome_data` blobs are stripped to keep the list-store
   * shape aligned with the list path (#254). No-op if the id is already
   * present or the fetch returns nothing.
   */
  async appendPet(petId: number) {
    const pet = await petService.getPet(petId);
    if (!pet) return;
    const { genome_text, genome_data, ...listPet } = pet;
    let appended = false;
    pets.update((list) => {
      if (list.some((p) => p.id === petId)) return list;
      appended = true;
      return [...list, listPet as Pet];
    });
    // Invalidate any loadPets() already in flight: its getAllPets() snapshot
    // predates this freshly-imported row, so letting it resolve would run
    // pets.set() over our append (appendPet bypasses the last-writer-wins
    // guard otherwise). A loadPets() started after this bump re-snapshots and
    // already includes the row, so it's safe. We also clear `loading`: a
    // superseded loadPets skips its own `loading.set(false)` (generation
    // mismatch), so as the new latest writer appendPet owns that reset.
    if (appended) {
      loadGeneration++;
      loading.set(false);
    }
  },

  async reorderPets(orderedIds: number[]) {
    try {
      await petService.reorderPets(orderedIds);
    } catch (err: unknown) {
      error.set(`Failed to save order: ${errorMessage(err)}`);
      throw err;
    }
  },

  setGeneEditingView(editingData: unknown) {
    geneEditingView.set(editingData);
    selectedPet.set(null);
  },

  clearGeneEditingView() {
    geneEditingView.set(null);
  },

  switchTab(tab: Tab) {
    const current = getCurrentValue(activeTab);
    // Record the tab we're leaving so `goBack` can return to it. Re-selecting
    // the already-active tab still re-runs its state reset (existing
    // behaviour) but must not stack a duplicate history entry.
    if (current !== undefined && current !== tab) {
      tabHistory.update((h) => {
        const next = [...h, current];
        return next.length > MAX_TAB_HISTORY ? next.slice(next.length - MAX_TAB_HISTORY) : next;
      });
    }
    activeTab.set(tab);
    TAB_STATE_RESETS[tab]();
  },

  /** Return to the previously-active tab. No-op when there's no history. */
  goBack() {
    let target: Tab | undefined;
    tabHistory.update((h) => {
      if (h.length === 0) return h;
      target = h[h.length - 1];
      return h.slice(0, -1);
    });
    if (target === undefined) return;
    activeTab.set(target);
    TAB_STATE_RESETS[target]();
  },

  clearError() {
    error.set(null);
  },

  setError(message: string) {
    error.set(message);
  },

  reset() {
    selectedPet.set(null);
    geneEditingView.set(null);
    error.set(null);
    loading.set(false);
    // Drop the back-stack too — its entries point into the pre-reset
    // session and shouldn't survive a full reset (#276 review).
    tabHistory.set([]);
  },
};
