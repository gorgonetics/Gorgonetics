import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Roster from '$lib/components/mypets/Roster.svelte';
import { myPetsView } from '$lib/stores/mypets.svelte.js';
import { pets as petsStore } from '$lib/stores/pets.js';
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
  pet({
    id: 1,
    name: 'Dusty',
    gender: 'Male',
    positive_genes: 30,
    toughness: 60,
    created_at: '2026-03-01T00:00:00Z',
  } as Partial<Pet>),
  pet({
    id: 2,
    name: 'Roach',
    gender: 'Female',
    positive_genes: 36,
    toughness: 40,
    created_at: '2026-05-01T00:00:00Z',
  } as Partial<Pet>),
];
const BEE = pet({ id: 3, name: 'Buzz', species: 'BeeWasp', breed: '', ferocity: 70, toughness: 55 } as Partial<Pet>);

function resetView() {
  myPetsView.search = '';
  myPetsView.species = '';
  myPetsView.breed = '';
  myPetsView.gender = '';
  myPetsView.starredOnly = false;
  myPetsView.stabledOnly = false;
  myPetsView.petQualityOnly = false;
  myPetsView.tags = [];
  myPetsView.sortCol = 'name';
  myPetsView.sortDir = 'asc';
  myPetsView.selectedIds = new Set();
}

beforeEach(() => {
  resetView();
  // Column visibility reads the whole collection, as the Community table
  // reads the whole loaded catalogue.
  petsStore.set([...SAMPLE, BEE]);
});

afterEach(() => {
  cleanup();
  resetView();
  petsStore.set([]);
});

const headers = (c: HTMLElement) => [...c.querySelectorAll('thead .sort-btn')].map((b) => b.textContent?.trim());
const rowNames = (c: HTMLElement) =>
  [...c.querySelectorAll('[data-testid="roster-open"]')].map((b) => b.textContent?.trim());

describe('Roster', () => {
  it('shows attribute columns without a species, filled only where they apply (#557)', () => {
    const { container } = render(Roster, { pets: [...SAMPLE, BEE] });
    const labels = headers(container).map((l) => l?.toLowerCase() ?? '');
    expect(labels).toEqual(expect.arrayContaining(['species', 'gender', 'toughness', 'ferocity', 'total', 'imported']));
    // Ferocity is a bee attribute: a horse row shows a dash, not a zero.
    const cellsOf = (id: number) => [
      ...(container.querySelector(`tr[data-pet-id="${id}"]`)?.querySelectorAll('td') ?? []),
    ];
    const ferocityAt = headers(container).findIndex((l) => l?.toLowerCase().startsWith('ferocity')) + 1;
    expect(cellsOf(1)[ferocityAt]?.textContent?.trim()).toBe('—');
    expect(cellsOf(3)[ferocityAt]?.textContent?.trim()).toBe('70');
  });

  it("drops the other species' attributes when a species is selected", () => {
    myPetsView.species = 'horse';
    const { container } = render(Roster, { pets: SAMPLE });
    const labels = headers(container).map((l) => l?.toLowerCase() ?? '');
    expect(labels.some((l) => l.includes('toughness'))).toBe(true);
    expect(labels.some((l) => l.includes('ferocity'))).toBe(false);
  });

  it('sorts by import date, newest first on the first click (#557)', async () => {
    const { container } = render(Roster, { pets: SAMPLE });
    const imported = [...container.querySelectorAll('thead .sort-btn')].find((b) =>
      b.textContent?.startsWith('Imported'),
    ) as HTMLButtonElement;
    await fireEvent.click(imported);
    expect(myPetsView.sortCol).toBe('created_at');
    expect(rowNames(container)).toEqual(['Roach', 'Dusty']);
    await fireEvent.click(imported);
    expect(rowNames(container)).toEqual(['Dusty', 'Roach']);
  });

  // Filtering itself lives in MyPets (one filterPets pass, #405); the roster
  // just lists whatever it is given and tracks prop updates.
  it('lists the pets it is given and updates when the prop changes', async () => {
    const { container, rerender } = render(Roster, { pets: SAMPLE });
    expect(rowNames(container)).toEqual(['Dusty', 'Roach']);
    await rerender({ pets: SAMPLE.filter((p) => p.name === 'Roach') });
    expect(rowNames(container)).toEqual(['Roach']);
  });

  it('sorts by the per-species Total column', async () => {
    myPetsView.species = 'horse';
    const { container } = render(Roster, { pets: SAMPLE });
    const total = [...container.querySelectorAll('thead .sort-btn')].find((b) =>
      b.textContent?.startsWith('Total'),
    ) as HTMLButtonElement;
    expect(total).toBeTruthy();
    // Dusty toughness 60, Roach 40 → a number sorts largest first: Dusty, Roach.
    await fireEvent.click(total);
    expect(myPetsView.sortCol).toBe('attr_total');
    expect(rowNames(container)).toEqual(['Dusty', 'Roach']);
    await fireEvent.click(total);
    expect(rowNames(container)).toEqual(['Roach', 'Dusty']);
  });

  it('sorts by a clicked column and toggles direction', async () => {
    const { container } = render(Roster, { pets: SAMPLE });
    // Default name asc → Dusty, Roach.
    expect(rowNames(container)).toEqual(['Dusty', 'Roach']);
    // Click +Genes → desc (36, 30) → Roach, Dusty; click again → asc → Dusty, Roach.
    const plusGenes = [...container.querySelectorAll('thead .sort-btn')].find((b) =>
      b.textContent?.includes('+ Genes'),
    ) as HTMLButtonElement;
    await fireEvent.click(plusGenes);
    expect(myPetsView.sortCol).toBe('positive_genes');
    expect(myPetsView.sortDir).toBe('desc');
    expect(rowNames(container)).toEqual(['Roach', 'Dusty']);
    await fireEvent.click(plusGenes);
    expect(myPetsView.sortDir).toBe('asc');
    expect(rowNames(container)).toEqual(['Dusty', 'Roach']);
  });

  it('clicking a pet name invokes onOpen with that pet (separate from selection)', async () => {
    const onOpen = vi.fn();
    const { container } = render(Roster, { pets: SAMPLE, onOpen } as never);
    await fireEvent.click(container.querySelectorAll('[data-testid="roster-open"]')[1] as HTMLButtonElement);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen.mock.calls[0][0].id).toBe(2);
    // Opening must NOT mutate the multi-selection.
    expect(myPetsView.selectedIds.size).toBe(0);
  });

  it('row checkbox toggles multi-selection; select-all covers the filtered set', async () => {
    const { container } = render(Roster, { pets: SAMPLE });
    await fireEvent.click(container.querySelector('[data-testid="roster-row-select"]') as HTMLInputElement);
    expect(myPetsView.selectedIds.size).toBe(1);

    await fireEvent.click(container.querySelector('[data-testid="roster-select-all"]') as HTMLInputElement);
    expect(myPetsView.selectedIds.size).toBe(2);
  });
});
