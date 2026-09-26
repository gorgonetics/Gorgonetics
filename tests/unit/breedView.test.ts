import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { rankBreedingPairs } from '$lib/services/breedingService.js';
import { localPetsRevision } from '$lib/services/petService.js';
import { attributeMagnitudesFor, peekAttributeMagnitudes } from '$lib/services/studyService.js';
import { breedingView } from '$lib/stores/breeding.svelte.js';
import { loading, pets } from '$lib/stores/pets.js';
import type { BreedingPairResult, Pet } from '$lib/types/index.js';
import { type AttributeMagnitudes, EMPTY_MAGNITUDES } from '$lib/utils/attributePoints.js';

// The ranking service is exercised by its own suite; stub it so these tests
// stay a focused check of BreedView's species defaulting and trio lifecycle.
vi.mock('$lib/services/breedingService.js', () => ({
  rankBreedingPairs: vi.fn(async () => []),
  // Breed scoping is covered by the breeding suite; here it only has to
  // hand back a table the view can label its columns from.
  magnitudesForBreed: vi.fn(async (magnitudes: unknown) => magnitudes),
}));

// The study is the expensive half of a ranking and hits the DB. Default it to
// "already solved, nothing known" so the rest of these tests take the single
// ranking pass; the progressive-render tests drive it explicitly.
vi.mock('$lib/services/studyService.js', () => {
  // Built here rather than imported: `vi.mock` factories are hoisted above
  // the import block, so `EMPTY_MAGNITUDES` would not be initialised yet.
  const empty = { points: new Map<string, number>(), coverage: new Map() };
  return {
    attributeMagnitudesFor: vi.fn(async () => empty),
    peekAttributeMagnitudes: vi.fn(() => empty),
  };
});

// Only the revision is stubbed — the pets store imports this module too, so
// the rest has to stay real.
vi.mock('$lib/services/petService.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/services/petService.js')>()),
  localPetsRevision: vi.fn(() => 0),
}));

// The capability readout hits the DB through the quality service; a fixed
// summary keeps these tests about the view's wording and gating.
vi.mock('$lib/services/geneticQualityService.js', () => ({
  capabilitySummary: vi.fn(async () => ({
    capability: 700,
    reachable: 800,
    ceiling: 879,
    // The horse gene set's real generic block: 202 of 879 benefit slots.
    generic: { capability: 170, reachable: 190, ceiling: 202 },
  })),
}));

// The real TrioView mounts the heavy offspring grid (~2304 cells); the guard
// under test only cares whether the pair is still selected.
vi.mock('$lib/components/breeding/TrioView.svelte', async () => ({
  default: (await import('./fixtures/ChildStub.svelte')).default,
}));

import BreedView from '$lib/components/breeding/BreedView.svelte';

const pet = (over: Partial<Pet>): Pet =>
  ({
    id: 0,
    name: 'Pet',
    species: 'Horse',
    breed: 'Standardbred',
    gender: 'Female',
    tags: [],
    stabled: true,
    positive_genes: 0,
    ...over,
  }) as unknown as Pet;

const stallion = pet({ id: 1, name: 'Dusty', gender: 'Male' });
const mare = pet({ id: 2, name: 'Roach' });

/** A ranked row for this pair. The store holds the whole row, not just the two animals. */
const pairStub = (evCapabilityGain: number): BreedingPairResult => ({
  male: stallion,
  female: mare,
  evMixed: 0,
  evPositiveByAttribute: {},
  evPositiveTotal: 0,
  evCapabilityGain,
  evPositiveImprovement: 0,
  evPairUpgrade: 0,
  betterParentPositives: 0,
  weakerParentPositives: 0,
  evAttributeImprovement: {},
  evNegativeTotal: 0,
  evLiabilityReduction: 0,
  cleanerParentNegatives: 0,
  maleProfile: { positives: 0, negatives: 0, positivesByAttribute: {} },
  femaleProfile: { positives: 0, negatives: 0, positivesByAttribute: {} },
  positiveSd: 0,
  negativeSd: 0,
  evUnknown: 0,
  totalLoci: 0,
});

