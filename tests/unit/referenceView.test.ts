import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/services/geneService.js', async (orig) => ({
  ...(await orig<typeof import('$lib/services/geneService.js')>()),
  getAnimalTypes: vi.fn(async () => ['beewasp', 'horse']),
  getChromosomes: vi.fn(async () => ['01', '02']),
}));
// The map is not under test and needs a database.
vi.mock('$lib/components/gene/GenomeMap.svelte', async () => ({
  default: (await import('./fixtures/ChildStub.svelte')).default,
}));

import ReferenceView from '$lib/components/gene/ReferenceView.svelte';
import { pets } from '$lib/stores/pets.js';
import { referenceView } from '$lib/stores/reference.svelte.js';
import type { Pet } from '$lib/types/index.js';

const many = (species: string, n: number, from = 0) =>
  Array.from({ length: n }, (_, i) => ({ id: from + i, species }) as unknown as Pet);
const active = (c: HTMLElement) =>
  c.querySelector('[data-testid="reference-species"] .seg-btn.active')?.getAttribute('data-species');

describe('ReferenceView species', () => {
  beforeEach(() => {
    referenceView.animalType = '';
    pets.set([...many('Horse', 3), ...many('BeeWasp', 1, 10)]);
  });
  afterEach(cleanup);

  it('pins the default when the editor opens, so a pet-list reload cannot move it', async () => {
    const { container, getByTestId } = render(ReferenceView);
    await waitFor(() => expect(active(container)).toBe('horse'));

    await fireEvent.click(getByTestId('reference-edit-toggle'));
    expect(referenceView.animalType).toBe('horse');

    // Beewasps now outnumber horses; an unpinned default would switch.
    pets.set([...many('Horse', 3), ...many('BeeWasp', 9, 10)]);
    await waitFor(() => expect(active(container)).toBe('horse'));
  });
});
