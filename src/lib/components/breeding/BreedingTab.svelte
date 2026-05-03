<script>
import { rankBreedingPairs } from '$lib/services/breedingService.js';
import { getAllAttributeNames, getSupportedSpecies, normalizeSpecies } from '$lib/services/configService.js';
import { breedingView } from '$lib/stores/breeding.svelte.js';
import { pets } from '$lib/stores/pets.js';
import { Gender, HORSE_BREEDS } from '$lib/types/index.js';
import { capitalize } from '$lib/utils/string.js';
import BreedingPairTable from './BreedingPairTable.svelte';

const species = getSupportedSpecies();

let pairs = $state([]);
let loading = $state(false);
let pairsSequence = 0;

const eligibleForCurrent = $derived.by(() => {
  const target = breedingView.species;
  let male = 0;
  let female = 0;
  for (const p of $pets) {
    if (!p.stabled) continue;
    if (normalizeSpecies(p.species) !== target) continue;
    if (p.gender === Gender.MALE) male++;
    else if (p.gender === Gender.FEMALE) female++;
  }
  return { male, female };
});

const attrNames = $derived(getAllAttributeNames(breedingView.species).map(capitalize));

$effect(() => {
  // Re-rank whenever the species, offspring breed, or pet list changes.
  // Reads inside this effect are tracked by Svelte's reactivity; the
  // sequence counter discards stale results when inputs change faster
  // than the service responds.
  const targetSpecies = breedingView.species;
  const offspringBreed = breedingView.offspringBreed;
  const eligible = $pets.filter((p) => p.stabled && normalizeSpecies(p.species) === targetSpecies);

  const seq = ++pairsSequence;
  loading = true;

  rankBreedingPairs({
    species: targetSpecies,
    offspringBreed,
    pets: eligible,
  })
    .then((result) => {
      if (seq !== pairsSequence) return;
      pairs = result;
      loading = false;
    })
    .catch((err) => {
      if (seq !== pairsSequence) return;
      console.error('rankBreedingPairs failed', err);
      pairs = [];
      loading = false;
    });
});

function setSpecies(s) {
  breedingView.species = s;
}

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
            <label class="control-label" for="breeding-species">Species</label>
            <div class="species-toggle" role="radiogroup" id="breeding-species" aria-label="Breeding species">
                {#each species as s (s)}
                    <button
                        type="button"
                        class="species-btn"
                        class:active={breedingView.species === s}
                        role="radio"
                        aria-checked={breedingView.species === s}
                        onclick={() => setSpecies(s)}
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
        {#if loading && pairs.length === 0}
            <div class="status-pane" data-testid="breeding-loading">
                <div class="spinner"></div>
                <p>Computing pair scores…</p>
            </div>
        {:else if eligibleForCurrent.male === 0 || eligibleForCurrent.female === 0}
            <div class="status-pane empty" data-testid="breeding-empty">
                <p>
                    No pairs to rank — need at least one stabled
                    <strong>{breedingView.species}</strong> of each gender.
                </p>
                <p class="muted">
                    Currently: {eligibleForCurrent.male} ♂ × {eligibleForCurrent.female} ♀
                </p>
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

    .status-pane {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 8px;
        color: var(--text-muted);
    }

    .status-pane.empty p {
        margin: 0;
    }

    .spinner {
        width: 24px;
        height: 24px;
        border: 3px solid var(--border-primary);
        border-top: 3px solid var(--accent);
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
    }

    @keyframes spin {
        to { transform: rotate(360deg); }
    }
</style>
