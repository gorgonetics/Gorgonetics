<script lang="ts">
/**
 * Breed-rank lens for the Workspace: ranks male × female pairs among the
 * selected (same-species) pets and opens the offspring Trio view on inspect.
 * Reuses the breeding service + table + TrioView; mirrors BreedingTab's
 * rank-with-sequence-guard wiring, but scoped to the Library selection rather
 * than all stabled pets. See docs/design/redesign-library-workspace-v1.md (§7).
 */
import { onDestroy } from 'svelte';
import BreedingPairTable from '$lib/components/breeding/BreedingPairTable.svelte';
import TrioView from '$lib/components/breeding/TrioView.svelte';
import StatusPane from '$lib/components/shared/StatusPane.svelte';
import { rankBreedingPairs } from '$lib/services/breedingService.js';
import { getAllAttributeNames } from '$lib/services/configService.js';
import { breedingView } from '$lib/stores/breeding.svelte.js';
import type { BreedingPairResult, Pet } from '$lib/types/index.js';
import { capitalize } from '$lib/utils/string.js';

interface Props {
  /** The selected pets to rank among — assumed same (normalized) species. */
  pets: Pet[];
  /** Normalized species of the selection. */
  species: string;
}

const { pets, species }: Props = $props();

const attrNames = $derived(species ? getAllAttributeNames(species).map(capitalize) : []);

let pairs = $state<BreedingPairResult[]>([]);
let loading = $state(false);
let errored = $state(false);
let seq = 0;

$effect(() => {
  // Re-rank whenever the selection or species changes. A sequence counter
  // discards stale results if inputs change faster than the service responds.
  const sp = species;
  const ps = pets;
  // Close any open trio from a previous selection so it can't dangle.
  breedingView.selectedPair = null;

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

// Leaving the lens shouldn't leave a trio selection lingering for the old tab.
onDestroy(() => {
  breedingView.selectedPair = null;
});
</script>

<div class="breed-lens" data-testid="breed-lens">
  {#if errored}
    <div class="bl-state">
      <StatusPane variant="error" title="Couldn't rank these pairs." body="Something went wrong computing scores. Change the selection to retry." />
    </div>
  {:else if loading && pairs.length === 0}
    <div class="bl-state"><StatusPane variant="loading" body="Computing pair scores…" /></div>
  {:else if pairs.length === 0}
    <div class="bl-state">
      <StatusPane
        variant="empty"
        title="No pairs to rank"
        body="Breeding ranks male × female pairs. Select at least one male and one female of the same species."
      />
    </div>
  {:else}
    <div class="bl-meta">{pairs.length} {pairs.length === 1 ? 'pair' : 'pairs'} · ranked by expected offspring quality</div>
    <BreedingPairTable results={pairs} {attrNames} />
  {/if}
</div>

{#if breedingView.selectedPair}
  <TrioView pair={breedingView.selectedPair} onClose={() => { breedingView.selectedPair = null; }} />
{/if}

<style>
  .breed-lens { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 8px; }
  .bl-state { flex: 1; display: flex; align-items: center; justify-content: center; }
  .bl-meta { font-size: 12px; color: var(--text-tertiary); }
</style>
