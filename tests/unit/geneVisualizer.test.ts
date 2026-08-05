import '@testing-library/jest-dom/vitest';
import { cleanup, render, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Pet } from '$lib/types/index.js';
import { genomeTextToGrid } from '$lib/utils/genomeGrid.js';

// GeneVisualizer's data layer is mocked; configService (pure static config) is
// real. `loadPetGridFromDb` is deferred so we can drive a pet switch that lands
// mid-load, and `getGeneEffectsCached` returns per-species effects we control.
const mocks = vi.hoisted(() => {
  const gridResolvers = new Map<number, (grid: unknown) => void>();
  const loadPetGridFromDb = vi.fn(
    (id: number) =>
      new Promise((resolve) => {
        gridResolvers.set(id, resolve);
      }),
  );
  const effects: { value: Record<string, Record<string, unknown>> } = { value: {} };
  const getGeneEffectsCached = vi.fn(async (species: string) => ({
    effects: effects.value[species.toLowerCase()] ?? {},
  }));
  /** Stand-in baseline; only the legend-facing counts matter here. */
  const baseline: { petCount: number; partialPets: number } = { petCount: 30, partialPets: 0 };
  const computeRarityLookup = vi.fn(async () => ({
    species: 'horse',
    petCount: baseline.petCount,
    partialPets: baseline.partialPets,
    loci: new Map(),
    tally: () => ({ knownPets: 0, pureD: 0, pureR: 0, mixed: 0 }),
    bucketOf: () => null,
    frequency: () => 0,
    carriers: () => 0,
    measurable: () => false,
  }));
  return { gridResolvers, loadPetGridFromDb, effects, getGeneEffectsCached, baseline, computeRarityLookup };
});

vi.mock('$lib/services/petService.js', () => ({ loadPetGridFromDb: mocks.loadPetGridFromDb }));
vi.mock('$lib/services/geneService.js', () => ({ getGeneEffectsCached: mocks.getGeneEffectsCached }));
vi.mock('$lib/services/frequencyService.js', () => ({ computeRarityLookup: mocks.computeRarityLookup }));

import GeneVisualizer from '$lib/components/gene/GeneVisualizer.svelte';

// jsdom has no ResizeObserver; the responsive-cell-size effect uses one.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub);

function makePet(overrides: Partial<Pet> = {}): Pet {
  return { id: 1, name: 'A', species: 'Horse', gender: 'Male', breed: '', ...overrides } as Pet;
}

const gridText = (genes: string) => genomeTextToGrid(`[Overview]\nGenome=Horse\n\n[Genes]\n${genes}`);

afterEach(() => {
  cleanup();
  mocks.gridResolvers.clear();
  mocks.loadPetGridFromDb.mockClear();
  mocks.getGeneEffectsCached.mockClear();
  mocks.computeRarityLookup.mockClear();
  mocks.effects.value = {};
  mocks.baseline.petCount = 30;
  mocks.baseline.partialPets = 0;
  document.getElementById('gene-visualizer-filters')?.remove();
  document.getElementById('gene-visualizer-rarity')?.remove();
});

describe('GeneVisualizer load reconciliation (#403 review #1)', () => {
  it('lands a pet switched mid-load once the in-flight load settles', async () => {
    const gridA = gridText('1=D\n'); // chromosome 01 only
    const gridB = gridText('1=D\n2=D\n3=D\n'); // 01, 02, 03

    const { container, rerender } = render(GeneVisualizer, { pet: makePet({ id: 1 }) });
    // Pet A's grid load is in flight (not yet resolved).
    await waitFor(() => expect(mocks.loadPetGridFromDb).toHaveBeenCalledWith(1));

    // Switch to pet B while A is still loading — the old code acknowledged the
    // new key before the load and never retried, dropping B entirely.
    await rerender({ pet: makePet({ id: 2 }) });
    expect(mocks.loadPetGridFromDb).not.toHaveBeenCalledWith(2); // serialized: B waits

    // Resolve the stale A load; the effect must then reconcile and load B.
    mocks.gridResolvers.get(1)?.(gridA);
    await waitFor(() => expect(mocks.loadPetGridFromDb).toHaveBeenCalledWith(2));
    mocks.gridResolvers.get(2)?.(gridB);

    // The displayed grid is B's — it has chromosome 03, which A lacks.
    await waitFor(() => expect(container.querySelector('[data-chromosome="03"]')).not.toBeNull());
    expect(container.querySelector('[data-chromosome="02"]')).not.toBeNull();
  });
});