function resetView() {
  breedingView.species = '';
  breedingView.offspringBreed = '';
  breedingView.sortCol = 'evPositiveTotal';
  breedingView.sortDir = 'desc';
  breedingView.selectedPair = null;
  breedingView.scrollTop = 0;
  breedingView.scrollLeft = 0;
  breedingView.benchedIds = new Set();
  breedingView.spots = 0;
  breedingView.objective = 'reach';
}

beforeEach(() => {
  resetView();
  loading.set(false);
  pets.set([]);
});

afterEach(() => {
  cleanup();
  loading.set(false);
  pets.set([]);
  resetView();
});

const activeSpecies = (c: HTMLElement) =>
  c.querySelector('[data-testid="breed-species"] .species-btn.active')?.getAttribute('data-species');

describe('BreedView — accessibility', () => {
  it('keeps a heading landmark even though the visible title is dropped', async () => {
    const { container, rerender } = render(BreedView);
    await rerender({});
    const heading = container.querySelector('h2.sr-only');
    expect(heading?.textContent).toBe('Breeding helper');
  });
});

describe('BreedView — default species', () => {
  it('defaults to the most-populated stabled species, not the alphabetical first', async () => {
    // Beewasps outnumber horses overall, but most are unstabled — only the
    // stabled population should drive the default.
    pets.set([
      stallion,
      mare,
      pet({ id: 3, species: 'Beewasp', breed: 'Bee' }),
      pet({ id: 4, species: 'Beewasp', breed: 'Bee', stabled: false }),
      pet({ id: 5, species: 'Beewasp', breed: 'Bee', stabled: false }),
      pet({ id: 6, species: 'Beewasp', breed: 'Bee', stabled: false }),
    ]);
    const { container, rerender } = render(BreedView);
    await rerender({});
    expect(activeSpecies(container)).toBe('horse');
    // The default is derived, not committed — only an explicit click pins it.
    expect(breedingView.species).toBe('');
  });

  it('re-derives the default when the pet list lands after mount (no mount-time lock-in)', async () => {
    const { container, rerender } = render(BreedView);
    await rerender({});
    // Nothing loaded yet → the first supported species is the fallback.
    expect(activeSpecies(container)).toBe('beewasp');

    pets.set([stallion, mare, pet({ id: 3, species: 'Beewasp', breed: 'Bee' })]);
    await rerender({});
    expect(activeSpecies(container)).toBe('horse');
  });

  it('a persisted explicit choice wins over the population default', async () => {
    breedingView.species = 'beewasp';
    pets.set([stallion, mare, pet({ id: 3, species: 'Beewasp', breed: 'Bee' })]);
    const { container, rerender } = render(BreedView);
    await rerender({});
    expect(activeSpecies(container)).toBe('beewasp');
  });

  it('clicking a species pins it in the store and resets breed + scroll state', async () => {
    pets.set([stallion, mare]);
    breedingView.scrollTop = 120;
    breedingView.scrollLeft = 40;
    const { container, rerender } = render(BreedView);
    await rerender({});

    const beewaspBtn = container.querySelector('[data-testid="breed-species"] [data-species="beewasp"]');
    expect(beewaspBtn).not.toBeNull();
    await fireEvent.click(beewaspBtn as Element);
    await rerender({});

    expect(breedingView.species).toBe('beewasp');
    expect(activeSpecies(container)).toBe('beewasp');
    expect(breedingView.scrollTop).toBe(0);
    expect(breedingView.scrollLeft).toBe(0);
  });
});

