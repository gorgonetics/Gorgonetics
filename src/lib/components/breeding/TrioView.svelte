<script lang="ts">
import GenomeGridTrio from '$lib/components/comparison/GenomeGridTrio.svelte';
import DetailOverlay from '$lib/components/shared/DetailOverlay.svelte';
import { normalizeSpecies } from '$lib/services/configService.js';
import type { SelectedBreedingPair } from '$lib/stores/breeding.svelte.js';
import { getSpeciesEmoji } from '$lib/utils/species.js';

interface Props {
  pair: SelectedBreedingPair;
  offspringBreed?: string;
  onClose: () => void;
}

const { pair, offspringBreed = '', onClose }: Props = $props();

const father = $derived(pair.male);
const mother = $derived(pair.female);
const speciesLabel = $derived(father ? normalizeSpecies(father.species) : '');
</script>

<DetailOverlay
  testid="trio-view"
  backTestid="trio-view-back"
  backLabel="← Pairs"
  ariaLabel="Offspring trio"
  onBack={onClose}
>
  {#snippet title()}
    <span class="parent-name father">♂ {father?.name}</span>
    <span class="cross">×</span>
    <span class="parent-name mother">♀ {mother?.name}</span>
    {#if speciesLabel}
      <span class="species-badge">{getSpeciesEmoji(father?.species)} {speciesLabel}</span>
    {/if}
  {/snippet}

  <div class="trio-scroll">
    <GenomeGridTrio {father} {mother} {offspringBreed} />
  </div>
</DetailOverlay>

<style>
  .parent-name { font-weight: 700; }
  .parent-name.father { color: var(--accent); }
  .parent-name.mother { color: #a855f7; }
  .cross { color: var(--text-muted); font-weight: 500; }

  .species-badge {
    font-size: 12px;
    font-weight: 500;
    padding: 2px 8px;
    background: var(--bg-tertiary);
    border-radius: 10px;
    color: var(--text-secondary);
    white-space: nowrap;
  }

  /* The wide grid scrolls on its own inside the overlay body. */
  .trio-scroll {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 16px 20px;
  }
</style>