// The legend's baseline line (#368 §6). "Across 30 Horses" is wrong for any
// locus some of those pets have unstudied, so the population size alone is not
// an honest summary: when study depth is uneven the legend has to say so, and
// leave the exact per-locus figure to the tooltip, where it can be right.
describe('GeneVisualizer rarity baseline legend', () => {
  /** Render, resolve the grid load, and switch into the rarity view. */
  async function openRarityView(partialPets: number) {
    mocks.baseline.partialPets = partialPets;
    const rendered = render(GeneVisualizer, { pet: makePet({ id: 1 }), populationPets: [] });
    await waitFor(() => expect(mocks.loadPetGridFromDb).toHaveBeenCalledWith(1));
    mocks.gridResolvers.get(1)?.(gridText('1=D\n'));
    (rendered.component as unknown as { handleViewChange: (v: string) => void }).handleViewChange('rarity');
    await waitFor(() => expect(rendered.container.querySelector('[data-testid="rarity-baseline"]')).not.toBeNull());
    return rendered;
  }

  const baselineText = (container: HTMLElement) =>
    container.querySelector('[data-testid="rarity-baseline"]')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

  it('states the population size', async () => {
    const { container } = await openRarityView(0);
    await waitFor(() => expect(baselineText(container)).toContain('30 Horse'));
  });

  it('flags uneven coverage when some pets were studied less deeply', async () => {
    const { container } = await openRarityView(4);
    await waitFor(() => expect(baselineText(container)).toContain('4 studied less deeply'));
  });

  it('says nothing about coverage when every pet was studied to the same depth', async () => {
    const { container } = await openRarityView(0);
    await waitFor(() => expect(baselineText(container)).toContain('30 Horse'));
    // A flag on an even population would be noise on most collections.
    expect(baselineText(container)).not.toContain('less deeply');
    expect(container.querySelector('.rarity-coverage')).toBeNull();
  });
});

describe('GeneVisualizer breed relevance reactivity (#403 review #4)', () => {
  it('applies breed row-hiding after the grid builds even when the filter was set first', async () => {
    // chr01: Clydesdale-only (irrelevant to an Arabian filter → hidden).
    // chr02: generic (breed '') → always relevant → kept.
    mocks.effects.value.horse = {
      '01A1': { effectDominant: 'None', effectRecessive: 'None', breed: 'Clydesdale', appearance: 'None' },
      '02A1': { effectDominant: 'None', effectRecessive: 'None', breed: '', appearance: 'None' },
    };

    const { component } = render(GeneVisualizer, { pet: makePet({ id: 1, breed: 'Clydesdale' }) });

    // Set the breed filter BEFORE the grid finishes building — chrBreedRelevance
    // is still empty here, so the row-hide must come from the post-build
    // reassignment (which only retriggers the stylesheet $effect if reactive).
    (component as unknown as { setBreedFilter: (b: string) => void }).setBreedFilter('Arabian');
    await tick();

    mocks.gridResolvers.get(1)?.(gridText('1=D\n2=D\n'));

    await waitFor(() => {
      const css = document.getElementById('gene-visualizer-filters')?.textContent ?? '';
      expect(css).toContain('tr[data-chromosome="01"]'); // hidden: no Arabian/generic gene
      expect(css).not.toContain('tr[data-chromosome="02"]'); // generic → kept
    });
  });
});