describe('BreedView — trio invalidation when a parent leaves the candidate set', () => {
  beforeEach(() => {
    breedingView.species = 'horse';
    pets.set([stallion, mare]);
    breedingView.selectedPair = pairStub(0);
  });

  it('keeps the trio open across an in-flight reload that briefly lacks a parent', async () => {
    const { rerender } = render(BreedView);
    await rerender({});
    expect(breedingView.selectedPair).not.toBeNull();

    // Mid-reload: loading true and the list momentarily empty must not be
    // mistaken for a deletion.
    loading.set(true);
    pets.set([]);
    await rerender({});
    expect(breedingView.selectedPair).not.toBeNull();

    // The reload settles with both parents present (fresh object refs).
    pets.set([pet({ id: 1, name: 'Dusty', gender: 'Male' }), pet({ id: 2, name: 'Roach' })]);
    loading.set(false);
    await rerender({});
    expect(breedingView.selectedPair).not.toBeNull();
  });

  it('drops back to the pair table when a parent is deleted (settled load)', async () => {
    const { rerender } = render(BreedView);
    await rerender({});
    expect(breedingView.selectedPair).not.toBeNull();

    pets.set([mare]);
    await rerender({});
    expect(breedingView.selectedPair).toBeNull();
  });

  it('drops back to the pair table when a parent is unstabled (settled load)', async () => {
    const { rerender } = render(BreedView);
    await rerender({});
    expect(breedingView.selectedPair).not.toBeNull();

    pets.set([stallion, pet({ id: 2, name: 'Roach', stabled: false })]);
    await rerender({});
    expect(breedingView.selectedPair).toBeNull();
  });
});

describe('BreedView — bench + planning', () => {
  const stallion2 = pet({ id: 3, name: 'Comet', gender: 'Male' });

  beforeEach(() => {
    breedingView.species = 'horse';
    pets.set([stallion, stallion2, mare]);
  });

  it('excludes a benched animal from the pets fed to the ranking', async () => {
    const ranker = vi.mocked(rankBreedingPairs);
    const { container, rerender } = render(BreedView);
    await rerender({});

    // Expand the pool and bench the second stallion.
    await fireEvent.click(container.querySelector('[data-testid="breeding-pool"] .pool-toggle') as HTMLButtonElement);
    await fireEvent.click(
      container.querySelector('[data-testid="breeding-pool"] [data-pet-id="3"]') as HTMLButtonElement,
    );
    await rerender({});

    expect(breedingView.benchedIds.has(3)).toBe(true);
    const lastCall = ranker.mock.calls.at(-1)?.[0];
    expect(lastCall?.pets.map((p) => p.id).sort((a, b) => a - b)).toEqual([1, 2]);
  });

  it('shows a benched (not "no stabled pets") empty state when every animal is benched', async () => {
    breedingView.benchedIds = new Set([1, 2, 3]);
    const { container, rerender } = render(BreedView);
    await rerender({});
    const empty = container.querySelector('[data-testid="empty-state"]');
    expect(empty).not.toBeNull();
    expect(empty?.textContent).toContain('benched');
    expect(empty?.textContent).not.toContain('No stabled');
    expect(container.querySelector('[data-testid="breeding-pair-table"]')).toBeNull();
  });

  it('"Return all" only un-benches the current species, not animals of others', async () => {
    // 3 is a horse in this pool; 999 is a benched animal of another species.
    breedingView.benchedIds = new Set([3, 999]);
    const { container, rerender } = render(BreedView);
    await rerender({});

    await fireEvent.click(container.querySelector('[data-testid="breeding-pool"] .pool-toggle') as HTMLButtonElement);
    await fireEvent.click(container.querySelector('[data-testid="pool-return-all"]') as HTMLButtonElement);
    await rerender({});

    expect(breedingView.benchedIds.has(3)).toBe(false);
    expect(breedingView.benchedIds.has(999)).toBe(true);
  });

  it('the spots stepper drives breedingView.spots and clamps at zero', async () => {
    const { container, rerender } = render(BreedView);
    await rerender({});
    const value = () => container.querySelector('[data-testid="spots-value"]')?.textContent;
    const inc = container.querySelector('[aria-label="More breeding spots"]') as HTMLButtonElement;
    const dec = container.querySelector('[aria-label="Fewer breeding spots"]') as HTMLButtonElement;

    expect(value()).toBe('Off');
    expect(dec.disabled).toBe(true);

    await fireEvent.click(inc);
    await fireEvent.click(inc);
    expect(breedingView.spots).toBe(2);
    expect(value()).toBe('2');

    await fireEvent.click(dec);
    await fireEvent.click(dec);
    expect(breedingView.spots).toBe(0);
    expect(value()).toBe('Off');
    expect((container.querySelector('[aria-label="Fewer breeding spots"]') as HTMLButtonElement).disabled).toBe(true);
  });
});

