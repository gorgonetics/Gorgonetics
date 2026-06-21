import { get } from 'svelte/store';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/services/petService.js', () => ({
  updatePet: vi.fn(),
  getAllPets: vi.fn(),
  deletePet: vi.fn(),
  reorderPets: vi.fn(),
  uploadPet: vi.fn(),
}));

import { activeTab, appState, canGoBack, selectedPet } from '$lib/stores/pets.js';
import type { Pet } from '$lib/types/index.js';

beforeEach(() => {
  // Drain any history left over from a previous test, then return to a
  // known starting tab. (tabHistory is module-private by design.)
  let guard = 0;
  while (get(canGoBack) && guard++ < 200) appState.goBack();
  activeTab.set('library');
  selectedPet.set(null);
});

describe('tab navigation history', () => {
  it('starts with no back history', () => {
    expect(get(canGoBack)).toBe(false);
  });

  it('records the previous tab and returns to it on goBack', () => {
    appState.switchTab('community');
    expect(get(activeTab)).toBe('community');
    expect(get(canGoBack)).toBe(true);

    appState.goBack();
    expect(get(activeTab)).toBe('library');
    expect(get(canGoBack)).toBe(false);
  });

  it('walks back through multiple tabs in LIFO order', () => {
    appState.switchTab('community');
    appState.switchTab('reference');

    appState.goBack();
    expect(get(activeTab)).toBe('community');
    appState.goBack();
    expect(get(activeTab)).toBe('library');
    expect(get(canGoBack)).toBe(false);
  });

  it('does not push a duplicate entry when re-selecting the active tab', () => {
    appState.switchTab('library');
    expect(get(canGoBack)).toBe(false);
  });

  it('goBack is a no-op when there is no history', () => {
    appState.goBack();
    expect(get(activeTab)).toBe('library');
    expect(get(canGoBack)).toBe(false);
  });

  it('runs the per-tab state reset when navigating back', () => {
    // Reference is reached, then a pet is selected; navigating back to library
    // runs library's reset (clearSelectionAndGeneView), clearing the selection.
    appState.switchTab('reference');
    selectedPet.set({ id: 1, name: 'x' } as unknown as Pet);

    appState.goBack();
    expect(get(activeTab)).toBe('library');
    expect(get(selectedPet)).toBeNull();
  });

  it('clears the back-stack on reset', () => {
    appState.switchTab('community');
    expect(get(canGoBack)).toBe(true);

    appState.reset();
    expect(get(canGoBack)).toBe(false);
  });
});
