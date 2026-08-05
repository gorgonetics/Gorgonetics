import '@testing-library/jest-dom/vitest';
import { cleanup, render, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The Reference genome map (#368 §7).
 *
 * The map has no pet, so its structure comes from the gene template while its
 * colours come from a baseline — two independent loads. These cover what happens
 * when the second one is slow, fails, or belongs to a different species, because
 * gene ids collide across species: a stale lookup does not fail to match the new
 * genome, it matches all of it and shades it from the wrong tallies.
 */

const mocks = vi.hoisted(() => {
  const effects: { value: Record<string, Record<string, unknown>> } = { value: {} };
  const getGeneEffectsCached = vi.fn(async (species: string) => ({
    effects: effects.value[species.toLowerCase()] ?? {},
  }));
  const baseline: { species: string | null; defer: boolean; reject: boolean } = {
    species: null,
    defer: false,
    reject: false,
  };
  const resolvers: Array<() => void> = [];
  const computeRarityLookup = vi.fn((_pets: unknown, species: string) => {
    if (baseline.reject) return Promise.reject(new Error('pet_genes read failed'));
    const lookup = {
      species: baseline.species ?? String(species).toLowerCase(),
      petCount: 12,
      partialPets: 0,
      loci: new Map(),
      tally: () => ({ knownPets: 12, pureD: 12, pureR: 0, mixed: 0 }),
      bucketOf: () => 3,
      frequency: () => 0.05,
      carriers: () => 1,
      measurable: () => true,
    };
    if (!baseline.defer) return Promise.resolve(lookup);
    return new Promise((resolve) => {
      resolvers.push(() => resolve(lookup));
    });
  });
  return { effects, getGeneEffectsCached, baseline, resolvers, computeRarityLookup };
});

vi.mock('$lib/services/geneService.js', () => ({ getGeneEffectsCached: mocks.getGeneEffectsCached }));
vi.mock('$lib/services/frequencyService.js', () => ({ computeRarityLookup: mocks.computeRarityLookup }));

import GenomeMap from '$lib/components/gene/GenomeMap.svelte';

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub);

/** A two-locus horse template, enough for the grid to render cells. */
const HORSE_TEMPLATE = {
  '01A1': { effectDominant: 'Toughness+', effectRecessive: 'None', breed: '', appearance: 'None' },
  '01A2': { effectDominant: 'None', effectRecessive: 'Virility-', breed: '', appearance: 'None' },
};

const sheet = () => document.getElementById('genome-map-rarity')?.textContent ?? '';

afterEach(() => {
  cleanup();
  mocks.resolvers.length = 0;
  mocks.getGeneEffectsCached.mockClear();
  mocks.computeRarityLookup.mockClear();
  mocks.effects.value = {};
  mocks.baseline.species = null;
  mocks.baseline.defer = false;
  mocks.baseline.reject = false;
  document.getElementById('genome-map-rarity')?.remove();
});

async function renderMap(species = 'Horse') {
  mocks.effects.value.horse = HORSE_TEMPLATE;
  mocks.effects.value.beewasp = HORSE_TEMPLATE;
  const rendered = render(GenomeMap, { species, populationPets: [] });
  await waitFor(() => expect(rendered.container.querySelector('[data-testid="genome-map-grid"]')).not.toBeNull());
  return rendered;
}

describe('GenomeMap baseline readiness', () => {
  it('renders the genome unscored while the baseline is in flight', async () => {
    mocks.baseline.defer = true;
    const { container } = await renderMap();

    expect(container.querySelector('.gene-grid-container.rarity-unscored')).not.toBeNull();
    expect(sheet()).toBe('');

    for (const resolve of mocks.resolvers) resolve();
    await waitFor(() => expect(container.querySelector('.rarity-unscored')).toBeNull());
    expect(sheet()).not.toBe('');
  });

  it('refuses a baseline built for another species', async () => {
    // Switching animal type reloads the template, but the lookup outlives it.
    mocks.baseline.species = 'horse';
    const { container } = await renderMap('BeeWasp');

    await waitFor(() => expect(mocks.computeRarityLookup).toHaveBeenCalled());
    expect(container.querySelector('.gene-grid-container.rarity-unscored')).not.toBeNull();
    expect(sheet()).toBe('');
  });

  it('paints once the baseline is for the displayed species', async () => {
    const { container } = await renderMap();
    await waitFor(() => expect(sheet()).not.toBe(''));
    expect(container.querySelector('.rarity-unscored')).toBeNull();
  });
});

describe('GenomeMap baseline failure', () => {
  it('says so, instead of showing a map where nothing is rare', async () => {
    // Falling through to bucket 0 would be a claim about the collection — that
    // there is no scarce material in it — made from no measurement at all.
    mocks.baseline.reject = true;
    const { container, getByTestId } = await renderMap();

    await waitFor(() => expect(getByTestId('map-baseline-error')).toBeTruthy());
    expect(getByTestId('map-baseline-error').textContent).toContain('Could not analyse rarity');
    expect(container.querySelector('.gene-grid-container.rarity-unscored')).not.toBeNull();
    expect(sheet()).toBe('');
    // The genome itself is still on screen — only the frequencies are missing.
    expect(container.querySelectorAll('.gene-cell').length).toBeGreaterThan(0);
  });

  it('clears the error when a later load succeeds', async () => {
    mocks.baseline.reject = true;
    const { container, rerender, getByTestId } = await renderMap();
    await waitFor(() => expect(getByTestId('map-baseline-error')).toBeTruthy());

    mocks.baseline.reject = false;
    await rerender({ species: 'Horse', populationPets: [{ id: 1, species: 'Horse', stabled: true }] });

    await waitFor(() => expect(container.querySelector('[data-testid="map-baseline-error"]')).toBeNull());
    expect(sheet()).not.toBe('');
  });
});