/**
 * The selection carries the whole scored row, so it can go stale in a way that
 * `{male, female}` never could: a re-rank replaces every row, and a Trio left
 * pointing at the old object would explain figures the table no longer shows.
 */
describe('BreedView — keeping an open Trio on the current ranking', () => {
  beforeEach(() => {
    breedingView.species = 'horse';
    pets.set([stallion, mare]);
  });

  it('re-points the selection at the freshly scored row after a re-rank', async () => {
    const stale = pairStub(1);
    const fresh = pairStub(9);
    expect(stale.evCapabilityGain).toBe(1);
    vi.mocked(rankBreedingPairs).mockResolvedValue([fresh]);
    breedingView.selectedPair = stale;

    const { rerender } = render(BreedView);
    await rerender({});

    // Asserted by value, not identity: the store's state proxy means the row
    // written back is never `===` the one handed to it.
    await waitFor(() => {
      expect(breedingView.selectedPair?.evCapabilityGain).toBe(9);
    });
    // Still the same pairing — re-pointed, not replaced with someone else's row.
    expect(breedingView.selectedPair?.male.id).toBe(stallion.id);
    expect(breedingView.selectedPair?.female.id).toBe(mare.id);
  });
});

describe('BreedView — when the ranking no longer contains the open pair', () => {
  beforeEach(() => {
    breedingView.species = 'horse';
    pets.set([stallion, mare]);
  });

  /**
   * An empty ranking means "no pairs to compare against", not "your pairing is
   * gone" — a pool momentarily without a male or a female produces one, and the
   * Trio is deliberately kept open across that.
   */
  it('keeps the Trio open when the ranking comes back empty', async () => {
    vi.mocked(rankBreedingPairs).mockResolvedValue([]);
    breedingView.selectedPair = pairStub(1);

    const { rerender } = render(BreedView);
    await rerender({});
    await rerender({});

    expect(breedingView.selectedPair).not.toBeNull();
  });

  /**
   * Both animals can still be candidates while the pair itself is gone — edit
   * one to the other's gender and they no longer form a male × female pairing.
   * The id-membership guard cannot see that, so the ranking has to.
   */
  it('closes the Trio when a settled re-rank drops the pairing', async () => {
    // A ranking that produced pairs, just not this one — positive evidence the
    // pairing is gone, unlike an empty result.
    const someoneElse: BreedingPairResult = {
      ...pairStub(1),
      male: pet({ id: 7, name: 'Other', gender: 'Male' }),
      female: pet({ id: 8, name: 'Else' }),
    };
    vi.mocked(rankBreedingPairs).mockResolvedValue([someoneElse]);
    breedingView.selectedPair = pairStub(1);

    const { rerender } = render(BreedView);
    await rerender({});

    await waitFor(() => {
      expect(breedingView.selectedPair).toBeNull();
    });
  });

  /**
   * A failed re-rank clears `pairs`, so there is no ranking left for an open
   * Trio to explain — and its projection would still rebuild from the new pool.
   */
  it('closes the Trio when the re-rank fails', async () => {
    vi.mocked(rankBreedingPairs).mockRejectedValue(new Error('boom'));
    breedingView.selectedPair = pairStub(1);

    const { rerender } = render(BreedView);
    await rerender({});

    await waitFor(() => {
      expect(breedingView.selectedPair).toBeNull();
    });
  });
});

