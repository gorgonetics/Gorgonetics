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
import Roster from '$lib/components/mypets/Roster.svelte';
import PetVisualization from '$lib/components/pet/PetVisualization.svelte';
import DetailOverlay from '$lib/components/shared/DetailOverlay.svelte';
import EmptyState from '$lib/components/shared/EmptyState.svelte';
import FilterBar from '$lib/components/shared/FilterBar.svelte';
import StatusBanner from '$lib/components/shared/StatusBanner.svelte';
import { isPlaceholderConfig } from '$lib/firebase.js';
import { getSupportedSpecies, normalizeSpecies } from '$lib/services/configService.js';
import { bulkShareJob, startBulkShare } from '$lib/stores/bulkShare.svelte.js';
import { pendingImportCount } from '$lib/stores/gameImport.js';
import { clearMyPetsSelection, getMyPetsFilters, myPetsView } from '$lib/stores/mypets.svelte.js';
import { allTags, loading, pets } from '$lib/stores/pets.js';
import { type DialogResult, type Gender, HORSE_BREEDS, type Pet } from '$lib/types/index.js';
import { focusTrap } from '$lib/utils/focusTrap.js';
import { createGenomeUploadController } from '$lib/utils/genomeUploadController.svelte.js';
import { filterPets } from '$lib/utils/petFilter.js';
import { getSpeciesEmoji } from '$lib/utils/species.js';

const speciesOptions = getSupportedSpecies();
const upload = createGenomeUploadController();

const BREEDS_BY_SPECIES: Record<string, Record<string, string>> = {
  beewasp: { Bee: 'Bee', Wasp: 'Wasp' },
  horse: HORSE_BREEDS,
};
const breedsForSpecies = $derived(myPetsView.species ? BREEDS_BY_SPECIES[myPetsView.species] : undefined);

const flags = $derived([
  { key: 'starred', label: '★ Starred', active: myPetsView.starredOnly },
  { key: 'stabled', label: '🏠 Stabled', active: myPetsView.stabledOnly },
  { key: 'petQuality', label: '🏆 Pet quality', active: myPetsView.petQualityOnly },
]);

function toggleFlag(key: string): void {
  if (key === 'starred') myPetsView.starredOnly = !myPetsView.starredOnly;
  else if (key === 'stabled') myPetsView.stabledOnly = !myPetsView.stabledOnly;
  else if (key === 'petQuality') myPetsView.petQualityOnly = !myPetsView.petQualityOnly;
}

function toggleTag(tag: string): void {
  myPetsView.tags = myPetsView.tags.includes(tag)
    ? myPetsView.tags.filter((t) => t !== tag)
    : [...myPetsView.tags, tag];
}

// --- View mode: table (default) | detail | compare -------------------------
let detailPetId = $state<number | null>(null);
let comparing = $state(false);

// Switching species changes the candidate universe. In one effect, keyed on the
// species: drop a breed that no longer belongs to it, and (on an *actual*
// change, not the initial mount run, so it can't clobber a freshly-opened
// detail) clear the multi-selection and close any open detail/compare.
let prevSpecies: string | undefined;
$effect(() => {
  const species = myPetsView.species;
  if (myPetsView.breed && (!breedsForSpecies || !(myPetsView.breed in breedsForSpecies))) {
    myPetsView.breed = '';
  }
  if (prevSpecies !== undefined && prevSpecies !== species) {
    clearMyPetsSelection();
    detailPetId = null;
    comparing = false;
  }
  prevSpecies = species;
});

// Honour a cross-destination "open this pet" request (e.g. clicking a parent in
// the Breed pair table switched here). Wait until the pet is actually in the
// loaded list before consuming the request, so one that arrives before
// loadPets() resolves isn't silently dropped (it opens once the pet lands).
$effect(() => {
  const requested = myPetsView.openPetId;
  if (requested == null) return;
  if (!$pets.some((p) => p.id === requested)) return;
  detailPetId = requested;
  comparing = false;
  myPetsView.openPetId = null;
});

// Resolve against the live pet list, but retain a snapshot of the open pet so a
// transient absence during a background reload can't blink the overlay shut.
// AuthWrapper's startup backfills each fire `loadPets()` → `pets.set(...)` well
// after mount; coupling the overlay's lifetime directly to a `$pets.find()`
// would tear down the detail (and its Share/Edit/Delete controls) mid-render if
// a reload momentarily lands without our pet. Reconcile to the fresh object
// whenever it's present so backfilled fields (gene counts, …) still surface.
const livePet = $derived(detailPetId == null ? null : ($pets.find((p) => p.id === detailPetId) ?? null));
let detailPetSnapshot = $state<Pet | null>(null);
$effect(() => {
  if (livePet) detailPetSnapshot = livePet;
});
// Only fall back to the snapshot when it's the *same* pet — otherwise switching
// to another pet while its row hasn't landed yet would briefly show the prior one.
const detailPet = $derived(
  detailPetId == null ? null : (livePet ?? (detailPetSnapshot?.id === detailPetId ? detailPetSnapshot : null)),
);

