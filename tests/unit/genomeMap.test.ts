import '@testing-library/jest-dom/vitest';
import { cleanup, render, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Pet } from '$lib/types/index.js';

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
  const baseline: {
    species: string | null;
    defer: boolean;
    reject: boolean;
    petCount: number;
    bucketOf: (geneId: string, allele: string) => number | null;
  } = {
    species: null,
    defer: false,
    reject: false,
    petCount: 12,
    bucketOf: () => 3,
  };
  const resolvers: Array<() => void> = [];
  const computeRarityLookup = vi.fn((_pets: unknown, species: string) => {
    if (baseline.reject) return Promise.reject(new Error('pet_genes read failed'));
    const lookup = {
      species: baseline.species ?? String(species).toLowerCase(),
      petCount: baseline.petCount,
      partialPets: 0,
      loci: new Map(),
      tally: () => ({ knownPets: 12, pureD: 12, pureR: 0, mixed: 0 }),
      bucketOf: baseline.bucketOf,
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
  mocks.baseline.petCount = 12;
  mocks.baseline.bucketOf = () => 3;
  document.getElementById('genome-map-rarity')?.remove();
});

async function renderMap(species = 'Horse', lens: 'rarity' | 'impact' | 'never' = 'rarity') {
  mocks.effects.value.horse = HORSE_TEMPLATE;
  mocks.effects.value.beewasp = HORSE_TEMPLATE;
  const rendered = render(GenomeMap, { species, populationPets: [], lens });
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
    await rerender({
      species: 'Horse',
      populationPets: [{ id: 1, species: 'Horse', stabled: true } as unknown as Pet],
    });

    await waitFor(() => expect(container.querySelector('[data-testid="map-baseline-error"]')).toBeNull());
    expect(sheet()).not.toBe('');
  });
});

describe('GenomeMap never-seen lens', () => {
  const status = (container: HTMLElement) =>
    container.querySelector('[data-testid="map-never-status"]')?.textContent?.trim() ?? '';

  it('shows only the never-seen allele, with its letter, and leaves other cells empty', async () => {
    // 01A1: nobody carries R. 01A2: both alleles carried.
    mocks.baseline.bucketOf = (geneId, allele) => (geneId === '01A1' && allele === 'R' ? 5 : 0);
    const { container } = await renderMap('Horse', 'never');

    const cell = (id: string) => container.querySelector(`.gene-cell[data-gene-id="${id}"]`) as HTMLElement;
    await waitFor(() => expect(cell('01A1').dataset.allele).toBe('R'));
    expect(cell('01A1').textContent).toBe('R');
    expect(cell('01A1').getAttribute('aria-label')).toBe('01A1: R never seen');
    expect(cell('01A2').dataset.allele).toBeUndefined();
    expect(cell('01A2').textContent).toBe('');
    expect(container.querySelector('.gene-grid-container.view-never')).not.toBeNull();
    expect(status(container)).toContain('1 allele that none of your 12 pets carry (1 R, 0 D)');
    // The lens marks cells in the markup; the rarity sheet must not leak in.
    expect(sheet()).toBe('');
    const list = container.querySelector('[data-testid="map-never-list"]');
    expect(list?.querySelectorAll('li').length).toBe(1);
    expect(list?.querySelector('li[data-chromosome="01"]')?.textContent?.replace(/\s+/g, ' ').trim()).toBe('01 A1 R');
  });

  it('says the population is too small rather than that nothing is missing', async () => {
    mocks.baseline.petCount = 3;
    mocks.baseline.bucketOf = () => 0;
    const { container } = await renderMap('Horse', 'never');

    await waitFor(() => expect(status(container)).toContain('Needs at least 10'));
    expect(container.querySelectorAll('.gene-cell[data-allele]').length).toBe(0);
    expect(container.querySelector('[data-testid="map-never-list"]')).toBeNull();
  });

  it('marks nothing while the baseline is in flight', async () => {
    mocks.baseline.defer = true;
    mocks.baseline.bucketOf = () => 5;
    const { container } = await renderMap('Horse', 'never');

    expect(status(container)).toBe('Analysing…');
    expect(container.querySelectorAll('.gene-cell[data-allele]').length).toBe(0);
    for (const resolve of mocks.resolvers) resolve();
    await waitFor(() => expect(container.querySelectorAll('.gene-cell[data-allele]').length).toBe(2));
  });
});
