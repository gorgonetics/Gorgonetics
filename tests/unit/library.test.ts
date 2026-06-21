import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Library from '$lib/components/library/Library.svelte';
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
    starred: false,
    stabled: true,
    is_pet_quality: false,
    ...over,
  }) as unknown as Pet;

const SAMPLE = [
  pet({ id: 1, name: 'Dusty', species: 'Horse', gender: 'Male', starred: true }),
  pet({ id: 2, name: 'Roach', species: 'Horse', gender: 'Female' }),
  pet({ id: 3, name: 'Buzz', species: 'BeeWasp', breed: '', gender: 'Female', stabled: false }),
];

beforeEach(() => {
  // libraryView is module-scoped $state shared across tests — reset it.
  libraryView.search = '';
  libraryView.species = '';
  libraryView.breed = '';
  libraryView.starredOnly = false;
  libraryView.stabledOnly = false;
  libraryView.petQualityOnly = false;
  libraryView.tags = [];
  libraryView.density = 'card';
  libraryView.selectedIds = new Set();
  pets.set(SAMPLE);
});

afterEach(() => {
  cleanup();
  pets.set([]);
});

const rows = (c: HTMLElement) => c.querySelectorAll('[data-testid="pet-row"]');
const count = (c: HTMLElement) => c.querySelector('[data-testid="library-count"]')?.textContent;

describe('Library', () => {
  it('lists every pet with a name and count', () => {
    const { container } = render(Library);
    expect(rows(container)).toHaveLength(3);
    expect(count(container)).toBe('3 pets');
    expect(container.textContent).toContain('Dusty');
    expect(container.textContent).toContain('Buzz');
  });

  it('filters by the search box', async () => {
    const { container } = render(Library);
    await fireEvent.input(container.querySelector('[data-testid="filter-search"]') as HTMLInputElement, {
      target: { value: 'roach' },
    });
    expect(rows(container)).toHaveLength(1);
    expect(count(container)).toBe('1 pet');
    expect(container.textContent).toContain('Roach');
  });

  it('filters by a flag pill (Starred)', async () => {
    const { container } = render(Library);
    await fireEvent.click(container.querySelector('[data-flag="starred"]') as HTMLButtonElement);
    expect(rows(container)).toHaveLength(1);
    expect(container.textContent).toContain('Dusty');
  });

  it('toggles list density', async () => {
    const { container } = render(Library);
    const list = container.querySelector('[data-testid="library-list"]') as HTMLElement;
    expect(list.classList.contains('table')).toBe(false);
    await fireEvent.click(container.querySelector('.density button[aria-pressed="false"]') as HTMLButtonElement);
    expect(list.classList.contains('table')).toBe(true);
  });

  it('shows the selection footer after selecting a pet', async () => {
    const { container } = render(Library);
    expect(container.querySelector('[data-testid="library-foot"]')).toBeNull();
    await fireEvent.click(container.querySelector('[data-testid="pet-row-select"]') as HTMLInputElement);
    const foot = container.querySelector('[data-testid="library-foot"]');
    expect(foot).not.toBeNull();
    expect(foot?.textContent).toContain('1 selected');
    expect(libraryView.selectedIds.size).toBe(1);
  });

  it('clears the selection when the species filter changes', async () => {
    const { container } = render(Library);
    await fireEvent.click(container.querySelector('[data-testid="pet-row-select"]') as HTMLInputElement);
    expect(libraryView.selectedIds.size).toBe(1);

    // Switching species would otherwise leave a now-hidden pet selected.
    await fireEvent.click(container.querySelector('[data-species="horse"]') as HTMLButtonElement);
    expect(libraryView.selectedIds.size).toBe(0);
    expect(container.querySelector('[data-testid="library-foot"]')).toBeNull();
  });

  it('clears the selection from the footer', async () => {
    const { container } = render(Library);
    await fireEvent.click(container.querySelector('[data-testid="pet-row-select"]') as HTMLInputElement);
    await fireEvent.click(container.querySelector('.clear-btn') as HTMLButtonElement);
    expect(libraryView.selectedIds.size).toBe(0);
    expect(container.querySelector('[data-testid="library-foot"]')).toBeNull();
  });
});
