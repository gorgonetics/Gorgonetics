import '@testing-library/jest-dom/vitest';
import { cleanup, render, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SharedPet } from '$lib/types/index.js';

// Covers the detail pane's lazy genome fetch after it was migrated onto the
// shared keyedResource helper (issue #254 review): loading, loaded, a real
// fetch error, and a taken-down (missing genomeData) result must each render
// distinctly.

let currentPet: SharedPet | null = null;
const importingHash: { value: string | null } = { value: null };

vi.mock('$lib/stores/community.svelte.js', () => ({
  selectedSharedPet: () => currentPet,
  get communityView() {
    return { importingHash: importingHash.value };
  },
  importSelected: vi.fn(),
  clearSelection: vi.fn(),
}));

const getSharedPet = vi.fn();
vi.mock('$lib/services/shareService.js', () => ({
  getSharedPet: (hash: string) => getSharedPet(hash),
}));

import CommunityPetDetail from '$lib/components/community/CommunityPetDetail.svelte';

afterEach(() => {
  cleanup();
  currentPet = null;
  importingHash.value = null;
  getSharedPet.mockReset();
});

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
  } as unknown as SharedPet;
}

describe('CommunityPetDetail genome lazy-load', () => {
  it('shows a loading state with Import disabled while the genome is fetching', () => {
    currentPet = makeSharedPet();
    getSharedPet.mockReturnValue(new Promise(() => {})); // never resolves

    const { getByTestId } = render(CommunityPetDetail);
    expect(getByTestId('community-genome-loading')).toBeTruthy();
    expect(getByTestId('community-import')).toBeDisabled();
    expect(getSharedPet).toHaveBeenCalledWith('hash-7');
  });

  it('renders the genome preview and enables Import once the full pet resolves', async () => {
    currentPet = makeSharedPet();
    getSharedPet.mockResolvedValue(makeSharedPet({ genomeData: 'GENOME-BODY' }));

    const { getByText, getByTestId } = render(CommunityPetDetail);
    await waitFor(() => expect(getByText('GENOME-BODY')).toBeTruthy());
    expect(getByTestId('community-import')).toBeEnabled();
  });

  it('surfaces a fetch error distinctly (Import stays disabled)', async () => {
    currentPet = makeSharedPet();
    getSharedPet.mockRejectedValue(new Error('network down'));

    const { getByText, getByTestId, queryByTestId } = render(CommunityPetDetail);
    await waitFor(() => expect(getByText(/network down/)).toBeTruthy());
    expect(queryByTestId('community-genome-loading')).toBeNull();
    expect(getByTestId('community-import')).toBeDisabled();
  });

  it('reports a taken-down pet (resolved but no genomeData)', async () => {
    currentPet = makeSharedPet();
    getSharedPet.mockResolvedValue(makeSharedPet({ genomeData: undefined }));

    const { getByText } = render(CommunityPetDetail);
    await waitFor(() => expect(getByText(/may have been taken down/)).toBeTruthy());
  });
});
