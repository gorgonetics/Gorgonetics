import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, within } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SharedPet } from '$lib/types/index.js';

// The community table mirrors the local roster: species-aware attribute
// columns + Total, sortable, click-to-open, and (#397) a shared FilterBar
// filtering client-side over the loaded pages. Selection is dispatched
// through the store (CommunityTab hosts the overlay). Attribute columns
// that are empty for every loaded row are hidden entirely instead of
// rendering a dash per row.

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

const BEE_ATTRS = {
  intelligence: 10,
  toughness: 20,
  friendliness: 0,
  ruggedness: 0,
  enthusiasm: 0,
  virility: 0,
  ferocity: 40,
};

afterEach(() => {
  cleanup();
  selectPet.mockReset();
  store.pets = [];
  store.selectedHash = null;
  store.hasMore = false;
});

describe('CommunityPetTable', () => {
  it('renders species-aware attribute cells and a Total, hiding all-empty columns', () => {
    store.pets = [makePet({ contentHash: 'bee', species: 'BeeWasp', attributes: BEE_ATTRS })];
    const { getByTestId } = render(CommunityPetTable);
    const row = getByTestId('community-row');
    const cells = within(row).getAllByRole('gridcell');
    // Name, Owner, Species, Gender, Breed, 7 populated attrs, Total,
    // Uploaded = 14 cells. Temperament (horse-only, empty for every loaded
    // row) is hidden entirely rather than rendering a dash.
    expect(cells).toHaveLength(14);
    // Attribute columns start at index 5; Ferocity is the 7th visible attr.
    expect(cells[11]).toHaveTextContent('40');
    // Total sums the applicable published attributes (10+20+40 = 70).
    expect(cells[12]).toHaveTextContent('70');
  });

  it('uses full attribute names in headers, matching My Pets', () => {
    store.pets = [makePet({ contentHash: 'bee', attributes: BEE_ATTRS })];
    const { getByRole, queryByRole } = render(CommunityPetTable);
    expect(getByRole('button', { name: /^Intelligence/ })).toBeTruthy();
    expect(getByRole('button', { name: /^Ferocity/ })).toBeTruthy();
    // No loaded row carries Temperament → its column (header included) is hidden.
    expect(queryByRole('button', { name: /^Temperament/ })).toBeNull();
  });

  it('hides all stat columns (and Total) when no loaded entry has attributes', () => {
    store.pets = [makePet({ contentHash: 'legacy' })];
    const { getByTestId, queryByRole } = render(CommunityPetTable);
    const cells = within(getByTestId('community-row')).getAllByRole('gridcell');
    // Only Name, Owner, Species, Gender, Breed, Uploaded remain.
    expect(cells).toHaveLength(6);
    expect(queryByRole('button', { name: /^Intelligence/ })).toBeNull();
    expect(queryByRole('button', { name: /^Total/ })).toBeNull();
  });

  it('shows a column when any loaded row fills it; legacy rows dash within it', () => {
    store.pets = [
      makePet({ contentHash: 'modern', attributes: BEE_ATTRS }),
      makePet({ contentHash: 'legacy', name: 'Old' }),
    ];
    const { getAllByTestId } = render(CommunityPetTable);
    const rows = getAllByTestId('community-row');
    const legacyRow = rows.find((r) => r.getAttribute('data-content-hash') === 'legacy');
    const cells = within(legacyRow as HTMLElement).getAllByRole('gridcell');
    expect(cells).toHaveLength(14);
    expect(cells[5]).toHaveTextContent('—'); // Intelligence, absent on legacy
    expect(cells[12]).toHaveTextContent('—'); // Total
  });

  it('renders the owner (Character) name', () => {
    store.pets = [makePet({ contentHash: 'owned', character: 'Konekonyan', breeder: 'Konekonyan' })];
    const cells = within(render(CommunityPetTable).getByTestId('community-row')).getAllByRole('gridcell');
    expect(cells[1]).toHaveTextContent('Konekonyan'); // Owner column, after Name
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
    await fireEvent.click(getByText(/^Intelligence/));
    const rows = getAllByTestId('community-row');
    expect(rows[0].getAttribute('data-content-hash')).toBe('high');
    // Second click flips to ascending.
    await fireEvent.click(getByText(/^Intelligence/));
    const asc = getAllByTestId('community-row');
    expect(asc[0].getAttribute('data-content-hash')).toBe('low');
  });
});