// A genuinely deleted pet still drops us back to the table — but only on a
// *settled* load (`!$loading`). During an in-flight reload the list can briefly
// lack the pet; that window always closes with `loading` true, so it can't be
// mistaken for a deletion.
$effect(() => {
  if (detailPetId != null && !$loading && !$pets.some((p) => p.id === detailPetId)) {
    detailPetId = null;
    detailPetSnapshot = null;
  }
});

// Visible pets = the filtered set, computed once and passed to the Roster as a
// prop (#405). The selection is scoped to these so a pet hidden by a
// search/breed/gender/flag filter can't drive Compare or Share while off-screen.
const visiblePets = $derived(filterPets($pets, getMyPetsFilters()));
const selectedPets = $derived(visiblePets.filter((p) => myPetsView.selectedIds.has(p.id)));
const compareSpecies = $derived(selectedPets.length === 2 ? normalizeSpecies(selectedPets[0].species) : '');
const canCompare = $derived(
  selectedPets.length === 2 && compareSpecies !== '' && normalizeSpecies(selectedPets[1].species) === compareSpecies,
);

// A compare view that loses its second pet (deletion, filtered out, or a
// background reload) would otherwise leave `comparing` true with the overlay
// unmounted and the table hidden — a blank screen. Drop back to the table.
$effect(() => {
  if (comparing && !canCompare) comparing = false;
});

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
  if (result.type !== 'error') clearMyPetsSelection();
}

// --- Share all (whole collection, background job) ---------------------------
// "All" means every pet, deliberately not the Stabled subset — the button
// label/confirm say so to avoid conflating it with the Stabled flag. Hidden
// when there's nothing to share or this build can't reach the catalogue.
let showShareAllConfirm = $state(false);
const canShareAll = $derived(!isPlaceholderConfig && $pets.length > 0);
</script>

