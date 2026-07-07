import '@testing-library/jest-dom/vitest';
import { cleanup, render, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SharedPet } from '$lib/types/index.js';

// Covers the community preview's lazy genome fetch (migrated onto keyedResource
// from the retired CommunityPetDetail): loading, loaded, fetch error, and a
// taken-down (missing genomeData) result must each render distinctly, and the
// Import button gates on the fetch state. The heavy gene grid / stats table are
// stubbed — their behaviour is covered by their own suites.

const importingHash: { value: string | null } = { value: null };
const importedHashes: { value: Set<string> } = { value: new Set() };
const importSelected = vi.fn();
vi.mock('$lib/stores/community.svelte.js', () => ({
  get communityView() {
    return { importingHash: importingHash.value, importedHashes: importedHashes.value };
  },
  importSelected: (p: SharedPet) => importSelected(p),
}));

const getSharedPet = vi.fn();
vi.mock('$lib/services/shareService.js', () => ({
  getSharedPet: (hash: string) => getSharedPet(hash),
}));

// Stub the heavy children so the test stays focused on fetch/import state.
vi.mock('$lib/components/gene/GeneVisualizer.svelte', async () => ({
  default: (await import('./fixtures/ChildStub.svelte')).default,
}));
vi.mock('$lib/components/gene/GeneStatsTable.svelte', async () => ({
  default: (await import('./fixtures/ChildStub.svelte')).default,
}));

import CommunityPetVisualization from '$lib/components/community/CommunityPetVisualization.svelte';

const GENOME = `[Overview]\nEntity=Buzz\nGenome=BeeWasp\n\n[Genes]\n1=DR\n`;

function makeSharedPet(overrides: Partial<SharedPet> = {}): SharedPet {
  return {
    contentHash: 'hash-7',
    name: 'Buzz',
    character: 'Player',
    species: 'BeeWasp',
    gender: 'Female',
    breed: '',
    breeder: 'Player',
    notes: '',
    tags: [],
    uploadedAt: new Date('2026-05-10T12:00:00Z'),
    schemaVersion: 1,
    appVersion: '1.0.0',
    ...overrides,
  } as SharedPet;
}

afterEach(() => {
  cleanup();
  importingHash.value = null;
  importedHashes.value = new Set();
  getSharedPet.mockReset();
  importSelected.mockReset();
});

describe('CommunityPetVisualization genome lazy-load', () => {
  it('shows a loading state with Import disabled while the genome is fetching', () => {
    getSharedPet.mockReturnValue(new Promise(() => {}));
    const { getByTestId } = render(CommunityPetVisualization, { pet: makeSharedPet() });
    expect(getByTestId('community-genome-loading')).toBeTruthy();
    expect(getByTestId('community-import')).toBeDisabled();
    expect(getSharedPet).toHaveBeenCalledWith('hash-7');
  });

  it('renders the genome visualizer and enables Import once the full pet resolves', async () => {
    getSharedPet.mockResolvedValue(makeSharedPet({ genomeData: GENOME }));
    const { getByTestId } = render(CommunityPetVisualization, { pet: makeSharedPet() });
    await waitFor(() => expect(getByTestId('child-stub')).toBeTruthy());
    expect(getByTestId('community-import')).toBeEnabled();
  });

  it('surfaces a fetch error distinctly (Import stays disabled)', async () => {
    getSharedPet.mockRejectedValue(new Error('network down'));
    const { getByText, getByTestId, queryByTestId } = render(CommunityPetVisualization, { pet: makeSharedPet() });
    await waitFor(() => expect(getByText(/network down/)).toBeTruthy());
    expect(queryByTestId('community-genome-loading')).toBeNull();
    expect(getByTestId('community-import')).toBeDisabled();
  });

  it('reports a taken-down pet (resolved but no genomeData)', async () => {
    getSharedPet.mockResolvedValue(makeSharedPet({ genomeData: undefined }));
    const { getByText } = render(CommunityPetVisualization, { pet: makeSharedPet() });
    await waitFor(() => expect(getByText(/may have been taken down/)).toBeTruthy());
  });

  it('imports the fetched pet when Import is clicked', async () => {
    const full = makeSharedPet({ genomeData: GENOME });
    getSharedPet.mockResolvedValue(full);
    importSelected.mockResolvedValue({ status: 'imported', message: 'done', pet_id: 1, tags: [] });
    const { getByTestId } = render(CommunityPetVisualization, { pet: makeSharedPet() });
    await waitFor(() => expect(getByTestId('community-import')).toBeEnabled());
    getByTestId('community-import').click();
    await waitFor(() =>
      expect(importSelected).toHaveBeenCalledWith(expect.objectContaining({ contentHash: 'hash-7' })),
    );
  });
});

