import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/firebase.js', () => ({
  // Placeholder check used by `loadInitial` to short-circuit when the
  // build doesn't have a real Firestore wired up. We set it to `false`
  // so the store's happy paths exercise the actual fetch/cache logic.
  isPlaceholderConfig: false,
  firestore: { __mock: 'firestore' },
}));

vi.mock('$lib/services/shareService.js', () => ({
  listPets: vi.fn(),
  importCommunityPet: vi.fn(),
  getSharedPet: vi.fn(),
  uploadPet: vi.fn(),
  sanitizeTags: (xs) => xs,
  verifySharedPet: vi.fn(),
}));

vi.mock('$lib/stores/pets.js', () => ({
  appState: {
    loadPets: vi.fn().mockResolvedValue(undefined),
  },
}));

import { importCommunityPet, listPets } from '$lib/services/shareService.js';
import { appState } from '$lib/stores/pets.js';
import {
  _resetCommunityStoreState,
  clearSelection,
  communityView,
  importSelected,
  loadInitial,
  selectedSharedPet,
  selectPet,
} from '$lib/stores/community.svelte.js';

function makeSharedPet(hash, overrides = {}) {
  return {
    contentHash: hash,
    name: `Pet-${hash}`,
    character: 'Player',
    species: 'BeeWasp',
    gender: 'Female',
    breed: '',
    breeder: 'Player',
    notes: '',
    tags: [],
    schemaVersion: 1,
    appVersion: '0.6.3',
    uploadedAt: new Date('2026-05-10T12:00:00Z'),
    uploaderUid: null,
    ...overrides,
  };
}

afterEach(() => {
  // Reset both call history and queued mock values; restore the store
  // to a pristine state so tests don't cross-pollute via cached pages
  // or in-flight generation counters.
  vi.resetAllMocks();
  _resetCommunityStoreState();
  communityView.pets = [];
  communityView.loading = false;
  communityView.loadingMore = false;
  communityView.error = null;
  communityView.hasMore = true;
  communityView.cursor = null;
  communityView.selectedHash = null;
  communityView.importingHash = null;
});

describe('community.svelte.ts — loadInitial', () => {
  beforeEach(() => {
    // Re-stub the mocked appState.loadPets each test because resetAllMocks
    // wipes the resolved value too.
    appState.loadPets.mockResolvedValue(undefined);
  });

  it('skips the fetch when a load is already in flight (concurrent calls dedupe)', async () => {
    // First call is in-flight; second non-force call should noop, not
    // race the first to overwrite the page.
    let resolveFirst;
    listPets.mockImplementationOnce(
      () => new Promise((res) => {
        resolveFirst = res;
      }),
    );
    const first = loadInitial();
    // Second call fires while first is still pending.
    await loadInitial();
    expect(listPets).toHaveBeenCalledTimes(1);
    resolveFirst({ pets: [], cursor: null });
    await first;
  });

  it('uses the fresh cache within STALE_AFTER_MS regardless of empty catalogue', async () => {
    // An empty catalogue is still cached — without this, `pets.length === 0`
    // would force a refetch on every tab toggle and burn Spark quota.
    listPets.mockResolvedValueOnce({ pets: [], cursor: null });
    await loadInitial();
    expect(listPets).toHaveBeenCalledTimes(1);

    await loadInitial();
    expect(listPets).toHaveBeenCalledTimes(1); // still one
  });

  it('force-refresh bypasses the cache and supersedes in-flight stale results', async () => {
    // The "Try again" UI calls `loadInitial({ force: true })`. The
    // older in-flight load must NOT overwrite the fresher result on
    // resolution — generation-token gating drops its return value.
    let resolveStale;
    listPets.mockImplementationOnce(
      () => new Promise((res) => {
        resolveStale = res;
      }),
    );
    const stale = loadInitial();

    // Fresh forced call resolves immediately.
    listPets.mockResolvedValueOnce({ pets: [makeSharedPet('fresh')], cursor: null });
    await loadInitial({ force: true });
    expect(communityView.pets).toHaveLength(1);
    expect(communityView.pets[0].contentHash).toBe('fresh');

    // Now the stale load resolves with old data — must be discarded.
    resolveStale({ pets: [makeSharedPet('stale-a'), makeSharedPet('stale-b')], cursor: null });
    await stale;
    expect(communityView.pets).toHaveLength(1);
    expect(communityView.pets[0].contentHash).toBe('fresh');
  });

  it('clears selectedHash if it has been paginated out on refresh', async () => {
    // Seed a selection that lives in the current page.
    listPets.mockResolvedValueOnce({ pets: [makeSharedPet('A'), makeSharedPet('B')], cursor: null });
    await loadInitial();
    selectPet('B');
    expect(selectedSharedPet()?.contentHash).toBe('B');

    // Forced refresh — `B` is no longer on the new first page.
    listPets.mockResolvedValueOnce({ pets: [makeSharedPet('C')], cursor: null });
    await loadInitial({ force: true });
    expect(communityView.selectedHash).toBeNull();
    expect(selectedSharedPet()).toBeNull();
  });

  it('preserves selectedHash when the selected pet is still on the new page', async () => {
    listPets.mockResolvedValueOnce({ pets: [makeSharedPet('A'), makeSharedPet('B')], cursor: null });
    await loadInitial();
    selectPet('A');
    listPets.mockResolvedValueOnce({ pets: [makeSharedPet('A'), makeSharedPet('C')], cursor: null });
    await loadInitial({ force: true });
    expect(communityView.selectedHash).toBe('A');
  });

  it('keeps existing pets on error (transient failures don\'t blow away the view)', async () => {
    listPets.mockResolvedValueOnce({ pets: [makeSharedPet('A')], cursor: null });
    await loadInitial();
    listPets.mockRejectedValueOnce(new Error('Network down'));
    await loadInitial({ force: true });
    expect(communityView.pets).toHaveLength(1);
    expect(communityView.error).toMatch(/Failed to load/);
  });
});

