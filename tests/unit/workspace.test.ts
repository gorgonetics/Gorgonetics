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
  it('shows the roster when nothing is selected and pets exist', () => {
    select([]);
    const { container } = render(Workspace);
    expect(container.querySelector('[data-testid="workspace-roster"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="roster"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="workspace-multi"]')).toBeNull();
  });

  it('shows an empty state only when there are no pets at all', () => {
    pets.set([]);
    select([]);
    const { container } = render(Workspace);
    expect(emptyState(container)?.textContent).toContain('No pets yet');
    expect(container.querySelector('[data-testid="workspace-roster"]')).toBeNull();
  });

  it('guides toward same-species when two different species are selected', () => {
    select([1, 3]); // Horse + BeeWasp
    const { container } = render(Workspace);
    expect(emptyState(container)?.textContent).toContain('Pick pets of the same species');
    expect(container.querySelector('[data-testid="workspace-multi"]')).toBeNull();
  });

  it('guides toward same-species for a 3+ mixed-species selection', () => {
    select([1, 2, 3]); // Horse, Horse, BeeWasp
    const { container } = render(Workspace);
    expect(emptyState(container)?.textContent).toContain('Pick pets of the same species');
    expect(container.querySelector('[data-testid="workspace-multi"]')).toBeNull();
  });

  it('does NOT treat two unknown-species pets as same-species', () => {
    // Both normalize to '' — must not open the multi lens (would error in the diff/rank).
    pets.set([pet(10, 'Mystery', 'Q'), pet(11, '', 'Z')]);
    select([10, 11]);
    const { container } = render(Workspace);
    expect(container.querySelector('[data-testid="workspace-multi"]')).toBeNull();
    expect(emptyState(container)?.textContent).toContain('Pick pets of the same species');
  });
});
