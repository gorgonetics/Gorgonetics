<script lang="ts">
/**
 * The Workspace — the redesign's selection-aware main area. Driven by the
 * Library's multi-select:
 *   0 selected → prompt
 *   1          → the pet's detail view (existing PetVisualization, unchanged —
 *                the GeneGrid/lens swap is a later slice once GeneGrid reaches
 *                parity)
 *   2 same-species → Compare lens (existing genome diff)
 *   2 mixed / 3+   → guidance (the Breed-rank → Trio lens arrives next slice)
 * Behind the redesign flag until cutover.
 * See docs/design/redesign-library-workspace-v1.md (§7).
 */

import GenomeGridDiff from '$lib/components/comparison/GenomeGridDiff.svelte';
import PetVisualization from '$lib/components/pet/PetVisualization.svelte';
import EmptyState from '$lib/components/shared/EmptyState.svelte';
import PageHeader from '$lib/components/shared/PageHeader.svelte';
import { normalizeSpecies } from '$lib/services/configService.js';
import { libraryView } from '$lib/stores/library.svelte.js';
import { pets } from '$lib/stores/pets.js';

const selected = $derived($pets.filter((p) => libraryView.selectedIds.has(p.id)));
const sameSpecies = $derived(
  selected.length === 2 && normalizeSpecies(selected[0].species) === normalizeSpecies(selected[1].species),
);
</script>

<section class="workspace" data-testid="workspace">
  {#if selected.length === 0}
    <EmptyState
      icon="🐾"
      title="Pick a pet to begin"
      body="Select one pet from the library to inspect its genes and stats, or two of the same species to compare them."
    />
  {:else if selected.length === 1}
    <PetVisualization pet={selected[0]} />
  {:else if selected.length === 2 && sameSpecies}
    <div class="lens-compare" data-testid="workspace-compare">
      <PageHeader title="Compare" subtitle="{selected[0].name} vs {selected[1].name}" icon="⚖️" />
      <div class="lens-body">
        <GenomeGridDiff petA={selected[0]} petB={selected[1]} />
      </div>
    </div>
  {:else if selected.length === 2}
    <EmptyState
      icon="⚖️"
      title="Pick two pets of the same species"
      body="Comparison is within a species. {selected[0].name} and {selected[1].name} are different species — select two horses or two beewasps to compare."
    />
  {:else}
    <EmptyState
      icon="💞"
      title="{selected.length} pets selected"
      body="The breeding-rank lens for a multi-pet selection arrives in the next step. Select exactly two pets of the same species to compare them now."
    />
  {/if}
</section>

<style>
  .workspace { flex: 1; min-width: 0; height: 100%; display: flex; flex-direction: column; overflow: hidden; }
  .lens-compare { flex: 1; min-height: 0; display: flex; flex-direction: column; }
  .lens-body { flex: 1; min-height: 0; overflow: auto; padding: 16px 20px; }
</style>