describe('community.svelte.ts — importSelected', () => {
  beforeEach(() => {
    appState.loadPets.mockResolvedValue(undefined);
  });

  it('serializes imports: a second concurrent call rejects with an in-progress message', async () => {
    let resolveFirst;
    importCommunityPet.mockImplementationOnce(
      () => new Promise((res) => {
        resolveFirst = res;
      }),
    );
    const pet = makeSharedPet('first', { genomeData: 'raw' });
    const firstPromise = importSelected(pet);

    // Second call comes in while the first is pending.
    const secondResult = await importSelected(makeSharedPet('second', { genomeData: 'raw' }));
    expect(secondResult.status).toBe('error');
    expect(secondResult.message).toMatch(/already in progress/i);

    resolveFirst({ status: 'imported', message: 'ok', pet_id: 1 });
    await firstPromise;
  });

  it('triggers appState.loadPets() on imported status', async () => {
    importCommunityPet.mockResolvedValueOnce({ status: 'imported', message: 'ok', pet_id: 1 });
    await importSelected(makeSharedPet('imp', { genomeData: 'raw' }));
    // The refresh is fire-and-forget — await a microtask so it runs.
    await Promise.resolve();
    expect(appState.loadPets).toHaveBeenCalledTimes(1);
  });

  it('triggers appState.loadPets() on already-imported (backfill / race-recovery mutate local state too)', async () => {
    // Regression guard: an earlier revision only refreshed on
    // 'imported', so the backfill / race-recovery paths (which apply
    // the community tag to an existing row) left the in-memory pets
    // store stale until the user navigated away and back.
    importCommunityPet.mockResolvedValueOnce({ status: 'already-imported', message: 'linked', pet_id: 7 });
    await importSelected(makeSharedPet('back', { genomeData: 'raw' }));
    await Promise.resolve();
    expect(appState.loadPets).toHaveBeenCalledTimes(1);
  });

  it('does NOT trigger appState.loadPets() on error', async () => {
    importCommunityPet.mockResolvedValueOnce({ status: 'error', message: 'boom' });
    await importSelected(makeSharedPet('err', { genomeData: 'raw' }));
    await Promise.resolve();
    expect(appState.loadPets).not.toHaveBeenCalled();
  });

  it('releases the importingHash slot after completion (success and failure both)', async () => {
    importCommunityPet.mockResolvedValueOnce({ status: 'imported', message: 'ok', pet_id: 1 });
    await importSelected(makeSharedPet('a', { genomeData: 'raw' }));
    expect(communityView.importingHash).toBeNull();

    importCommunityPet.mockRejectedValueOnce(new Error('thrown'));
    const result = await importSelected(makeSharedPet('b', { genomeData: 'raw' }));
    expect(result.status).toBe('error');
    expect(communityView.importingHash).toBeNull();
  });
});

describe('community.svelte.ts — selection helpers', () => {
  it('selectPet / clearSelection round-trip', () => {
    selectPet('xyz');
    expect(communityView.selectedHash).toBe('xyz');
    clearSelection();
    expect(communityView.selectedHash).toBeNull();
  });
});