describe('BreedView — when Reach new ground has run dry', () => {
  beforeEach(() => {
    breedingView.species = 'horse';
    breedingView.spots = 1;
    pets.set([stallion, mare]);
  });

  it('shows what the pool holds against what it could ever lock', async () => {
    vi.mocked(rankBreedingPairs).mockResolvedValueOnce([pairStub(3)]);
    const { container, rerender } = render(BreedView);
    await rerender({});
    await waitFor(() => expect(container.querySelector('[data-testid="breed-capability"]')).toBeTruthy());
    const text = container.querySelector('[data-testid="breed-capability"]')?.textContent?.replace(/\s+/g, ' ') ?? '';
    expect(text).toContain('700.0');
    expect(text).toContain('800');
    expect(text).toContain('879');
    expect(text).toContain('3.0');
    expect(container.querySelector('[data-testid="breed-reach-exhausted"]')).toBeNull();
    // The generic split carries its own genome ceiling, so slots nobody
    // carries are not hidden behind the reachable count.
    const generic =
      container.querySelector('[data-testid="breed-capability-generic"]')?.textContent?.replace(/\s+/g, ' ') ?? '';
    expect(generic).toContain('170.0 of 190 reachable breed-generic (202 in the genome)');
    // The count is over the breeding pool, which excludes benched animals.
    const title = container.querySelector('[data-testid="breed-capability-generic"]')?.getAttribute('title') ?? '';
    expect(title).toContain('breeding pool');
    expect(title).toContain('Benched animals are not in the pool');
  });

  it('says so, and points at the other strategies, once the best reach plan adds under a slot-unit', async () => {
    vi.mocked(rankBreedingPairs).mockResolvedValueOnce([pairStub(0.25)]);
    const { container, rerender } = render(BreedView);
    await rerender({});
    await waitFor(() => expect(container.querySelector('[data-testid="breed-reach-exhausted"]')).toBeTruthy());
    expect(container.querySelector('[data-testid="breed-reach-exhausted"]')?.textContent).toContain(
      'Raise the ceiling',
    );
  });

  it('judges the gain per pair, so the spot count cannot change the verdict', async () => {
    // Six pairings gaining 0.25 each: exhausted per pair, but a plan total of
    // 1.5 — which an absolute threshold against the total reads as healthy,
    // so the same stable was called dry at one spot and fine at six.
    const herd = [
      pet({ id: 11, name: 'M1', gender: 'Male' }),
      pet({ id: 12, name: 'M2', gender: 'Male' }),
      pet({ id: 13, name: 'M3', gender: 'Male' }),
      pet({ id: 14, name: 'F1' }),
      pet({ id: 15, name: 'F2' }),
      pet({ id: 16, name: 'F3' }),
    ];
    pets.set(herd);
    breedingView.spots = 3;
    const males = herd.filter((p) => p.gender === 'Male');
    const females = herd.filter((p) => p.gender !== 'Male');
    vi.mocked(rankBreedingPairs).mockResolvedValueOnce(
      males.flatMap((m) => females.map((f) => ({ ...pairStub(0.25), male: m, female: f }))),
    );
    const { container, rerender } = render(BreedView);
    await rerender({});
    await waitFor(() => expect(container.querySelector('[data-testid="breed-capability"]')).toBeTruthy());
    expect(container.querySelector('[data-testid="breed-capability"]')?.textContent).toContain('per pair');
    expect(container.querySelector('[data-testid="breed-reach-exhausted"]')).toBeTruthy();
  });

  it('stays quiet when the player is already breeding for something else', async () => {
    breedingView.objective = 'ceiling';
    vi.mocked(rankBreedingPairs).mockResolvedValueOnce([pairStub(0.25)]);
    const { container, rerender } = render(BreedView);
    await rerender({});
    await waitFor(() => expect(container.querySelector('[data-testid="breed-capability"]')).toBeTruthy());
    expect(container.querySelector('[data-testid="breed-reach-exhausted"]')).toBeNull();
  });
});

