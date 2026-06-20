<script lang="ts">
/**
 * The Workspace — the redesign's selection-aware main area. Driven by the
 * Library's multi-select: 0 selected → prompt; 1 → the pet's detail view;
 * 2+ → (later) Compare / Breed lenses. For now the 1-pet case embeds the
 * existing PetVisualization unchanged — the GeneGrid/lens swap is a later
 * slice once GeneGrid reaches parity. Behind the redesign flag until cutover.
 * See docs/design/redesign-library-workspace-v1.md (§7).
 */

import PetVisualization from '$lib/components/pet/PetVisualization.svelte';
import EmptyState from '$lib/components/shared/EmptyState.svelte';
import { libraryView } from '$lib/stores/library.svelte.js';
import { pets } from '$lib/stores/pets.js';

const selected = $derived($pets.filter((p) => libraryView.selectedIds.has(p.id)));
</script>

<section class="workspace" data-testid="workspace">
  {#if selected.length === 0}
    <EmptyState
      icon="🐾"
      title="Pick a pet to begin"
      body="Select one pet from the library to inspect its genes and stats, or several to compare and rank breeding pairs."
    />
  {:else if selected.length === 1}
    <PetVisualization pet={selected[0]} />
  {:else}
    <EmptyState
      icon="⚖️"
      title="{selected.length} pets selected"
      body="Compare and breeding lenses for a multi-pet selection arrive in the next step. Narrow to one pet to inspect it now."
    />
  {/if}
</section>

<style>
  .workspace { flex: 1; min-width: 0; height: 100%; display: flex; flex-direction: column; overflow: hidden; }
</style>