describe('CommunityPetVisualization import feedback (#398)', () => {
  it('shows a success banner after a completed import', async () => {
    getSharedPet.mockResolvedValue(makeSharedPet({ genomeData: GENOME }));
    importSelected.mockResolvedValue({ status: 'imported', message: 'Imported to your stable', pet_id: 1, tags: [] });
    const { getByTestId } = render(CommunityPetVisualization, { pet: makeSharedPet() });
    await waitFor(() => expect(getByTestId('community-import')).toBeEnabled());
    getByTestId('community-import').click();
    await waitFor(() => expect(getByTestId('status-banner')).toHaveTextContent('Imported to your stable'));
  });

  it('renders a disabled "✓ Imported" button once the hash is in importedHashes', async () => {
    importedHashes.value = new Set(['hash-7']);
    getSharedPet.mockResolvedValue(makeSharedPet({ genomeData: GENOME }));
    const { getByTestId } = render(CommunityPetVisualization, { pet: makeSharedPet() });
    await waitFor(() => expect(getByTestId('community-import')).toHaveTextContent('✓ Imported'));
    expect(getByTestId('community-import')).toBeDisabled();
  });

  it('surfaces a failed import in an error banner and leaves the button clickable', async () => {
    getSharedPet.mockResolvedValue(makeSharedPet({ genomeData: GENOME }));
    importSelected.mockResolvedValue({ status: 'error', message: 'Import failed: hash mismatch' });
    const { getByTestId } = render(CommunityPetVisualization, { pet: makeSharedPet() });
    await waitFor(() => expect(getByTestId('community-import')).toBeEnabled());
    getByTestId('community-import').click();
    await waitFor(() => expect(getByTestId('status-banner')).toHaveTextContent('Import failed: hash mismatch'));
    expect(getByTestId('status-banner')).toHaveClass('banner-error');
    // No success latch on failure — the user can retry.
    expect(getByTestId('community-import')).toBeEnabled();
    expect(getByTestId('community-import')).toHaveTextContent('⬇ Import');
  });
});

// Header rework (#394/#395): the community detail adopts the shared
// BreedSelector popover (no Auto — there is no local pet to follow) and
// separates the Attributes/Appearance segmented pair from the Stats toggle
// and the Import action.
describe('CommunityPetVisualization detail header', () => {
  it('renders the shared BreedSelector for horses instead of the abbreviation row', () => {
    getSharedPet.mockReturnValue(new Promise(() => {}));
    const { container } = render(CommunityPetVisualization, {
      pet: makeSharedPet({ species: 'Horse', breed: 'Kurbone' }),
    });
    expect(container.querySelector('[data-testid="breed-selector-trigger"]')).not.toBeNull();
    expect(container.querySelectorAll('.breed-btn')).toHaveLength(0);
    // No Auto button in the community view.
    expect(container.querySelector('.auto-btn')).toBeNull();
  });

  it('omits the breed control for non-horse species', () => {
    getSharedPet.mockReturnValue(new Promise(() => {}));
    const { container } = render(CommunityPetVisualization, { pet: makeSharedPet() });
    expect(container.querySelector('[data-testid="breed-selector"]')).toBeNull();
  });

  it('keeps Attributes/Appearance segmented and Stats as a separate pressed toggle', () => {
    getSharedPet.mockReturnValue(new Promise(() => {}));
    const { container, getByTestId } = render(CommunityPetVisualization, { pet: makeSharedPet() });
    const segment = container.querySelector('.view-controls') as HTMLElement;
    expect([...segment.querySelectorAll('button')].map((b) => b.textContent?.trim())).toEqual([
      'Attributes',
      'Appearance',
    ]);
    const stats = getByTestId('detail-stats-toggle');
    expect(stats.getAttribute('aria-pressed')).toBe('false');
    expect(container.querySelector('.header-actions [data-testid="community-import"]')).not.toBeNull();
  });
});
