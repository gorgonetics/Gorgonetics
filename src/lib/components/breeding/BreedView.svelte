<script lang="ts">
/**
 * The Breed destination — a first-class, search-first breeding helper. Pick a
 * species and it ranks male × female pairs across your whole stabled collection
 * of that species, then opens the offspring Trio on inspect. Unlike the old
 * selection-driven lens, breeding starts here without pre-selecting pets — the
 * tool finds the best pairs for you. Reuses the breeding service + pair table +
 * TrioView. See docs/design/redesign-library-workspace-v1.md (§2, IA v2).
 */
import { onDestroy } from 'svelte';
import BreedingPairTable from '$lib/components/breeding/BreedingPairTable.svelte';
import TrioView from '$lib/components/breeding/TrioView.svelte';
import EmptyState from '$lib/components/shared/EmptyState.svelte';
import PageHeader from '$lib/components/shared/PageHeader.svelte';
import StatusPane from '$lib/components/shared/StatusPane.svelte';
import { rankBreedingPairs } from '$lib/services/breedingService.js';
import { getAllAttributeNames, getSupportedSpecies, normalizeSpecies } from '$lib/services/configService.js';
import { breedingView } from '$lib/stores/breeding.svelte.js';
import { pets } from '$lib/stores/pets.js';
import type { BreedingPairResult } from '$lib/types/index.js';
import { getSpeciesEmoji } from '$lib/utils/species.js';
import { capitalize } from '$lib/utils/string.js';

// Species options, normalized for matching but shown with their display name.
const speciesOptions = getSupportedSpecies().map((s) => ({
  raw: s,
  key: normalizeSpecies(s),
  label: capitalize(normalizeSpecies(s)),
}));

let species = $state(speciesOptions[0]?.key ?? '');

const attrNames = $derived(species ? getAllAttributeNames(species).map(capitalize) : []);

// Breed across the stable: every stabled pet of the chosen species.
const candidates = $derived($pets.filter((p) => p.stabled && normalizeSpecies(p.species) === species));

let pairs = $state<BreedingPairResult[]>([]);
let loading = $state(false);
let errored = $state(false);
let seq = 0;

$effect(() => {
  // Re-rank whenever the species (and thus the candidate set) changes. A
  // sequence guard discards stale results if the inputs change faster than the
  // service responds.
  const sp = species;
  const ps = candidates;
  breedingView.selectedPair = null;

  if (!sp || ps.length === 0) {
    pairs = [];
    loading = false;
    errored = false;
    return;
  }

  const mine = ++seq;
  loading = true;
  errored = false;
  rankBreedingPairs({ species: sp, pets: ps })
    .then((result) => {
      if (mine !== seq) return;
      pairs = result;
      loading = false;
    })
    .catch((err: unknown) => {
      if (mine !== seq) return;
      console.error('rankBreedingPairs failed', err);
      pairs = [];
      errored = true;
      loading = false;
    });
});

onDestroy(() => {
  breedingView.selectedPair = null;
});
</script>

<div class="breed-view" data-testid="breed-view">
  <PageHeader
    icon="💞"
    title="Breeding helper"
    subtitle="Pick a species to rank the best male × female pairs across your stable, then inspect the offspring projection."
  />

  <div class="bv-species" role="group" aria-label="Species" data-testid="breed-species">
    {#each speciesOptions as opt (opt.key)}
      <button
        type="button"
        class="species-btn"
        class:active={species === opt.key}
        aria-pressed={species === opt.key}
        data-species={opt.key}
        onclick={() => { species = opt.key; }}
      >
        {getSpeciesEmoji(opt.raw)} {opt.label}
      </button>
    {/each}
  </div>

  <div class="bv-body">
    {#if errored}
      <StatusPane variant="error" title="Couldn't rank these pairs." body="Something went wrong computing scores. Switch species to retry." />
    {:else if loading && pairs.length === 0}
      <StatusPane variant="loading" body="Computing pair scores…" />
    {:else if candidates.length === 0}
      <EmptyState
        icon="🐾"
        title="No stabled {capitalize(species)} pets"
        body="Breeding ranks pairs from your stabled pets. Stable some {capitalize(species)} pets in My Pets, then come back."
      />
    {:else if pairs.length === 0}
      <EmptyState
        icon="💞"
        title="No pairs to rank"
        body="Breeding pairs a male with a female. You need at least one stabled male and one stabled female of this species."
      />
    {:else}
      <div class="bv-meta">{pairs.length} {pairs.length === 1 ? 'pair' : 'pairs'} · ranked by expected offspring quality</div>
      <BreedingPairTable results={pairs} {attrNames} />
    {/if}
  </div>
</div>

{#if breedingView.selectedPair}
  <TrioView pair={breedingView.selectedPair} onClose={() => { breedingView.selectedPair = null; }} />
{/if}

<style>
  .breed-view { display: flex; flex-direction: column; height: 100%; min-height: 0; }
  /* Segmented control, consistent with the My Pets species toggle (FilterBar). */
  .bv-species {
    display: inline-flex; align-self: flex-start; gap: 2px; flex-shrink: 0;
    margin: 0 20px 10px; padding: 2px; border-radius: 8px; background: var(--bg-tertiary);
  }
  .species-btn {
    border: none; background: transparent; color: var(--text-tertiary);
    font-size: 12px; font-weight: 600; padding: 5px 14px; border-radius: 6px; cursor: pointer;
  }
  .species-btn:hover { color: var(--text-secondary); }
  .species-btn.active {
    background: var(--bg-primary); color: var(--text-primary);
    box-shadow: var(--shadow-sm, 0 1px 2px rgba(0, 0, 0, 0.06));
  }
  .bv-body { flex: 1; min-height: 0; overflow: auto; padding: 0 20px 16px; display: flex; flex-direction: column; gap: 8px; }
  .bv-meta { font-size: 12px; color: var(--text-tertiary); }
</style>
