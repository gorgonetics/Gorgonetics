<script lang="ts">
/**
 * My Pets — the table-first home for your stable. A full-width filterable,
 * sortable Roster is the primary surface (a narrow scrolling sidebar is useless
 * at a few-hundred-pet scale). Clicking a pet's name opens its full-view detail
 * with a back button (the table stays mounted underneath, preserving scroll).
 * Row checkboxes build a multi-selection for bulk actions (Compare / Share).
 * Replaces the old Library sidebar + Workspace selection-lens shell.
 * See docs/design/redesign-library-workspace-v1.md (§2, IA v2).
 */

import BulkSharePetDialog from '$lib/components/community/BulkSharePetDialog.svelte';
import GenomeGridDiff from '$lib/components/comparison/GenomeGridDiff.svelte';
import Roster from '$lib/components/library/Roster.svelte';
import PetVisualization from '$lib/components/pet/PetVisualization.svelte';
import FilterBar from '$lib/components/shared/FilterBar.svelte';
import StatusBanner from '$lib/components/shared/StatusBanner.svelte';
import { getSupportedSpecies, normalizeSpecies } from '$lib/services/configService.js';
import { pendingImportCount } from '$lib/stores/gameImport.js';
import { clearLibrarySelection, libraryView } from '$lib/stores/library.svelte.js';
import { pets } from '$lib/stores/pets.js';
import { type DialogResult, HORSE_BREEDS, type Pet } from '$lib/types/index.js';
import { createGenomeUploadController } from '$lib/utils/genomeUploadController.svelte.js';
import { getSpeciesEmoji } from '$lib/utils/species.js';

const speciesOptions = getSupportedSpecies();
const upload = createGenomeUploadController();

const BREEDS_BY_SPECIES: Record<string, Record<string, string>> = {
  beewasp: { Bee: 'Bee', Wasp: 'Wasp' },
  horse: HORSE_BREEDS,
};
const breedsForSpecies = $derived(libraryView.species ? BREEDS_BY_SPECIES[libraryView.species] : undefined);

const flags = $derived([
  { key: 'starred', label: '★ Starred', active: libraryView.starredOnly },
  { key: 'stabled', label: '🏠 Stabled', active: libraryView.stabledOnly },
  { key: 'petQuality', label: '🏆 Pet quality', active: libraryView.petQualityOnly },
]);

function toggleFlag(key: string): void {
  if (key === 'starred') libraryView.starredOnly = !libraryView.starredOnly;
  else if (key === 'stabled') libraryView.stabledOnly = !libraryView.stabledOnly;
  else if (key === 'petQuality') libraryView.petQualityOnly = !libraryView.petQualityOnly;
}

// A breed from another species no longer applies once the species changes.
$effect(() => {
  libraryView.species;
  if (libraryView.breed && (!breedsForSpecies || !(libraryView.breed in breedsForSpecies))) {
    libraryView.breed = '';
  }
});

// --- View mode: table (default) | detail | compare -------------------------
let detailPetId = $state<number | null>(null);
let comparing = $state(false);

// Switching species changes the candidate universe; drop a multi-selection that
// would otherwise act on now-hidden pets, and close any open detail/compare.
// Guarded on an actual change (not the initial mount run) so it can't clobber a
// freshly-opened detail when a click and the effect's first run race.
let prevSpecies: string | undefined;
$effect(() => {
  const species = libraryView.species;
  if (prevSpecies !== undefined && prevSpecies !== species) {
    clearLibrarySelection();
    detailPetId = null;
    comparing = false;
  }
  prevSpecies = species;
});

// Resolve against the live pet list so a deleted pet drops out (→ back to table).
const detailPet = $derived(detailPetId == null ? null : ($pets.find((p) => p.id === detailPetId) ?? null));

// Selection drives the bulk-action bar. Count actual pets (not raw ids) so a
// pet deleted out from under the selection doesn't inflate the count.
const selectedPets = $derived($pets.filter((p) => libraryView.selectedIds.has(p.id)));
const compareSpecies = $derived(selectedPets.length === 2 ? normalizeSpecies(selectedPets[0].species) : '');
const canCompare = $derived(
  selectedPets.length === 2 && compareSpecies !== '' && normalizeSpecies(selectedPets[1].species) === compareSpecies,
);

function openDetail(pet: Pet): void {
  comparing = false;
  detailPetId = pet.id;
}
function closeDetail(): void {
  detailPetId = null;
}
function openCompare(): void {
  if (!canCompare) return;
  detailPetId = null;
  comparing = true;
}
function closeCompare(): void {
  comparing = false;
}