describe('CommunityPetTable — filtering (#397)', () => {
  it('filters rows by name search and reports an honest loaded-set count', async () => {
    store.pets = [makePet({ contentHash: 'a', name: 'Buzz' }), makePet({ contentHash: 'b', name: 'Sting' })];
    const { getByTestId, getAllByTestId } = render(CommunityPetTable);
    await fireEvent.input(getByTestId('filter-search'), { target: { value: 'buz' } });
    const rows = getAllByTestId('community-row');
    expect(rows).toHaveLength(1);
    expect(rows[0].getAttribute('data-content-hash')).toBe('a');
    expect(getByTestId('community-filter-count')).toHaveTextContent('1 of 2 loaded pets match');
  });

  it('search also matches the owner name', async () => {
    store.pets = [
      makePet({ contentHash: 'a', name: 'Buzz', character: 'Konekonyan', breeder: 'Konekonyan' }),
      makePet({ contentHash: 'b', name: 'Sting', character: 'Somebody', breeder: 'Somebody' }),
    ];
    const { getByTestId, getAllByTestId } = render(CommunityPetTable);
    await fireEvent.input(getByTestId('filter-search'), { target: { value: 'koneko' } });
    const rows = getAllByTestId('community-row');
    expect(rows).toHaveLength(1);
    expect(rows[0].getAttribute('data-content-hash')).toBe('a');
  });

  it('filters by species via the segmented toggle', async () => {
    store.pets = [
      makePet({ contentHash: 'bee', species: 'BeeWasp' }),
      makePet({ contentHash: 'horse', species: 'Horse' }),
    ];
    const { getByTestId, getAllByTestId } = render(CommunityPetTable);
    const speciesGroup = getByTestId('filter-species');
    await fireEvent.click(within(speciesGroup).getByRole('button', { name: 'horse' }));
    const rows = getAllByTestId('community-row');
    expect(rows).toHaveLength(1);
    expect(rows[0].getAttribute('data-content-hash')).toBe('horse');
  });

  it('filters by gender', async () => {
    store.pets = [makePet({ contentHash: 'f', gender: 'Female' }), makePet({ contentHash: 'm', gender: 'Male' })];
    const { getByTestId, getAllByTestId } = render(CommunityPetTable);
    const genderGroup = getByTestId('filter-gender');
    await fireEvent.click(within(genderGroup).getByRole('button', { name: 'Male' }));
    const rows = getAllByTestId('community-row');
    expect(rows).toHaveLength(1);
    expect(rows[0].getAttribute('data-content-hash')).toBe('m');
  });

  it('filters by breed once a species is selected', async () => {
    store.pets = [
      makePet({ contentHash: 'il', species: 'Horse', breed: 'Ilmarian' }),
      makePet({ contentHash: 'pt', species: 'Horse', breed: 'Paint' }),
    ];
    const { getByTestId, getAllByTestId, queryByTestId } = render(CommunityPetTable);
    // Breed control only appears for a species-scoped view.
    expect(queryByTestId('breed-selector')).toBeNull();
    const speciesGroup = getByTestId('filter-species');
    await fireEvent.click(within(speciesGroup).getByRole('button', { name: 'horse' }));
    await fireEvent.click(getByTestId('breed-selector-trigger'));
    await fireEvent.click(within(getByTestId('breed-selector-pop')).getByRole('button', { name: /Ilmarian/ }));
    const rows = getAllByTestId('community-row');
    expect(rows).toHaveLength(1);
    expect(rows[0].getAttribute('data-content-hash')).toBe('il');
  });

  it('offers tag pills from the loaded entries and filters on them', async () => {
    store.pets = [makePet({ contentHash: 'tagged', tags: ['starter'] }), makePet({ contentHash: 'plain' })];
    const { getByTestId, getAllByTestId } = render(CommunityPetTable);
    const tagGroup = getByTestId('filter-tags');
    await fireEvent.click(within(tagGroup).getByRole('button', { name: /starter/ }));
    const rows = getAllByTestId('community-row');
    expect(rows).toHaveLength(1);
    expect(rows[0].getAttribute('data-content-hash')).toBe('tagged');
  });

  it('keeps Load more visible and flags unloaded pages when a filter matches nothing', async () => {
    store.pets = [makePet({ contentHash: 'a', name: 'Buzz' })];
    store.hasMore = true;
    const { getByTestId, queryAllByTestId } = render(CommunityPetTable);
    await fireEvent.input(getByTestId('filter-search'), { target: { value: 'zzz' } });
    expect(queryAllByTestId('community-row')).toHaveLength(0);
    // Empty-match row points at the pagination escape hatch…
    expect(getByTestId('community-filter-empty')).toHaveTextContent('Load more to search older entries');
    // …the count is honest about only covering loaded pages…
    expect(getByTestId('community-filter-count')).toHaveTextContent('older entries not loaded yet');
    // …and the Load More button stays available.
    expect(getByTestId('community-load-more')).toBeEnabled();
  });

  it('omits the unloaded-pages caveat at the end of the catalogue', async () => {
    store.pets = [makePet({ contentHash: 'a', name: 'Buzz' }), makePet({ contentHash: 'b', name: 'Sting' })];
    store.hasMore = false;
    const { getByTestId } = render(CommunityPetTable);
    await fireEvent.input(getByTestId('filter-search'), { target: { value: 'buzz' } });
    const count = getByTestId('community-filter-count');
    expect(count).toHaveTextContent('1 of 2 loaded pets match');
    expect(count).not.toHaveTextContent('older entries not loaded yet');
  });
});
