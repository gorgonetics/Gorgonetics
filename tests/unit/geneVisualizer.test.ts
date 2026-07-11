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
  return { gridResolvers, loadPetGridFromDb, effects, getGeneEffectsCached };
});

vi.mock('$lib/services/petService.js', () => ({ loadPetGridFromDb: mocks.loadPetGridFromDb }));
vi.mock('$lib/services/geneService.js', () => ({ getGeneEffectsCached: mocks.getGeneEffectsCached }));

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
  mocks.effects.value = {};
  document.getElementById('gene-visualizer-filters')?.remove();
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
