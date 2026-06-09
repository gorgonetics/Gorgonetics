import { derived, type Writable, writable } from 'svelte/store';
import type { UploadPetOptions } from '$lib/services/petService.js';
import * as petService from '$lib/services/petService.js';
import type { Pet } from '$lib/types/index.js';
import { errorMessage } from '$lib/utils/error.js';

export type Tab = 'pets' | 'editor' | 'compare' | 'stable' | 'breeding' | 'community';

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
};

// Monotonic generation counter for in-flight `loadPets` calls. Concurrent
// callers (auto-scan + community import + manual upload finishing in any
// order) all race to `pets.set(items)` — without this guard the older
// `getAllPets()` result can resolve last and overwrite a fresher list,
// leaving the Pets/Stable tab on a stale snapshot until the next refresh.
let loadGeneration = 0;

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
  },
};
