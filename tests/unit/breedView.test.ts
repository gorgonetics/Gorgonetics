import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { rankBreedingPairs } from '$lib/services/breedingService.js';
import { breedingView } from '$lib/stores/breeding.svelte.js';
import { loading, pets } from '$lib/stores/pets.js';
import type { Pet } from '$lib/types/index.js';

// The ranking service is exercised by its own suite; stub it so these tests
// stay a focused check of BreedView's species defaulting and trio lifecycle.
vi.mock('$lib/services/breedingService.js', () => ({
  rankBreedingPairs: vi.fn(async () => []),
}));

// The real TrioView mounts the heavy offspring grid (~2304 cells); the guard
// under test only cares whether the pair is still selected.
vi.mock('$lib/components/breeding/TrioView.svelte', async () => ({
  default: (await import('./fixtures/ChildStub.svelte')).default,
}));

import BreedView from '$lib/components/breeding/BreedView.svelte';

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

const stallion = pet({ id: 1, name: 'Dusty', gender: 'Male' });
const mare = pet({ id: 2, name: 'Roach' });

function resetView() {
  breedingView.species = '';
  breedingView.offspringBreed = '';
  breedingView.sortCol = 'evPositiveTotal';
  breedingView.sortDir = 'desc';
  breedingView.selectedPair = null;
  breedingView.scrollTop = 0;
  breedingView.scrollLeft = 0;
  breedingView.benchedIds = new Set();
  breedingView.spots = 0;
}

beforeEach(() => {
  resetView();
  loading.set(false);
  pets.set([]);
});

afterEach(() => {
  cleanup();
  loading.set(false);
  pets.set([]);
  resetView();
});

const activeSpecies = (c: HTMLElement) =>
  c.querySelector('[data-testid="breed-species"] .species-btn.active')?.getAttribute('data-species');

describe('BreedView — default species', () => {
  it('defaults to the most-populated stabled species, not the alphabetical first', async () => {
    // Beewasps outnumber horses overall, but most are unstabled — only the
    // stabled population should drive the default.
    pets.set([
      stallion,
      mare,
      pet({ id: 3, species: 'Beewasp', breed: 'Bee' }),
      pet({ id: 4, species: 'Beewasp', breed: 'Bee', stabled: false }),
      pet({ id: 5, species: 'Beewasp', breed: 'Bee', stabled: false }),
      pet({ id: 6, species: 'Beewasp', breed: 'Bee', stabled: false }),
    ]);
    const { container, rerender } = render(BreedView);
    await rerender({});
    expect(activeSpecies(container)).toBe('horse');
    // The default is derived, not committed — only an explicit click pins it.
    expect(breedingView.species).toBe('');
  });

  it('re-derives the default when the pet list lands after mount (no mount-time lock-in)', async () => {
    const { container, rerender } = render(BreedView);
    await rerender({});
    // Nothing loaded yet → the first supported species is the fallback.
    expect(activeSpecies(container)).toBe('beewasp');

    pets.set([stallion, mare, pet({ id: 3, species: 'Beewasp', breed: 'Bee' })]);
    await rerender({});
    expect(activeSpecies(container)).toBe('horse');
  });

  it('a persisted explicit choice wins over the population default', async () => {
    breedingView.species = 'beewasp';
    pets.set([stallion, mare, pet({ id: 3, species: 'Beewasp', breed: 'Bee' })]);
    const { container, rerender } = render(BreedView);
    await rerender({});
    expect(activeSpecies(container)).toBe('beewasp');
  });

  it('clicking a species pins it in the store and resets breed + scroll state', async () => {
    pets.set([stallion, mare]);
    breedingView.scrollTop = 120;
    breedingView.scrollLeft = 40;
    const { container, rerender } = render(BreedView);
    await rerender({});

    const beewaspBtn = container.querySelector('[data-testid="breed-species"] [data-species="beewasp"]');
    expect(beewaspBtn).not.toBeNull();
    await fireEvent.click(beewaspBtn as Element);
    await rerender({});

    expect(breedingView.species).toBe('beewasp');
    expect(activeSpecies(container)).toBe('beewasp');
    expect(breedingView.scrollTop).toBe(0);
    expect(breedingView.scrollLeft).toBe(0);
  });
});