<div class="my-pets" data-testid="my-pets">
  <!-- Table layer — always mounted so detail/compare preserve its scroll. -->
  <div class="mp-main" class:hidden={detailPet || comparing}>
    <div class="mp-head">
      <FilterBar
        search={myPetsView.search}
        onSearch={(v) => { myPetsView.search = v; }}
        species={speciesOptions}
        activeSpecies={myPetsView.species}
        onSpecies={(v) => { myPetsView.species = v; }}
        breeds={breedsForSpecies}
        breed={myPetsView.breed}
        onBreed={(v) => { myPetsView.breed = v; }}
        genders={['Male', 'Female']}
        activeGender={myPetsView.gender}
        onGender={(v) => { myPetsView.gender = v as Gender | ''; }}
        tagOptions={$allTags}
        activeTags={myPetsView.tags}
        onToggleTag={toggleTag}
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
      {#if $pets.length === 0 && !$loading}
        <div class="mp-empty" data-testid="mypets-empty">
          <EmptyState
            icon="🐾"
            title="No pets yet"
            body="Upload a genome file (or drop one here) to start building your stable."
          />
        </div>
      {:else}
        <Roster pets={visiblePets} onOpen={openDetail} />
      {/if}
    </div>

    <div class="mp-foot">
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
      {#if $pets.length > 0}
        <span class="mp-count" data-testid="mypets-count">
          Showing {visiblePets.length} of {$pets.length} {$pets.length === 1 ? 'pet' : 'pets'}
        </span>
      {/if}
      {#if canShareAll}
        <button
          type="button"
          class="act-btn share-all-btn"
          data-testid="mypets-share-all"
          disabled={bulkShareJob.status === 'running'}
          title="Share every pet in your collection to the public community catalogue"
          onclick={() => { showShareAllConfirm = true; }}
        >🌐 Share all</button>
      {/if}
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
          <button type="button" class="act-btn ghost" data-testid="mypets-clear" onclick={clearMyPetsSelection}>Clear</button>
        </div>
      {/if}
    </div>
  </div>

  {#if detailPet}
    <DetailOverlay testid="pet-detail" backTestid="pet-detail-back" backLabel="← Pets" ariaLabel="Pet detail" onBack={closeDetail}>
      {#snippet title()}{getSpeciesEmoji(detailPet.species)} {detailPet.name || 'Pet'}{/snippet}
      <!-- PetVisualization owns its own header (views / stats / gallery / share / edit / delete). -->
      <PetVisualization pet={detailPet} />
    </DetailOverlay>
  {:else if comparing && canCompare}
    <!-- GenomeGridDiff owns its DetailOverlay shell (back button, title, and the
         summary pills in the header). -->
    <GenomeGridDiff petA={selectedPets[0]} petB={selectedPets[1]} onBack={closeCompare} />
  {/if}
</div>

{#if bulkShareOpen}
  <BulkSharePetDialog
    pets={selectedPets}
    onClose={() => { bulkShareOpen = false; }}
    onResult={handleBulkShareResult}
  />
{/if}

{#if showShareAllConfirm}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div
    class="modal-backdrop"
    onclick={() => { showShareAllConfirm = false; }}
    onkeydown={(e) => { if (e.key === 'Escape') showShareAllConfirm = false; }}
    role="presentation"
  >
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="dialog share-all-dialog"
      role="dialog"
      aria-modal="true"
      aria-label="Share all pets to community"
      tabindex="-1"
      use:focusTrap
      data-testid="share-all-dialog"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => { if (e.key === 'Escape') showShareAllConfirm = false; }}
    >
      <div class="dialog-header"><h3>Share all {$pets.length} {$pets.length === 1 ? 'pet' : 'pets'} to the community?</h3></div>
      <div class="dialog-body">
        <p class="dialog-desc">
          This publishes <strong>every pet in your collection</strong> — not just stabled ones — to the public
          community catalogue. Pets already shared are skipped. Sharing runs in the background; you can keep using the
          app and cancel any time.
        </p>
      </div>
      <div class="dialog-footer">
        <button type="button" class="act-btn ghost" onclick={() => { showShareAllConfirm = false; }}>Cancel</button>
        <button
          type="button"
          class="upload-btn"
          data-testid="share-all-confirm"
          onclick={() => { startBulkShare($pets); showShareAllConfirm = false; }}
        >🌐 Share all</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .my-pets { position: relative; flex: 1; min-width: 0; height: 100%; display: flex; flex-direction: column; overflow: hidden; }

  .mp-main { flex: 1; min-height: 0; display: flex; flex-direction: column; }
  .mp-main.hidden { display: none; }
  .mp-head { padding: 10px 16px; border-bottom: 1px solid var(--border-primary); flex-shrink: 0; }
  .mp-share-status { padding: 8px 16px 0; }

  .mp-table { position: relative; flex: 1; min-height: 0; overflow: auto; }
  .mp-empty { height: 100%; display: flex; align-items: center; justify-content: center; }

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

  /* One footer strip: add-actions on the left, selection-actions on the right
     (when a selection exists) — no stacked bars. */
  .mp-foot {
    display: flex; align-items: center; gap: 12px; padding: 8px 16px;
    border-top: 1px solid var(--border-primary); background: var(--bg-secondary); flex-shrink: 0;
  }
  .mp-count { font-size: 12px; color: var(--text-tertiary); white-space: nowrap; }
  .mp-selection { margin-left: auto; display: flex; align-items: center; gap: 8px; }
  .sel-count { font-size: 12px; font-weight: 600; color: var(--text-secondary); }
  .act-btn {
    padding: 5px 12px; border: 1px solid var(--border-primary); border-radius: 6px;
    background: var(--bg-primary); color: var(--text-secondary);
    font-size: 12px; font-weight: 600; cursor: pointer;
  }
  .act-btn:hover:not(:disabled) { color: var(--accent-text, var(--accent)); border-color: var(--accent); }
  .act-btn:disabled { opacity: 0.5; cursor: default; }
  .act-btn.ghost { border-color: transparent; color: var(--text-tertiary); }
  /* Share-all sits with the add-actions, pushed to the right of the strip. */
  .share-all-btn { margin-left: auto; }
  .share-all-btn ~ .mp-selection { margin-left: 0; }

  .share-all-dialog { max-width: 460px; }
  .dialog-desc { font-size: 14px; color: var(--text-secondary); margin: 0; line-height: 1.5; }

  .mp-add { display: flex; align-items: center; gap: 8px; }
  .upload-btn {
    padding: 7px 14px; border: none; border-radius: 7px;
    background: var(--accent); color: var(--text-inverse); font-size: 12px; font-weight: 600; cursor: pointer;
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
    padding: 0 3px; border-radius: 8px; background: var(--accent); color: var(--text-inverse);
    font-size: 9px; font-weight: 700; line-height: 16px; text-align: center;
  }

  /* Detail / compare full-view shells (DetailOverlay) cover the still-mounted table. */
</style>