describe('BreedView — ranking does not wait on the study', () => {
  /** A one-finding table, enough for `hasMagnitudes` to be true. */
  const solved = (): AttributeMagnitudes => ({
    points: new Map([['01A1:dominant', 4]]),
    coverage: new Map([['Toughness', { known: 1, total: 2 }]]),
  });

  beforeEach(() => {
    pets.set([stallion, mare]);
    vi.mocked(rankBreedingPairs).mockClear();
    vi.mocked(attributeMagnitudesFor).mockClear();
    vi.mocked(peekAttributeMagnitudes).mockClear();
  });

  it('ranks in counts while a first study solves, then re-ranks in points', async () => {
    // Nothing memoised yet — the first Breed open of a session. The study is
    // quadratic in corpus size, and holding the table shut behind it is what
    // this exists to avoid.
    vi.mocked(peekAttributeMagnitudes).mockReturnValueOnce(undefined);
    let settle: (m: AttributeMagnitudes) => void = () => {};
    vi.mocked(attributeMagnitudesFor).mockReturnValueOnce(
      new Promise<AttributeMagnitudes>((resolve) => {
        settle = resolve;
      }),
    );
    vi.mocked(rankBreedingPairs).mockResolvedValue([pairStub(0.25)]);

    const { container, rerender } = render(BreedView);
    await rerender({});

    // A ranking is on screen before the study has produced anything.
    await waitFor(() => expect(vi.mocked(rankBreedingPairs)).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(container.querySelector('[data-testid="breed-objective-hint"]')).toBeTruthy());
    expect(vi.mocked(rankBreedingPairs).mock.calls[0][0].magnitudes).toBe(EMPTY_MAGNITUDES);

    // When the solve lands, the same pairs are re-ranked in points.
    const table = solved();
    settle(table);
    await waitFor(() => expect(vi.mocked(rankBreedingPairs)).toHaveBeenCalledTimes(2));
    expect(vi.mocked(rankBreedingPairs).mock.calls[1][0].magnitudes).toBe(table);
  });

  it('takes a single pass once the study is memoised', async () => {
    const table = solved();
    vi.mocked(peekAttributeMagnitudes).mockReturnValueOnce(table);
    vi.mocked(rankBreedingPairs).mockResolvedValue([pairStub(0.25)]);

    const { container, rerender } = render(BreedView);
    await rerender({});
    await waitFor(() => expect(container.querySelector('[data-testid="breed-objective-hint"]')).toBeTruthy());

    // Every open after the first: straight to points, and no count ranking
    // the player would see flicker past.
    expect(vi.mocked(rankBreedingPairs)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(rankBreedingPairs).mock.calls[0][0].magnitudes).toBe(table);
    expect(vi.mocked(attributeMagnitudesFor)).not.toHaveBeenCalled();
  });

  it('does not re-rank when the study finds nothing', async () => {
    vi.mocked(peekAttributeMagnitudes).mockReturnValueOnce(undefined);
    vi.mocked(rankBreedingPairs).mockResolvedValue([pairStub(0.25)]);

    const { container, rerender } = render(BreedView);
    await rerender({});
    await waitFor(() => expect(container.querySelector('[data-testid="breed-objective-hint"]')).toBeTruthy());

    // The default mock resolves to an empty table: the count ranking already
    // standing is the best answer there is, so redoing it buys nothing.
    await Promise.resolve();
    expect(vi.mocked(rankBreedingPairs)).toHaveBeenCalledTimes(1);
  });
});

describe('BreedView — an edit to a listed animal re-ranks', () => {
  beforeEach(() => {
    pets.set([stallion, mare]);
    vi.mocked(rankBreedingPairs).mockClear();
    vi.mocked(rankBreedingPairs).mockResolvedValue([pairStub(0.25)]);
    vi.mocked(localPetsRevision).mockReturnValue(0);
  });

  it('re-ranks when a reading is corrected, though the candidate ids are unchanged', async () => {
    const { rerender } = render(BreedView);
    await rerender({});
    await waitFor(() => expect(vi.mocked(rankBreedingPairs)).toHaveBeenCalledTimes(1));

    // Correcting an attribute or renaming an animal leaves the candidate set
    // identical, so the id-based key alone would hold the old scores on
    // screen against a reading that has been replaced.
    vi.mocked(localPetsRevision).mockReturnValue(1);
    pets.set([stallion, mare]);
    await rerender({});
    await waitFor(() => expect(vi.mocked(rankBreedingPairs)).toHaveBeenCalledTimes(2));
  });

  it('still skips a bare store re-emit that changes nothing', async () => {
    const { rerender } = render(BreedView);
    await rerender({});
    await waitFor(() => expect(vi.mocked(rankBreedingPairs)).toHaveBeenCalledTimes(1));

    // A background `loadPets` hands back the same animals in a new array. The
    // whole point of the key is that this costs nothing.
    pets.set([stallion, mare]);
    await rerender({});
    expect(vi.mocked(rankBreedingPairs)).toHaveBeenCalledTimes(1);
  });
});
