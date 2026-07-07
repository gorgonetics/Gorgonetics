import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import BreedingPairTable from '$lib/components/breeding/BreedingPairTable.svelte';
import { breedingView } from '$lib/stores/breeding.svelte.js';
import type { BreedingPairResult, Pet } from '$lib/types/index.js';

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

const result = (male: Pet, female: Pet): BreedingPairResult => ({
  male,
  female,
  evMixed: 1,
  evPositiveByAttribute: {},
  evPositiveTotal: 2,
  evPositiveWeighted: 2,
  evUnknown: 0,
  totalLoci: 10,
});

const RESULTS = [result(pet({ id: 1, name: 'Dusty', gender: 'Male' }), pet({ id: 2, name: 'Roach' }))];

function resetView() {
  breedingView.species = '';
  breedingView.offspringBreed = '';
  breedingView.sortCol = 'evPositiveTotal';
  breedingView.sortDir = 'desc';
  breedingView.selectedPair = null;
  breedingView.scrollTop = 0;
  breedingView.scrollLeft = 0;
}

beforeEach(resetView);

afterEach(() => {
  cleanup();
  resetView();
});

const wrapper = (c: HTMLElement) => c.querySelector('[data-testid="breeding-pair-table"]') as HTMLDivElement;

describe('BreedingPairTable — scroll persistence', () => {
  it('restores the persisted offsets once rows are rendered', async () => {
    breedingView.scrollTop = 120;
    breedingView.scrollLeft = 40;
    const { container, rerender } = render(BreedingPairTable, { results: RESULTS, attrNames: [] });
    await rerender({});
    expect(wrapper(container).scrollTop).toBe(120);
    expect(wrapper(container).scrollLeft).toBe(40);
  });

  it('persists the wrapper offsets into the store on scroll', async () => {
    const { container, rerender } = render(BreedingPairTable, { results: RESULTS, attrNames: [] });
    await rerender({});
    const el = wrapper(container);
    el.scrollTop = 80;
    el.scrollLeft = 15;
    await fireEvent.scroll(el);
    expect(breedingView.scrollTop).toBe(80);
    expect(breedingView.scrollLeft).toBe(15);
  });

  it('re-syncs the DOM when the store offsets are reset externally (species change)', async () => {
    const { container, rerender } = render(BreedingPairTable, { results: RESULTS, attrNames: [] });
    await rerender({});
    const el = wrapper(container);

    // User scrolls; the store follows.
    el.scrollTop = 200;
    el.scrollLeft = 30;
    await fireEvent.scroll(el);
    expect(breedingView.scrollTop).toBe(200);

    // A species change resets the store while the table stays mounted — the
    // DOM must follow, or the next scroll event would re-persist the stale
    // offsets over the reset.
    breedingView.scrollTop = 0;
    breedingView.scrollLeft = 0;
    await rerender({});
    expect(el.scrollTop).toBe(0);
    expect(el.scrollLeft).toBe(0);
  });

  it('a store write echoing the element position does not loop or move the DOM', async () => {
    const { container, rerender } = render(BreedingPairTable, { results: RESULTS, attrNames: [] });
    await rerender({});
    const el = wrapper(container);

    el.scrollTop = 60;
    await fireEvent.scroll(el);
    await rerender({});
    // The sync effect saw store === element and left the DOM alone.
    expect(el.scrollTop).toBe(60);
    expect(breedingView.scrollTop).toBe(60);
  });
});