describe('BreedView — trio invalidation when a parent leaves the candidate set', () => {
  beforeEach(() => {
    breedingView.species = 'horse';
    pets.set([stallion, mare]);
    breedingView.selectedPair = { male: stallion, female: mare };
  });

  it('keeps the trio open across an in-flight reload that briefly lacks a parent', async () => {
    const { rerender } = render(BreedView);
    await rerender({});
    expect(breedingView.selectedPair).not.toBeNull();

    // Mid-reload: loading true and the list momentarily empty must not be
    // mistaken for a deletion.
    loading.set(true);
    pets.set([]);
    await rerender({});
    expect(breedingView.selectedPair).not.toBeNull();

    // The reload settles with both parents present (fresh object refs).
    pets.set([pet({ id: 1, name: 'Dusty', gender: 'Male' }), pet({ id: 2, name: 'Roach' })]);
    loading.set(false);
    await rerender({});
    expect(breedingView.selectedPair).not.toBeNull();
  });

  it('drops back to the pair table when a parent is deleted (settled load)', async () => {
    const { rerender } = render(BreedView);
    await rerender({});
    expect(breedingView.selectedPair).not.toBeNull();

    pets.set([mare]);
    await rerender({});
    expect(breedingView.selectedPair).toBeNull();
  });

  it('drops back to the pair table when a parent is unstabled (settled load)', async () => {
    const { rerender } = render(BreedView);
    await rerender({});
    expect(breedingView.selectedPair).not.toBeNull();

    pets.set([stallion, pet({ id: 2, name: 'Roach', stabled: false })]);
    await rerender({});
    expect(breedingView.selectedPair).toBeNull();
  });
});

describe('BreedView — bench + planning', () => {
  const stallion2 = pet({ id: 3, name: 'Comet', gender: 'Male' });

  beforeEach(() => {
    breedingView.species = 'horse';
    pets.set([stallion, stallion2, mare]);
  });

  it('excludes a benched animal from the pets fed to the ranking', async () => {
    const ranker = vi.mocked(rankBreedingPairs);
    const { container, rerender } = render(BreedView);
    await rerender({});

    // Expand the pool and bench the second stallion.
    await fireEvent.click(container.querySelector('[data-testid="breeding-pool"] .pool-toggle') as HTMLButtonElement);
    await fireEvent.click(container.querySelector('[data-testid="breeding-pool"] [data-pet-id="3"]') as HTMLButtonElement);
    await rerender({});

    expect(breedingView.benchedIds.has(3)).toBe(true);
    const lastCall = ranker.mock.calls.at(-1)?.[0];
    expect(lastCall?.pets.map((p) => p.id).sort((a, b) => a - b)).toEqual([1, 2]);
  });

  it('the spots stepper drives breedingView.spots and clamps at zero', async () => {
    const { container, rerender } = render(BreedView);
    await rerender({});
    const value = () => container.querySelector('[data-testid="spots-value"]')?.textContent;
    const inc = container.querySelector('[aria-label="More breeding spots"]') as HTMLButtonElement;
    const dec = container.querySelector('[aria-label="Fewer breeding spots"]') as HTMLButtonElement;

    expect(value()).toBe('Off');
    expect(dec.disabled).toBe(true);

    await fireEvent.click(inc);
    await fireEvent.click(inc);
    expect(breedingView.spots).toBe(2);
    expect(value()).toBe('2');

    await fireEvent.click(dec);
    await fireEvent.click(dec);
    expect(breedingView.spots).toBe(0);
    expect(value()).toBe('Off');
    expect((container.querySelector('[aria-label="Fewer breeding spots"]') as HTMLButtonElement).disabled).toBe(true);
  });
});
