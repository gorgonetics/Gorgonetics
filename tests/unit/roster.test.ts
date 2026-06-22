import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Roster from '$lib/components/library/Roster.svelte';
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

const SAMPLE = [
  pet({ id: 1, name: 'Dusty', gender: 'Male', positive_genes: 30, toughness: 60 } as Partial<Pet>),
  pet({ id: 2, name: 'Roach', gender: 'Female', positive_genes: 36, toughness: 40 } as Partial<Pet>),
];

function resetView() {
  libraryView.search = '';
  libraryView.species = '';
  libraryView.breed = '';
  libraryView.starredOnly = false;
  libraryView.stabledOnly = false;
  libraryView.petQualityOnly = false;
  libraryView.tags = [];
  libraryView.sortCol = 'name';
  libraryView.sortDir = 'asc';
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

const headers = (c: HTMLElement) => [...c.querySelectorAll('thead .sort-btn')].map((b) => b.textContent?.trim());
const rowNames = (c: HTMLElement) =>
  [...c.querySelectorAll('[data-testid="roster-open"]')].map((b) => b.textContent?.trim());

describe('Roster', () => {
  it('shows species-agnostic columns when no species is selected (no per-attribute columns)', () => {
    const { container } = render(Roster);
    const labels = headers(container);
    expect(labels?.some((l) => l?.startsWith('Name'))).toBe(true);
    expect(labels).toContain('Gender');
    expect(labels?.some((l) => l?.startsWith('+ Genes'))).toBe(true);
    // No horse attribute column (e.g. Toughness) until a species is chosen…
    expect(labels?.some((l) => l?.toLowerCase().includes('toughness'))).toBe(false);
    // …and no Total either — with no attributes to sum it would read 0 for all.
    expect(labels?.some((l) => l?.startsWith('Total'))).toBe(false);
  });

  it('adds per-attribute columns when a species is selected', () => {
    libraryView.species = 'horse';
    const { container } = render(Roster);
    const labels = headers(container).map((l) => l?.toLowerCase() ?? '');
    expect(labels.some((l) => l.includes('toughness'))).toBe(true);
  });

  it('lists the filtered pets and respects the search filter', async () => {
    const { container, rerender } = render(Roster);
    expect(rowNames(container)).toEqual(['Dusty', 'Roach']);
    libraryView.search = 'roach';
    await rerender({});
    expect(rowNames(container)).toEqual(['Roach']);
  });

  it('sorts by a clicked column and toggles direction', async () => {
    const { container } = render(Roster);
    // Default name asc → Dusty, Roach.
    expect(rowNames(container)).toEqual(['Dusty', 'Roach']);
    // Click +Genes → asc (30, 36) → Dusty, Roach; click again → desc → Roach, Dusty.
    const plusGenes = [...container.querySelectorAll('thead .sort-btn')].find((b) =>
      b.textContent?.includes('+ Genes'),
    ) as HTMLButtonElement;
    await fireEvent.click(plusGenes);
    expect(libraryView.sortCol).toBe('positive_genes');
    expect(rowNames(container)).toEqual(['Dusty', 'Roach']);
    await fireEvent.click(plusGenes);
    expect(libraryView.sortDir).toBe('desc');
    expect(rowNames(container)).toEqual(['Roach', 'Dusty']);
  });

  it('clicking a pet name invokes onOpen with that pet (separate from selection)', async () => {
    const onOpen = vi.fn();
    const { container } = render(Roster, { onOpen } as never);
    await fireEvent.click(container.querySelectorAll('[data-testid="roster-open"]')[1] as HTMLButtonElement);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen.mock.calls[0][0].id).toBe(2);
    // Opening must NOT mutate the multi-selection.
    expect(libraryView.selectedIds.size).toBe(0);
  });

  it('row checkbox toggles multi-selection; select-all covers the filtered set', async () => {
    const { container } = render(Roster);
    await fireEvent.click(container.querySelector('[data-testid="roster-row-select"]') as HTMLInputElement);
    expect(libraryView.selectedIds.size).toBe(1);

    await fireEvent.click(container.querySelector('[data-testid="roster-select-all"]') as HTMLInputElement);
    expect(libraryView.selectedIds.size).toBe(2);
  });
});
