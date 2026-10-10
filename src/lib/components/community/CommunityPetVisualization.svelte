<script lang="ts">
/**
 * Detail view of a community-catalogue pet: the same PetVisualization as My
 * Pets, fed from the catalogue. Adds the catalogue metadata (breeder,
 * upload date, tags, notes) and the Import-to-stable action.
 *
 * The genome comes from the share blob, not the local `loci` column: the full
 * SharedPet (with `genomeData`) is lazy-fetched here via `getSharedPet`,
 * parsed into a grid with `genomeTextToGrid`, and handed over as `grid`. A
 * synthetic Pet (`sharedPetToPet`) carries the species/breed/attributes the
 * visualizer and stats table read — it is never persisted.
 */
import PetVisualization from '$lib/components/pet/PetVisualization.svelte';
import StatusBanner from '$lib/components/shared/StatusBanner.svelte';
import { getSharedPet, type ImportResult } from '$lib/services/shareService.js';
import { communityView, importSelected } from '$lib/stores/community.svelte.js';
import type { Pet, SharedPet } from '$lib/types/index.js';
import { errorMessage } from '$lib/utils/error.js';
import { genomeTextToGrid } from '$lib/utils/genomeGrid.js';
import { keyedResource } from '$lib/utils/keyedResource.svelte.js';
import { carriesReadings, sharedPetToPet } from '$lib/utils/sharedPet.js';
import { formatShortDate } from '$lib/utils/timestamp.js';

interface Props {
  /** Metadata-only SharedPet from the catalogue list (no `genomeData`). */
  pet: SharedPet;
}

const { pet }: Props = $props();

// Lazy-fetch the full record (metadata + genome blob). The keyed resource
// rejects a stale result if the selection changes mid-fetch.
const genome = keyedResource(
  () => pet.contentHash,
  (hash) => getSharedPet(hash),
);
const genomeLoading = $derived(genome.loading);
const fullPet = $derived(genome.value?.genomeData ? genome.value : null);
const genomeError = $derived(
  genome.error
    ? errorMessage(genome.error)
    : genome.value && !genome.value.genomeData
      ? 'Genome data is missing for this pet — it may have been taken down.'
      : null,
);

// The fetched record re-merges identity from the first share, so it wins once
// in. Provenance for the impact stats: published values off the default are
// readings; an all-default record is an uploader who never entered any.
/** The fetched record once in, else the list row: everything shown reads from it. */
const shown = $derived(fullPet ?? pet);
const previewPet = $derived<Pet>({ ...sharedPetToPet(shown), attributes_measured: carriesReadings(shown.attributes) });
const grid = $derived(fullPet?.genomeData ? genomeTextToGrid(fullPet.genomeData) : null);

// --- Import ---------------------------------------------------------------
const isImportingThis = $derived(communityView.importingHash === pet.contentHash);
const isAnyImportInFlight = $derived(communityView.importingHash !== null);
// Session-scoped success latch (#398): once an import lands (or the pet
// turns out to be already in the stable), the button flips to a disabled
// "✓ Imported" so a silent success can't invite a re-click.
const isImported = $derived(communityView.importedHashes.has(pet.contentHash));
let importStatus = $state<ImportResult | null>(null);

// Reset the transient import banner when the selection changes.
$effect(() => {
  void pet.contentHash;
  importStatus = null;
});

async function handleImport(): Promise<void> {
  if (!fullPet || isImported) return;
  const startedHash = fullPet.contentHash;
  importStatus = null;
  const result = await importSelected(fullPet);
  if (pet.contentHash === startedHash) importStatus = result;
}
</script>

<div class="community-detail" data-testid="community-detail">
  <PetVisualization pet={previewPet} {grid} placeholder={grid ? undefined : genomeState}>
    {#snippet meta()}
      {#if shown.breeder}
        <span class="meta-dot">·</span>
        <span>by {shown.breeder}</span>
      {/if}
      <span class="meta-dot">·</span>
      <span>{formatShortDate(shown.uploadedAt)}</span>
      {#each shown.tags as t (t)}
        <span class="tag-badge">{t}</span>
      {/each}
    {/snippet}

    {#snippet actions()}
      <button
        class="import-btn"
        class:imported={isImported}
        data-testid="community-import"
        onclick={handleImport}
        disabled={isImported || isAnyImportInFlight || !fullPet}
        title={isImported
          ? 'This pet is in your stable'
          : fullPet
            ? isAnyImportInFlight && !isImportingThis
              ? 'Another import is already running'
              : 'Import to my stable'
            : genomeError
              ? "Can't import — the genome failed to load"
              : 'Waiting for genome to load…'}
      >
        {isImported ? '✓ Imported' : isImportingThis ? 'Importing…' : '⬇ Import'}
      </button>
    {/snippet}

    {#snippet notice()}
      {#if shown.notes}
        <div class="notes-strip">
          <span class="block-label">Notes from the uploader</span>
          <span class="notes-text">{shown.notes}</span>
        </div>
      {/if}
      {#if importStatus}
        <div class="status-strip">
          <StatusBanner type={importStatus.status} message={importStatus.message} autoDismissMs={6000} onDismiss={() => { importStatus = null; }} />
        </div>
      {/if}
    {/snippet}
  </PetVisualization>
</div>

{#snippet genomeState()}
  {#if genomeLoading}
    <div class="state" data-testid="community-genome-loading">Loading genome…</div>
  {:else if genomeError}
    <div class="state"><StatusBanner type="error" message={genomeError} /></div>
  {/if}
{/snippet}

<style>
  /* Fills the overlay row like PetVisualization does in My Pets (#436). */
  .community-detail {
    height: 100%;
    display: flex;
    flex: 1;
    min-width: 0;
  }

  .tag-badge {
    display: inline-block;
    padding: 1px 7px;
    border-radius: 10px;
    background: var(--bg-tertiary);
    color: var(--text-secondary);
    font-size: 10px;
  }

  .import-btn {
    padding: 5px 14px;
    border: none;
    border-radius: 6px;
    background: var(--accent);
    color: var(--text-inverse);
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .import-btn:hover:not(:disabled) {
    filter: brightness(1.05);
    color: var(--text-inverse);
  }

  .import-btn:disabled {
    opacity: 0.6;
    cursor: default;
  }

  /* Success latch reads as a done-state, not a greyed-out action. */
  .import-btn.imported:disabled {
    opacity: 1;
    background: var(--bg-primary);
    color: var(--text-secondary);
  }

  .notes-strip {
    padding: var(--space-xs) var(--space-xl);
    border-bottom: 1px solid var(--border-primary);
    font-size: 12px;
    flex-shrink: 0;
  }

  .block-label {
    font-size: 11px;
    text-transform: uppercase;
    color: var(--text-tertiary);
    margin-right: var(--space-sm);
  }

  .notes-text {
    color: var(--text-secondary);
    white-space: pre-wrap;
  }

  .status-strip {
    padding: var(--space-sm) var(--space-xl) 0;
    flex-shrink: 0;
  }

  .state {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-tertiary);
    font-size: 13px;
    padding: var(--space-3xl);
  }
</style>
