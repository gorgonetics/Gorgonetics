<script lang="ts">
/**
 * The Workspace — the redesign's selection-aware main area. Driven by the
 * Library's multi-select:
 *   0 selected → prompt
 *   1          → the pet's detail view (existing PetVisualization, unchanged)
 *   2+ same-species → lens tabs: Compare (exactly 2) and Breed-rank → Trio
 *   mixed species   → guidance
 * Behind the redesign flag until cutover.
 * See docs/design/redesign-library-workspace-v1.md (§7).
 */
import GenomeGridDiff from '$lib/components/comparison/GenomeGridDiff.svelte';
import BreedLens from '$lib/components/library/BreedLens.svelte';
import Roster from '$lib/components/library/Roster.svelte';
import PetVisualization from '$lib/components/pet/PetVisualization.svelte';
import EmptyState from '$lib/components/shared/EmptyState.svelte';
import { normalizeSpecies } from '$lib/services/configService.js';
import { libraryView } from '$lib/stores/library.svelte.js';
import { pets } from '$lib/stores/pets.js';

const selected = $derived($pets.filter((p) => libraryView.selectedIds.has(p.id)));

// The single normalized species shared by all selected pets, or null when the
// selection is empty/singleton, spans species, or any pet's species is unknown
// (normalizeSpecies → '') — guards against comparing/ranking on an empty key.
const commonSpecies = $derived.by(() => {
  if (selected.length < 2) return null;
  const s = normalizeSpecies(selected[0].species);
  if (!s) return null;
  return selected.every((p) => normalizeSpecies(p.species) === s) ? s : null;
});

const canCompare = $derived(selected.length === 2 && commonSpecies !== null);

let multiLens = $state<'compare' | 'breed'>('compare');
// Compare needs exactly two pets; fall back to Breed otherwise.
const activeLens = $derived(multiLens === 'compare' && canCompare ? 'compare' : 'breed');

// Reset to the default lens when the selection is fully cleared, so a fresh
// 2-pet selection always opens on Compare. Edits within a selection keep the
// user's chosen lens (no flip on every checkbox toggle).
$effect(() => {
  if (selected.length === 0) multiLens = 'compare';
});
</script>

<section class="workspace" data-testid="workspace">
  {#if selected.length === 0}
    {#if $pets.length === 0}
      <EmptyState icon="🐾" title="No pets yet" body="Upload a genome file from the library to get started." />
    {:else}
      <div class="roster-wrap" data-testid="workspace-roster">
        <Roster />
      </div>
    {/if}
  {:else if selected.length === 1}
    <PetVisualization pet={selected[0]} />
  {:else if commonSpecies === null}
    <EmptyState
      icon="⚖️"
      title="Pick pets of the same species"
      body="Comparing and breeding work within a single species. Narrow your selection to one species (e.g. all horses) to continue."
    />
  {:else}
    <div class="multi" data-testid="workspace-multi">
      <div class="lens-tabs" role="group" aria-label="Workspace lens">
        <button
          type="button"
          class="lens-tab"
          class:active={activeLens === 'compare'}
          aria-pressed={activeLens === 'compare'}
          disabled={!canCompare}
          title={canCompare ? 'Head-to-head genome diff' : 'Select exactly two pets to compare'}
          data-testid="lens-tab-compare"
          onclick={() => { multiLens = 'compare'; }}
        >⚖️ Compare</button>
        <button
          type="button"
          class="lens-tab"
          class:active={activeLens === 'breed'}
          aria-pressed={activeLens === 'breed'}
          data-testid="lens-tab-breed"
          onclick={() => { multiLens = 'breed'; }}
        >💞 Breed</button>
        <span class="lens-count">{selected.length} selected</span>
      </div>
      <div class="lens-body">
        {#if activeLens === 'compare'}
          <GenomeGridDiff petA={selected[0]} petB={selected[1]} />
        {:else}
          <BreedLens pets={selected} species={commonSpecies} />
        {/if}
      </div>
    </div>
  {/if}
</section>

<style>
  .workspace { flex: 1; min-width: 0; height: 100%; display: flex; flex-direction: column; overflow: hidden; }
  .roster-wrap { flex: 1; min-height: 0; overflow: auto; padding: 16px 20px; }
  .multi { flex: 1; min-height: 0; display: flex; flex-direction: column; }

  .lens-tabs {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 10px 20px 0;
    border-bottom: 1px solid var(--border-primary);
    flex-shrink: 0;
  }
  .lens-tab {
    border: none;
    background: transparent;
    color: var(--text-tertiary);
    font-size: 13px;
    font-weight: 600;
    padding: 7px 4px;
    margin-right: 16px;
    border-bottom: 2px solid transparent;
    cursor: pointer;
  }
  .lens-tab:hover:not(:disabled) { color: var(--text-secondary); }
  .lens-tab.active { color: var(--text-primary); border-bottom-color: var(--accent); }
  .lens-tab:disabled { opacity: 0.4; cursor: default; }
  .lens-count { margin-left: auto; font-size: 11px; color: var(--text-muted); }

  .lens-body { flex: 1; min-height: 0; overflow: auto; padding: 16px 20px; }
</style>