// --- Bulk share -------------------------------------------------------------
let bulkShareOpen = $state(false);
let shareStatus = $state<DialogResult | null>(null);

function handleBulkShareResult(result: DialogResult): void {
  shareStatus = result;
  if (result.type !== 'error') clearLibrarySelection();
}
</script>

<div class="my-pets" data-testid="my-pets">
  <!-- Table layer — always mounted so detail/compare preserve its scroll. -->
  <div class="mp-main" class:hidden={detailPet || comparing}>
    <div class="mp-head">
      <FilterBar
        search={libraryView.search}
        onSearch={(v) => { libraryView.search = v; }}
        species={speciesOptions}
        activeSpecies={libraryView.species}
        onSpecies={(v) => { libraryView.species = v; }}
        breeds={breedsForSpecies}
        breed={libraryView.breed}
        onBreed={(v) => { libraryView.breed = v; }}
        {flags}
        onToggleFlag={toggleFlag}
      />
    </div>

    {#if shareStatus}
      <div class="mp-share-status">
        <StatusBanner
          type={shareStatus.type}
          message={shareStatus.message}
          autoDismissMs={8000}
          onDismiss={() => { shareStatus = null; }}
        />
      </div>
    {/if}

    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="mp-table"
      data-testid="mypets-table"
      ondragover={upload.handleFileDragOver}
      ondragleave={upload.handleFileDragLeave}
      ondrop={upload.handleFileDrop}
    >
      {#if upload.fileDragActive}
        <div class="file-drop-overlay"><span>Drop genome files to upload</span></div>
      {/if}
      <Roster onOpen={openDetail} />
    </div>

    <div class="mp-foot">
      {#if selectedPets.length > 0}
        <div class="mp-selection" data-testid="mypets-selection">
          <span class="sel-count">{selectedPets.length} selected</span>
          <button
            type="button"
            class="act-btn"
            data-testid="mypets-compare"
            disabled={!canCompare}
            title={canCompare ? 'Compare the two selected pets' : 'Select exactly two pets of the same species'}
            onclick={openCompare}
          >⚖️ Compare</button>
          <button
            type="button"
            class="act-btn"
            data-testid="mypets-share"
            title="Share the selected pets to the community catalogue"
            onclick={() => { bulkShareOpen = true; }}
          >🌐 Share</button>
          <button type="button" class="act-btn ghost" data-testid="mypets-clear" onclick={clearLibrarySelection}>Clear</button>
        </div>
      {/if}
      <div class="mp-add" data-testid="mypets-actions">
        <button
          type="button"
          class="upload-btn"
          data-testid="mypets-upload"
          onclick={upload.handleUpload}
          disabled={upload.uploading || upload.autoScanning}
        >
          {#if upload.uploadProgress}
            Uploading… ({upload.uploadProgress.current}/{upload.uploadProgress.total})
          {:else}
            + Upload Genome
          {/if}
        </button>
        <button
          type="button"
          class="auto-scan-btn"
          data-testid="mypets-autoscan"
          onclick={upload.handleAutoScan}
          disabled={upload.uploading || upload.autoScanning}
          title={$pendingImportCount > 0
            ? `Auto-import: ${$pendingImportCount} new genome file${$pendingImportCount === 1 ? '' : 's'} in the game folder`
            : 'Auto-import new genome files from the game folder'}
          aria-label={$pendingImportCount > 0
            ? `Auto-import ${$pendingImportCount} new genome file${$pendingImportCount === 1 ? '' : 's'} from the game folder`
            : 'Auto-import new genome files from the game folder'}
        >
          {#if upload.autoScanProgress}
            🔄 ({upload.autoScanProgress.current}/{upload.autoScanProgress.total})
          {:else}
            🔄
            {#if $pendingImportCount > 0}
              <span class="pending-badge" aria-hidden="true">{$pendingImportCount > 99 ? '99+' : $pendingImportCount}</span>
            {/if}
          {/if}
        </button>
      </div>
    </div>
  </div>

  {#if detailPet}
    <section class="mp-overlay" data-testid="pet-detail">
      <header class="mp-overlay-head">
        <button type="button" class="back-btn" data-testid="pet-detail-back" onclick={closeDetail}>← Pets</button>
        <span class="mp-overlay-title">{getSpeciesEmoji(detailPet.species)} {detailPet.name || 'Pet'}</span>
      </header>
      <!-- PetVisualization owns its own header (views / stats / gallery / share / edit / delete). -->
      <div class="mp-overlay-body"><PetVisualization pet={detailPet} /></div>
    </section>
  {:else if comparing && canCompare}
    <section class="mp-overlay" data-testid="pet-compare">
      <header class="mp-overlay-head">
        <button type="button" class="back-btn" data-testid="pet-compare-back" onclick={closeCompare}>← Pets</button>
        <span class="mp-overlay-title">⚖️ {selectedPets[0].name || 'Pet A'} vs {selectedPets[1].name || 'Pet B'}</span>
      </header>
      <div class="mp-overlay-body"><GenomeGridDiff petA={selectedPets[0]} petB={selectedPets[1]} /></div>
    </section>
  {/if}
</div>

{#if bulkShareOpen}
  <BulkSharePetDialog
    pets={selectedPets}
    onClose={() => { bulkShareOpen = false; }}
    onResult={handleBulkShareResult}
  />
{/if}

<style>
  .my-pets { position: relative; flex: 1; min-width: 0; height: 100%; display: flex; flex-direction: column; overflow: hidden; }

  .mp-main { flex: 1; min-height: 0; display: flex; flex-direction: column; }
  .mp-main.hidden { display: none; }
  .mp-head { padding: 10px 16px; border-bottom: 1px solid var(--border-primary); flex-shrink: 0; }
  .mp-share-status { padding: 8px 16px 0; }

  .mp-table { position: relative; flex: 1; min-height: 0; overflow: auto; }

  .file-drop-overlay {
    position: absolute; inset: 0; z-index: 5;
    display: flex; align-items: center; justify-content: center;
    pointer-events: none;
    background: var(--bg-selected); border: 2px dashed var(--accent); border-radius: 8px; opacity: 0.95;
  }
  .file-drop-overlay span {
    font-size: 14px; font-weight: 600; color: var(--accent-text);
    padding: 12px 20px; border-radius: 8px; background: var(--bg-primary); box-shadow: var(--shadow-lg);
  }

  .mp-foot { border-top: 1px solid var(--border-primary); background: var(--bg-secondary); flex-shrink: 0; }
  .mp-selection {
    display: flex; align-items: center; gap: 8px; padding: 8px 16px;
    border-bottom: 1px solid var(--border-primary);
  }
  .sel-count { font-size: 12px; font-weight: 600; color: var(--text-secondary); margin-right: auto; }
  .act-btn {
    padding: 5px 12px; border: 1px solid var(--border-primary); border-radius: 6px;
    background: var(--bg-primary); color: var(--text-secondary);
    font-size: 12px; font-weight: 600; cursor: pointer;
  }
  .act-btn:hover:not(:disabled) { color: var(--accent-text, var(--accent)); border-color: var(--accent); }
  .act-btn:disabled { opacity: 0.5; cursor: default; }
  .act-btn.ghost { border-color: transparent; color: var(--text-tertiary); }

  .mp-add { display: flex; align-items: center; gap: 8px; padding: 9px 16px; }
  .upload-btn {
    padding: 7px 14px; border: none; border-radius: 7px;
    background: var(--accent); color: var(--accent-text); font-size: 12px; font-weight: 600; cursor: pointer;
  }
  .upload-btn:hover:not(:disabled) { filter: brightness(1.05); }
  .upload-btn:disabled { opacity: 0.6; cursor: default; }
  .auto-scan-btn {
    position: relative; padding: 7px 10px; border: 1px solid var(--border-primary);
    border-radius: 7px; background: var(--bg-primary); font-size: 13px; cursor: pointer;
  }
  .auto-scan-btn:hover:not(:disabled) { background: var(--bg-hover); }
  .auto-scan-btn:disabled { opacity: 0.6; cursor: default; }
  .pending-badge {
    position: absolute; top: -4px; right: -4px; min-width: 16px; height: 16px;
    padding: 0 3px; border-radius: 8px; background: var(--accent); color: var(--accent-text);
    font-size: 9px; font-weight: 700; line-height: 16px; text-align: center;
  }

  /* Detail / compare overlay covers the (still-mounted) table. */
  .mp-overlay { position: absolute; inset: 0; z-index: 10; background: var(--bg-primary); display: flex; flex-direction: column; }
  .mp-overlay-head {
    display: flex; align-items: center; gap: 12px; padding: 8px 16px;
    border-bottom: 1px solid var(--border-primary); flex-shrink: 0;
  }
  .mp-overlay-title { font-size: 13px; font-weight: 600; color: var(--text-primary); }
  .back-btn {
    padding: 5px 12px; border: 1px solid var(--border-primary); border-radius: 6px;
    background: var(--bg-primary); color: var(--text-secondary); font-size: 12px; font-weight: 600; cursor: pointer;
  }
  .back-btn:hover { color: var(--text-primary); background: var(--bg-hover); }
  .mp-overlay-body { flex: 1; min-height: 0; overflow: hidden; display: flex; }
</style>
