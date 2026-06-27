import { cleanup, render } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { libraryView } from '$lib/stores/library.svelte.js';
import { loading, pets } from '$lib/stores/pets.js';
import type { Pet } from '$lib/types/index.js';

// MyPets opens a pet's detail as a full-view overlay. AuthWrapper runs startup
// backfills that each call `loadPets()` → `pets.set(...)` well after mount, so
// the $pets array is replaced repeatedly while a detail may be open. The detail
// must survive that churn (regression for the redesign e2e flake where the open
// overlay — and its Share button — blinked shut mid-interaction), while still
// dropping back to the table when the open pet is genuinely deleted.
//
// The real PetVisualization (gene grid, window/document reads) is stubbed so
// this stays a focused test of MyPets' overlay lifecycle.
vi.mock('$lib/components/pet/PetVisualization.svelte', async () => ({
  default: (await import('../fixtures/PetVisualizationStub.svelte')).default,
}));

import MyPets from '$lib/components/library/MyPets.svelte';

const pet = (over: Partial<Pet>): Pet =>
  ({
    id: 0,
    name: 'Pet',
    species: 'Horse',
    breed: 'Standardbred',
    gender: 'Female',
    tags: [],
    stabled: true,
    positive_genes: 0,
    ...over,
  }) as unknown as Pet;

const sample = () => [pet({ id: 1, name: 'Dusty', gender: 'Male' }), pet({ id: 2, name: 'Roach' })];

function resetView() {
  libraryView.search = '';
  libraryView.species = '';
  libraryView.breed = '';
  libraryView.gender = '';
  libraryView.starredOnly = false;
  libraryView.stabledOnly = false;
  libraryView.petQualityOnly = false;
  libraryView.tags = [];
  libraryView.selectedIds = new Set();
  libraryView.openPetId = null;
}

beforeEach(() => {
  resetView();
  loading.set(false);
  pets.set(sample());
});

afterEach(() => {
  cleanup();
  loading.set(false);
  pets.set([]);
  resetView();
});

const detail = (c: HTMLElement) => c.querySelector('[data-testid="pet-detail"]');

describe('MyPets — detail overlay survives background pet reloads', () => {
  it('keeps the open detail mounted while $pets is replaced (and briefly empty) during a reload', async () => {
    libraryView.openPetId = 1; // consumed on mount → opens pet 1's detail
    const { container, rerender } = render(MyPets);
    await rerender({});
    expect(detail(container)).not.toBeNull();

    // Mid-reload: a background loadPets is in flight (loading true) and the
    // array is momentarily replaced — worst case, briefly without our pet.
    loading.set(true);
    pets.set([]);
    await rerender({});
    expect(detail(container)).not.toBeNull();

    // Reload settles with the pet present again (fresh object refs).
    pets.set(sample());
    loading.set(false);
    await rerender({});
    expect(detail(container)).not.toBeNull();
    expect(container.querySelector('[data-testid="pet-visualization-stub"]')?.getAttribute('data-pet-id')).toBe('1');
  });

  it('closes back to the table when the open pet is deleted (settled load without it)', async () => {
    libraryView.openPetId = 1;
    const { container, rerender } = render(MyPets);
    await rerender({});
    expect(detail(container)).not.toBeNull();

    // A settled load (loading false) that no longer contains the pet = deletion.
    loading.set(false);
    pets.set([pet({ id: 2, name: 'Roach' })]);
    await rerender({});
    expect(detail(container)).toBeNull();
  });
});
