import { cleanup, render } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import MyPets from '$lib/components/mypets/MyPets.svelte';
import { myPetsView } from '$lib/stores/mypets.svelte.js';
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
  myPetsView.search = '';
  myPetsView.species = '';
  myPetsView.breed = '';
  myPetsView.gender = '';
  myPetsView.starredOnly = false;
  myPetsView.stabledOnly = false;
  myPetsView.petQualityOnly = false;
  myPetsView.tags = [];
  myPetsView.selectedIds = new Set();
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
    myPetsView.species = 'horse';
    myPetsView.selectedIds = new Set([1, 2]);
    const { container } = render(MyPets);
    expect(selection(container)?.textContent).toContain('2 selected');
    expect(compareBtn(container).disabled).toBe(false);
  });

  it('drops a hidden pet from the count and disables Compare when a filter hides it', async () => {
    myPetsView.species = 'horse';
    myPetsView.selectedIds = new Set([1, 2]);
    const { container, rerender } = render(MyPets);
    expect(selection(container)?.textContent).toContain('2 selected');

    // A search that hides Roach must not leave it driving the bulk bar / Compare.
    myPetsView.search = 'dusty';
    await rerender({});
    expect(selection(container)?.textContent).toContain('1 selected');
    expect(compareBtn(container).disabled).toBe(true);
  });

  it('shows a "Showing N of M" count that tracks the active filters', async () => {
    const { container, rerender } = render(MyPets);
    const count = () => container.querySelector('[data-testid="mypets-count"]')?.textContent?.trim();
    expect(count()).toBe('Showing 2 of 2 pets');

    myPetsView.search = 'roach';
    await rerender({});
    expect(count()).toBe('Showing 1 of 2 pets');
  });

  it('hides the selection bar entirely when every selected pet is filtered out', async () => {
    myPetsView.species = 'horse';
    myPetsView.selectedIds = new Set([1]);
    const { container, rerender } = render(MyPets);
    expect(selection(container)).not.toBeNull();

    myPetsView.starredOnly = true; // neither sample pet is starred
    await rerender({});
    expect(selection(container)).toBeNull();
  });
});
