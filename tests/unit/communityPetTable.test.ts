import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, within } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SharedPet } from '$lib/types/index.js';

// The community table mirrors the local roster: species-aware attribute
// columns + Total, sortable, click-to-open. Selection is dispatched through
// the store (CommunityTab hosts the overlay).

const selectPet = vi.fn();
const store = {
  pets: [] as SharedPet[],
  loading: false,
  loadingMore: false,
  error: null as string | null,
  hasMore: false,
  selectedHash: null as string | null,
};

vi.mock('$lib/stores/community.svelte.js', () => ({
  get communityView() {
    return store;
  },
  loadInitial: vi.fn(),
  loadMore: vi.fn(),
  selectPet: (hash: string) => selectPet(hash),
}));

vi.mock('$lib/utils/timestamp.js', () => ({
  formatShortDate: (d: Date) => (d instanceof Date ? d.toISOString().slice(0, 10) : ''),
}));

import CommunityPetTable from '$lib/components/community/CommunityPetTable.svelte';

function makePet(overrides: Partial<SharedPet> = {}): SharedPet {
  return {
    contentHash: 'hash-1',
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
  selectPet.mockReset();
  store.pets = [];
  store.selectedHash = null;
});

describe('CommunityPetTable', () => {
  it('renders species-aware attribute cells and a Total', () => {
    store.pets = [
      makePet({
        contentHash: 'bee',
        species: 'BeeWasp',
        attributes: {
          intelligence: 10,
          toughness: 20,
          friendliness: 0,
          ruggedness: 0,
          enthusiasm: 0,
          virility: 0,
          ferocity: 40,
        },
      }),
    ];
    const { getByTestId } = render(CommunityPetTable);
    const row = getByTestId('community-row');
    const cells = within(row).getAllByRole('gridcell');
    // Name, Owner, Species, Gender, Breed, 8 attrs, Total, Uploaded = 15 cells.
    expect(cells).toHaveLength(15);
    // Attribute columns start at index 5 (after Name, Owner, Species, Gender, Breed).
    // Ferocity (bee attribute) is filled; Temperament (horse-only) is blank.
    const ferCell = cells[11]; // Int(5)...Vir(10) Fer(11) Tem(12)
    const temCell = cells[12];
    expect(ferCell).toHaveTextContent('40');
    expect(temCell).toHaveTextContent('—');
    // Total sums the applicable published attributes (10+20+40 = 70).
    expect(cells[13]).toHaveTextContent('70');
  });

  it('renders the owner (Character) name', () => {
    store.pets = [makePet({ contentHash: 'owned', character: 'Konekonyan', breeder: 'Konekonyan' })];
    const cells = within(render(CommunityPetTable).getByTestId('community-row')).getAllByRole('gridcell');
    expect(cells[1]).toHaveTextContent('Konekonyan'); // Owner column, after Name
  });

  it('shows dashes across attribute columns for legacy entries with no attributes', () => {
    store.pets = [makePet({ contentHash: 'legacy' })];
    const { getByTestId } = render(CommunityPetTable);
    const cells = within(getByTestId('community-row')).getAllByRole('gridcell');
    expect(cells[5]).toHaveTextContent('—'); // first attribute column
    expect(cells[13]).toHaveTextContent('—'); // total
  });

  it('selects a pet on row click', async () => {
    store.pets = [makePet({ contentHash: 'clicked' })];
    const { getByTestId } = render(CommunityPetTable);
    await fireEvent.click(getByTestId('community-row'));
    expect(selectPet).toHaveBeenCalledWith('clicked');
  });

  it('sorts by an attribute column when its header is clicked', async () => {
    store.pets = [
      makePet({ contentHash: 'low', name: 'Low', attributes: { intelligence: 5 } }),
      makePet({ contentHash: 'high', name: 'High', attributes: { intelligence: 90 } }),
    ];
    const { getByText, getAllByTestId } = render(CommunityPetTable);
    // First click on a numeric header sorts descending → highest first.
    await fireEvent.click(getByText(/^Int/));
    const rows = getAllByTestId('community-row');
    expect(rows[0].getAttribute('data-content-hash')).toBe('high');
    // Second click flips to ascending.
    await fireEvent.click(getByText(/^Int/));
    const asc = getAllByTestId('community-row');
    expect(asc[0].getAttribute('data-content-hash')).toBe('low');
  });
});
