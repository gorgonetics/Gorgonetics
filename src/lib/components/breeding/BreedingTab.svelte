<script lang="ts">
import StatusPane from '$lib/components/shared/StatusPane.svelte';
import { rankBreedingPairs } from '$lib/services/breedingService.js';
import { getAllAttributeNames, getSupportedSpecies, normalizeSpecies } from '$lib/services/configService.js';
import { breedingView } from '$lib/stores/breeding.svelte.js';
import { pets } from '$lib/stores/pets.js';
import { type BreedingPairResult, Gender, HORSE_BREEDS } from '$lib/types/index.js';
import { capitalize } from '$lib/utils/string.js';
import BreedingPairTable from './BreedingPairTable.svelte';
import TrioView from './TrioView.svelte';

const species = getSupportedSpecies();

let pairs = $state<BreedingPairResult[]>([]);
let loading = $state(false);
let errored = $state(false);
let pairsSequence = 0;

const eligible = $derived($pets.filter((p) => p.stabled && normalizeSpecies(p.species) === breedingView.species));

const eligibleForCurrent = $derived.by(() => {
  let male = 0;
  let female = 0;
  for (const p of eligible) {
    if (p.gender === Gender.MALE) male++;
    else if (p.gender === Gender.FEMALE) female++;
  }
  return { male, female };
});

const attrNames = $derived(getAllAttributeNames(breedingView.species).map(capitalize));

$effect(() => {
  // Re-rank whenever the species, offspring breed, or eligible-pets
  // list changes. The sequence counter discards stale results when
  // inputs change faster than the service responds.
  const targetSpecies = breedingView.species;
  const offspringBreed = breedingView.offspringBreed;
  const eligiblePets = eligible;

  const seq = ++pairsSequence;
  loading = true;
  errored = false;

  rankBreedingPairs({
    species: targetSpecies,
    offspringBreed,
    pets: eligiblePets,
  })
    .then((result) => {
      if (seq !== pairsSequence) return;
      pairs = result;
      loading = false;
    })
    .catch((err: unknown) => {
      if (seq !== pairsSequence) return;
      console.error('rankBreedingPairs failed', err);
      pairs = [];
      errored = true;
      loading = false;
    });
});

const VALID_FIXED_COLS = new Set(['male', 'female', 'evMixed', 'evUnknown', 'evPositiveTotal']);

$effect(() => {
  // When the active species changes, an attribute-specific sort column
  // may no longer apply (e.g. Ferocity disappears on the horse). Reset
  // to the headline column so the table doesn't silently fall back with
  // a stale direction (worst case: best pairs sink to the bottom).
  const validIds = new Set([...VALID_FIXED_COLS, ...attrNames]);
  if (!validIds.has(breedingView.sortCol)) {
    breedingView.sortCol = 'evPositiveTotal';
    breedingView.sortDir = 'desc';
  }
});

const isHorse = $derived(breedingView.species === 'horse');
const horseBreedOptions = Object.keys(HORSE_BREEDS);
</script>

<div class="breeding-tab" data-testid="breeding-tab">
    <header class="breeding-header">
        <h2>💞 Breeding Assistant</h2>
        <p class="subtitle">
            Rank stabled male × female pairs by expected offspring quality.
        </p>
    </header>

    <div class="controls">
        <div class="control-row">
            <span class="control-label" id="breeding-species-label">Species</span>
            <div class="species-toggle" aria-labelledby="breeding-species-label">
                {#each species as s (s)}
                    <button
                        type="button"
                        class="species-btn"
                        class:active={breedingView.species === s}
                        aria-pressed={breedingView.species === s}
                        onclick={() => (breedingView.species = s)}
                    >
                        {s}
                    </button>
                {/each}
            </div>
        </div>

        {#if isHorse}
            <div class="control-row">
                <label class="control-label" for="offspring-breed">Offspring breed</label>
                <select
                    id="offspring-breed"
                    bind:value={breedingView.offspringBreed}
                    class="breed-select"
                    data-testid="offspring-breed"
                >
                    <option value="">Mixed (no filter)</option>
                    {#each horseBreedOptions as breed (breed)}
                        <option value={breed}>{breed}</option>
                    {/each}
                </select>
            </div>
        {/if}
    </div>

    <section class="results">
        {#if errored}
            <div class="status-state" data-testid="breeding-error">
                <StatusPane
                    variant="error"
                    title="Couldn't rank breeding pairs."
                    body="Something went wrong while computing scores. Check the browser console for details, then change a control to retry."
                />
            </div>
        {:else if loading && pairs.length === 0}
            <div class="status-state" data-testid="breeding-loading">
                <StatusPane variant="loading" body="Computing pair scores…" />
            </div>
        {:else if eligibleForCurrent.male === 0 || eligibleForCurrent.female === 0}
            <div class="status-state" data-testid="breeding-empty">
                <StatusPane
                    variant="empty"
                    title="No pairs to rank"
                    body={`Need at least one stabled ${breedingView.species} of each gender. Currently: ${eligibleForCurrent.male} ♂ × ${eligibleForCurrent.female} ♀`}
                />
            </div>
        {:else}
            <div class="results-meta">
                <span>{pairs.length} pairs</span>
                <span class="muted">
                    {eligibleForCurrent.male} ♂ × {eligibleForCurrent.female} ♀
                </span>
            </div>
            <BreedingPairTable results={pairs} {attrNames} />
        {/if}
    </section>

    {#if breedingView.selectedPair}
        <TrioView
            pair={breedingView.selectedPair}
            offspringBreed={breedingView.offspringBreed}
            onClose={() => { breedingView.selectedPair = null; }}
        />
    {/if}
</div>

<style>
    .breeding-tab {
        flex: 1;
        padding: 24px 32px;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        gap: 16px;
    }

    .breeding-header h2 {
        margin: 0 0 4px 0;
        font-size: 20px;
    }

    .subtitle {
        margin: 0;
        color: var(--text-muted);
        font-size: 13px;
    }

    .controls {
        display: flex;
        flex-wrap: wrap;
        gap: 16px 24px;
    }

    .control-row {
        display: flex;
        align-items: center;
        gap: 8px;
    }

    .control-label {
        font-size: 13px;
        font-weight: 600;
        color: var(--text-secondary);
    }

    .species-toggle {
        display: flex;
        background: var(--bg-tertiary);
        border-radius: 6px;
        padding: 2px;
    }

    .species-btn {
        padding: 4px 12px;
        background: transparent;
        border: none;
        color: var(--text-tertiary);
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        border-radius: 4px;
        text-transform: capitalize;
    }

    .species-btn:hover {
        color: var(--text-secondary);
    }

    .species-btn.active {
        background: var(--bg-primary);
        color: var(--text-primary);
        box-shadow: var(--shadow-sm);
    }

    .breed-select {
        padding: 4px 8px;
        background: var(--bg-primary);
        border: 1px solid var(--border-primary);
        border-radius: 4px;
        color: var(--text-primary);
        font-size: 13px;
    }

    .results {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 8px;
        min-height: 0;
    }

    .results-meta {
        display: flex;
        gap: 12px;
        font-size: 13px;
    }

    .muted {
        color: var(--text-muted);
    }

    /* Fills the results area and centres the shared StatusPane vertically. */
    .status-state {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
    }
</style>
