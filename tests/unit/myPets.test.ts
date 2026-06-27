import { cleanup, render } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import MyPets from '$lib/components/library/MyPets.svelte';
import { libraryView } from '$lib/stores/library.svelte.js';
import { pets } from '$lib/stores/pets.js';
import type { Pet } from '$lib/types/index.js';

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

const SAMPLE = [pet({ id: 1, name: 'Dusty', gender: 'Male' }), pet({ id: 2, name: 'Roach', gender: 'Female' })];

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
}

beforeEach(() => {
  resetView();
  pets.set(SAMPLE);
});

afterEach(() => {
  cleanup();
  pets.set([]);
  resetView();
});

const selection = (c: HTMLElement) => c.querySelector('[data-testid="mypets-selection"]');
const compareBtn = (c: HTMLElement) => c.querySelector('[data-testid="mypets-compare"]') as HTMLButtonElement;

describe('MyPets — selection is scoped to the visible (filtered) pets', () => {
  it('counts and compares two selected pets while both are visible', () => {
    libraryView.species = 'horse';
    libraryView.selectedIds = new Set([1, 2]);
    const { container } = render(MyPets);
    expect(selection(container)?.textContent).toContain('2 selected');
    expect(compareBtn(container).disabled).toBe(false);
  });

  it('drops a hidden pet from the count and disables Compare when a filter hides it', async () => {
    libraryView.species = 'horse';
    libraryView.selectedIds = new Set([1, 2]);
    const { container, rerender } = render(MyPets);
    expect(selection(container)?.textContent).toContain('2 selected');

    // A search that hides Roach must not leave it driving the bulk bar / Compare.
    libraryView.search = 'dusty';
    await rerender({});
    expect(selection(container)?.textContent).toContain('1 selected');
    expect(compareBtn(container).disabled).toBe(true);
  });

  it('hides the selection bar entirely when every selected pet is filtered out', async () => {
    libraryView.species = 'horse';
    libraryView.selectedIds = new Set([1]);
    const { container, rerender } = render(MyPets);
    expect(selection(container)).not.toBeNull();

    libraryView.starredOnly = true; // neither sample pet is starred
    await rerender({});
    expect(selection(container)).toBeNull();
  });
});
