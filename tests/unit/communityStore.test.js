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
import {
  _resetCommunityStoreState,
  clearSelection,
  communityView,
  importSelected,
  loadInitial,
  loadMore,
  selectedSharedPet,
  selectPet,
} from '$lib/stores/community.svelte.js';
import { appState } from '$lib/stores/pets.js';

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
      () =>
        new Promise((res) => {
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
      () =>
        new Promise((res) => {
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

  it("keeps existing pets on error (transient failures don't blow away the view)", async () => {
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
      () =>
        new Promise((res) => {
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

describe('community.svelte.ts — loadMore', () => {
  // PAGE_SIZE is a module-private constant in the store. The exact value
  // is asserted indirectly: a returned page of exactly PAGE_SIZE rows
  // leaves `hasMore = true`, and a short page sets `hasMore = false`.
  // Keep this in sync if PAGE_SIZE changes; the regression risk is the
  // hasMore boundary, not the literal number.
  const PAGE_SIZE = 50;
  const fullPage = (prefix) => Array.from({ length: PAGE_SIZE }, (_, i) => makeSharedPet(`${prefix}-${i}`));

  async function seedFirstPage() {
    listPets.mockResolvedValueOnce({ pets: fullPage('p1'), cursor: { __snap: 'p1-cursor' } });
    await loadInitial();
    expect(communityView.pets).toHaveLength(PAGE_SIZE);
    expect(communityView.hasMore).toBe(true);
  }

  it('appends the next page to the existing pets and advances the cursor', async () => {
    await seedFirstPage();
    const secondPage = fullPage('p2');
    listPets.mockResolvedValueOnce({ pets: secondPage, cursor: { __snap: 'p2-cursor' } });

    await loadMore();
    expect(communityView.pets).toHaveLength(PAGE_SIZE * 2);
    expect(communityView.pets[PAGE_SIZE].contentHash).toBe('p2-0');
    expect(communityView.cursor).toEqual({ __snap: 'p2-cursor' });
    expect(communityView.hasMore).toBe(true);
    expect(listPets).toHaveBeenLastCalledWith({ limit: PAGE_SIZE, after: { __snap: 'p1-cursor' } });
  });

  it('sets hasMore = false on a short final page', async () => {
    await seedFirstPage();
    listPets.mockResolvedValueOnce({ pets: [makeSharedPet('tail')], cursor: { __snap: 'p2-cursor' } });

    await loadMore();
    expect(communityView.pets).toHaveLength(PAGE_SIZE + 1);
    expect(communityView.hasMore).toBe(false);
  });

  it('noops when a first-page load is in flight (avoids stale-cursor append)', async () => {
    // Starting a pagination while `communityView.loading === true`
    // captures the same `loadGeneration` the upcoming refresh will
    // use, but reads the OLD cursor. If the refresh resolves first
    // the pagination's generation check still passes — and the old
    // page-2 would land appended onto the new page-1 with
    // duplicates or boundary gaps. Better to skip the pagination
    // entirely while a refresh is mid-flight.
    communityView.loading = true;
    communityView.cursor = { __snap: 'stale' };
    communityView.hasMore = true;
    await loadMore();
    expect(listPets).not.toHaveBeenCalled();
  });

  it('noops when hasMore is false', async () => {
    communityView.hasMore = false;
    communityView.cursor = { __snap: 'any' };
    await loadMore();
    expect(listPets).not.toHaveBeenCalled();
  });

  it('noops when the cursor is null (initial state)', async () => {
    communityView.hasMore = true;
    communityView.cursor = null;
    await loadMore();
    expect(listPets).not.toHaveBeenCalled();
  });

  it('preserves existing pets on error and surfaces the message', async () => {
    await seedFirstPage();
    listPets.mockRejectedValueOnce(new Error('Network blip'));

    await loadMore();
    // Existing rows MUST remain — pagination error should never blow
    // away what the user is already looking at.
    expect(communityView.pets).toHaveLength(PAGE_SIZE);
    expect(communityView.error).toMatch(/Failed to load more/);
  });

  it('discards a stale loadMore result when a forced refresh supersedes it', async () => {
    // Pagination races against `loadInitial({ force: true })`: if the
    // user hits "Try again" while a page is in flight, the older
    // listPets result is being appended against a cursor that no
    // longer matches the refreshed first page — naïvely appending
    // would corrupt the page boundary with duplicates or gaps.
    // Generation-token gating must drop the stale append.
    await seedFirstPage();
    listPets.mockClear();

    // Start a pagination that won't resolve until we release it.
    let resolveStaleMore;
    listPets.mockImplementationOnce(
      () =>
        new Promise((res) => {
          resolveStaleMore = res;
        }),
    );
    const stalePagination = loadMore();

    // Simulate a forced refresh during the pagination — bumps
    // `loadGeneration`, replaces the page.
    listPets.mockResolvedValueOnce({ pets: [makeSharedPet('fresh-a')], cursor: { __snap: 'fresh-cursor' } });
    await loadInitial({ force: true });
    expect(communityView.pets).toHaveLength(1);
    expect(communityView.pets[0].contentHash).toBe('fresh-a');

    // Release the stale pagination — must NOT append onto the
    // refreshed page.
    resolveStaleMore({ pets: [makeSharedPet('stale-x')], cursor: { __snap: 'stale-cursor' } });
    await stalePagination;
    expect(communityView.pets).toHaveLength(1);
    expect(communityView.pets[0].contentHash).toBe('fresh-a');
    expect(communityView.cursor).toEqual({ __snap: 'fresh-cursor' });
    // The stale pagination's finally MUST clear `loadingMore` even
    // though the result was discarded, otherwise the "Load more"
    // button stays disabled after the refresh.
    expect(communityView.loadingMore).toBe(false);
  });

  it('skips a re-entrant call while loadingMore is true (single-flight)', async () => {
    await seedFirstPage();
    // Reset the call count so the assertion below targets only the
    // loadMore calls in this test, not the seed's listPets.
    listPets.mockClear();
    let resolveSlow;
    listPets.mockImplementationOnce(
      () =>
        new Promise((res) => {
          resolveSlow = res;
        }),
    );
    const inFlight = loadMore();
    // Second invocation while the first is mid-flight must noop.
    await loadMore();
    expect(listPets).toHaveBeenCalledTimes(1);
    resolveSlow({ pets: [], cursor: null });
    await inFlight;
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
