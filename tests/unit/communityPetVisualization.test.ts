import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { writable } from 'svelte/store';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Pet, SharedPet } from '$lib/types/index.js';

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

// The shared PetVisualization reads these for the Auto breed and the rarity baseline.
vi.mock('$lib/stores/settings.js', () => ({
  settings: writable<Record<string, unknown>>({}),
}));
vi.mock('$lib/stores/pets.js', () => ({
  appState: { deletePet: vi.fn(async () => {}) },
  pets: writable<Pet[]>([]),
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

// One detail view (PetVisualization) for My Pets and the catalogue: the same
// breed control, lenses and Stats toggle, with Import in place of the local
// Gallery / Share / Edit / Delete.
describe('CommunityPetVisualization detail header', () => {
  it('renders the shared BreedSelector with Auto for a horse of a known breed', () => {
    getSharedPet.mockReturnValue(new Promise(() => {}));
    const { container } = render(CommunityPetVisualization, {
      pet: makeSharedPet({ species: 'Horse', breed: 'Kurbone' }),
    });
    expect(container.querySelector('[data-testid="breed-selector-trigger"]')).not.toBeNull();
    expect(container.querySelector('.auto-btn')).not.toBeNull();
  });

  it('omits the breed control for non-horse species', () => {
    getSharedPet.mockReturnValue(new Promise(() => {}));
    const { container } = render(CommunityPetVisualization, { pet: makeSharedPet() });
    expect(container.querySelector('[data-testid="breed-selector"]')).toBeNull();
  });

  it('offers every lens of the My Pets view, rarity included', () => {
    getSharedPet.mockReturnValue(new Promise(() => {}));
    const { container } = render(CommunityPetVisualization, { pet: makeSharedPet() });
    const segment = container.querySelector('.view-controls') as HTMLElement;
    expect([...segment.querySelectorAll('button')].map((b) => b.textContent?.trim())).toEqual([
      'Attributes',
      'Appearance',
      'Rarity',
      'Impact',
    ]);
  });

  it('shows Import, not the local-only Gallery / Share / Edit / Delete', () => {
    getSharedPet.mockReturnValue(new Promise(() => {}));
    const { container, getByTestId, queryByTestId } = render(CommunityPetVisualization, { pet: makeSharedPet() });
    expect(getByTestId('detail-stats-toggle').getAttribute('aria-pressed')).toBe('false');
    expect(queryByTestId('detail-gallery-toggle')).toBeNull();
    expect(queryByTestId('share-pet-btn')).toBeNull();
    expect(container.querySelector('.header-actions')).toBeNull();
    expect(container.querySelector('.extra-actions [data-testid="community-import"]')).not.toBeNull();
  });

  it('keeps the catalogue metadata, tags and notes in the header', () => {
    getSharedPet.mockReturnValue(new Promise(() => {}));
    const { container, getByText } = render(CommunityPetVisualization, {
      pet: makeSharedPet({ breeder: 'Alice', tags: ['champion'], notes: 'Calm temper' }),
    });
    const meta = container.querySelector('.detail-meta') as HTMLElement;
    expect(meta).toHaveTextContent('by Alice');
    expect(meta).toHaveTextContent('champion');
    expect(getByText('Calm temper')).toBeTruthy();
  });

  it('shows the breeder from the fetched record, which restores first-share identity', async () => {
    getSharedPet.mockResolvedValue(makeSharedPet({ genomeData: GENOME, breeder: 'Original' }));
    const { container, getByTestId } = render(CommunityPetVisualization, {
      pet: makeSharedPet({ breeder: 'Spoofed' }),
    });
    await waitFor(() => expect(getByTestId('child-stub')).toBeTruthy());
    const meta = container.querySelector('.detail-meta') as HTMLElement;
    expect(meta).toHaveTextContent('by Original');
    expect(meta).not.toHaveTextContent('Spoofed');
  });

  it('hands a view picked while the genome loads to the grid once it mounts', async () => {
    let resolve: (p: SharedPet) => void = () => {};
    getSharedPet.mockReturnValue(new Promise((r) => (resolve = r)));
    const { getByTestId } = render(CommunityPetVisualization, { pet: makeSharedPet() });
    await fireEvent.click(getByTestId('view-impact-btn'));
    resolve(makeSharedPet({ genomeData: GENOME }));
    await waitFor(() => expect(getByTestId('child-stub').dataset.view).toBe('impact'));
  });

  it('titles the stats drawer for the impact view', async () => {
    getSharedPet.mockResolvedValue(makeSharedPet({ genomeData: GENOME }));
    const { container, getByTestId } = render(CommunityPetVisualization, { pet: makeSharedPet() });
    await waitFor(() => expect(getByTestId('child-stub')).toBeTruthy());
    await fireEvent.click(getByTestId('view-impact-btn'));
    await fireEvent.click(getByTestId('detail-stats-toggle'));
    expect(container.querySelector('.stats-drawer-title')?.textContent?.trim()).toBe('Impact');
  });
});
