import { cleanup, render } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Workspace from '$lib/components/library/Workspace.svelte';
import { libraryView } from '$lib/stores/library.svelte.js';
import { pets } from '$lib/stores/pets.js';
import type { Pet } from '$lib/types/index.js';

// The 1-pet (PetVisualization) and 2-same-species (GenomeGridDiff) branches
// mount heavy components that load genome data asynchronously from the DB
// layer — those are covered by the redesign e2e. Here we assert the pure,
// deterministic EmptyState branches: 0, 2-mixed-species, and 3+.

const pet = (id: number, species: string, name: string): Pet =>
  ({ id, name, species, breed: '', gender: 'Female', tags: [] }) as unknown as Pet;

const ALL = [pet(1, 'Horse', 'Dusty'), pet(2, 'Horse', 'Roach'), pet(3, 'BeeWasp', 'Buzz')];

function select(ids: number[]) {
  libraryView.selectedIds = new Set(ids);
}

beforeEach(() => {
  pets.set(ALL);
  libraryView.selectedIds = new Set();
});

afterEach(() => {
  cleanup();
  pets.set([]);
  libraryView.selectedIds = new Set();
});

const emptyState = (c: HTMLElement) => c.querySelector('[data-testid="empty-state"]');

describe('Workspace', () => {
  it('prompts to pick a pet when nothing is selected', () => {
    select([]);
    const { container } = render(Workspace);
    expect(emptyState(container)?.textContent).toContain('Pick a pet to begin');
    expect(container.querySelector('[data-testid="workspace-compare"]')).toBeNull();
  });

  it('guides toward same-species when two different species are selected', () => {
    select([1, 3]); // Horse + BeeWasp
    const { container } = render(Workspace);
    expect(emptyState(container)?.textContent).toContain('Pick two pets of the same species');
    expect(container.querySelector('[data-testid="workspace-compare"]')).toBeNull();
  });

  it('points at the breeding lens for 3+ selected (next slice)', () => {
    select([1, 2, 3]);
    const { container } = render(Workspace);
    expect(emptyState(container)?.textContent).toContain('3 pets selected');
    expect(container.querySelector('[data-testid="workspace-compare"]')).toBeNull();
  });
});
