<script lang="ts">
import StatusPane from '$lib/components/shared/StatusPane.svelte';
import { normalizeSpecies } from '$lib/services/configService.js';
import { pickGenomeFiles, readFileContent } from '$lib/services/fileService.js';
import { autoScanGameFolder } from '$lib/services/gameImport.js';
import { compareSelectMode, comparisonActions, comparisonPets, comparisonReady } from '$lib/stores/comparison.js';
import { pendingImportCount, refreshPendingImportCount } from '$lib/stores/gameImport.js';
import type { MarkerKey } from '$lib/stores/pets.js';
import { allTags as allTagsStore, appState, error, pets, selectedPet } from '$lib/stores/pets.js';
import type { Pet } from '$lib/types/index.js';
import { createDragState, createKeyboardReorder, moveByFilteredIndex } from '$lib/utils/dragReorder.svelte.js';
import { errorMessage } from '$lib/utils/error.js';
import { focusTrap } from '$lib/utils/focusTrap.js';
import type { UploadSource } from '$lib/utils/genomeUpload.js';
import { isFileDrag, runGenomeUpload, selectGenomeFiles } from '$lib/utils/genomeUpload.js';
import { getBasename } from '$lib/utils/path.js';
import PetCard from './PetCard.svelte';
import PetEditor from './PetEditor.svelte';

function isSelectedForComparison(petId: number): boolean {
  return $comparisonPets[0]?.id === petId || $comparisonPets[1]?.id === petId;
}

function toggleComparisonPet(pet: Pet): void {
  if (isSelectedForComparison(pet.id)) {
    comparisonActions.removePet(pet.id);
  } else {
    comparisonActions.addPet(pet);
  }
}

function isCompareDisabled(pet: Pet): boolean {
  if (isSelectedForComparison(pet.id)) return false;
  if ($comparisonReady) return true;
  // Disable different species when first pet is selected
  const first = $comparisonPets[0];
  if (first && normalizeSpecies(first.species) !== normalizeSpecies(pet.species)) return true;
  return false;
}

function startCompare(): void {
  comparisonActions.toggleSelectMode();
  appState.switchTab('compare');
}

let searchQuery = $state('');
// Mirror of searchQuery, updated after a small idle window so the
// $derived.by below doesn't replay the whole filter on every keystroke.
let debouncedSearchQuery = $state('');
const SEARCH_DEBOUNCE_MS = 150;
let selectedTags = $state<string[]>([]);
let starredOnly = $state(false);
let stabledOnly = $state(true);
let uploading = $state(false);
let uploadProgress = $state<{ current: number; total: number } | null>(null);
let autoScanning = $state(false);
let autoScanProgress = $state<{ current: number; total: number } | null>(null);
let showEditor = $state(false);
let editingPet = $state<Pet | null>(null);
let deletingPet = $state<Pet | null>(null);

const availableTags = $derived($allTagsStore);

// Remove stale selected tags that no longer exist on any pet
$effect(() => {
  if (selectedTags.length > 0 && availableTags.length >= 0) {
    const valid = selectedTags.filter((t) => availableTags.includes(t));
    if (valid.length !== selectedTags.length) {
      selectedTags = valid;
    }
  }
});

$effect(() => {
  const q = searchQuery;
  const timer = setTimeout(() => {
    debouncedSearchQuery = q;
  }, SEARCH_DEBOUNCE_MS);
  return () => clearTimeout(timer);
});

const filteredPets = $derived.by((): Pet[] => {
  const q = debouncedSearchQuery ? debouncedSearchQuery.toLowerCase() : '';
  return $pets.filter((pet: Pet) => {
    if (q) {
      if (!(pet.name || '').toLowerCase().includes(q) && !(pet.species || '').toLowerCase().includes(q)) {
        return false;
      }
    }
    if (selectedTags.length > 0) {
      const petTags = pet.tags ?? [];
      if (!selectedTags.every((t) => petTags.includes(t))) return false;
    }
    if (starredOnly && !pet.starred) return false;
    if (stabledOnly && !pet.stabled) return false;
    return true;
  });
});

function toggleTagFilter(tag: string): void {
  if (selectedTags.includes(tag)) {
    selectedTags = selectedTags.filter((t) => t !== tag);
  } else {
    selectedTags = [...selectedTags, tag];
  }
}

function selectPet(pet: Pet): void {
  appState.selectPet(pet);
}

async function toggleMarker(petId: number, key: MarkerKey, value: boolean): Promise<void> {
  const pet = $pets.find((p: Pet) => p.id === petId);
  if (!pet || pet[key] === value) return;
  // Optimistic in-place flip — no full list reload, so the toggle is
  // instant (#275). Errors are surfaced via the shared `error` store.
  await appState.setPetMarker(petId, key, value).catch(() => {});
}

// Upload a batch of genome sources (file paths or dropped files), reusing the
// shared sequential runner. Reloads the list once and surfaces a per-file
// failure summary. Guarded so picker and drop uploads can't run concurrently.
async function uploadSources(sources: UploadSource[]): Promise<void> {
  if (sources.length === 0 || uploading || autoScanning) return;
  uploading = true;
  error.set(null);
  try {
    const { total, succeeded, failures } = await runGenomeUpload(sources, {
      upload: (content: string) => appState.uploadPetQuiet(content),
      onProgress: (current: number, t: number) => {
        uploadProgress = { current, total: t };
      },
    });
    await appState.loadPets();
    if (failures.length > 0) {
      error.set(`${succeeded}/${total} uploaded. ${failures.length} failed:\n${failures.join('\n')}`);
    }
  } catch (err) {
    error.set(`Upload failed: ${errorMessage(err)}`);
  } finally {
    uploading = false;
    uploadProgress = null;
  }
}

async function handleUpload(): Promise<void> {
  let filePaths: string[];
  try {
    filePaths = await pickGenomeFiles();
  } catch (err) {
    error.set(`Upload failed: ${errorMessage(err)}`);
    return;
  }
  await uploadSources(filePaths.map((path) => ({ name: getBasename(path), read: () => readFileContent(path) })));
}

// Drag-and-drop genome upload (#98). dragDropEnabled is false in
// tauri.conf.json (so Tauri doesn't intercept events used for card
// reordering), which leaves the webview's native HTML5 drag events to us.
// External OS file drags carry a 'Files' type; internal card-reorder drags
// don't — so isFileDrag() tells the two apart.
let fileDragActive = $state(false);

function handleFileDragOver(e: DragEvent): void {
  if (!isFileDrag(e.dataTransfer)) return;
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  fileDragActive = true;
}

function handleFileDragLeave(e: DragEvent & { currentTarget: EventTarget & Element }): void {
  if (!isFileDrag(e.dataTransfer)) return;
  // Ignore leaves into descendant elements; only clear when the cursor leaves
  // the panel entirely (relatedTarget is null when leaving the window).
  if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
  fileDragActive = false;
}

async function handleFileDrop(e: DragEvent): Promise<void> {
  if (!isFileDrag(e.dataTransfer)) return;
  e.preventDefault();
  fileDragActive = false;
  const dropped = Array.from(e.dataTransfer?.files ?? []);
  if (dropped.length === 0) return;

  const { accepted, rejected } = selectGenomeFiles(dropped);
  if (accepted.length === 0) {
    error.set('No genome files (.txt) in the dropped items.');
    return;
  }
  await uploadSources(accepted.map((file: File) => ({ name: file.name, read: () => file.text() })));
  if (rejected.length > 0 && !$error) {
    error.set(`Skipped ${rejected.length} non-genome file${rejected.length === 1 ? '' : 's'}.`);
  }
}

// External file drags also bubble through the per-card reorder handlers. Skip
// the reorder path for them so they don't show the reorder indicator or fight
// the panel-level drop handler.
function handleCardDragOver(e: DragEvent, index: number): void {
  if (isFileDrag(e.dataTransfer)) return;
  drag.handleDragOver(e, index);
}

async function handleAutoScan(): Promise<void> {
  try {
    autoScanning = true;
    error.set(null);
    const result = await autoScanGameFolder({
      onProgress: (current: number, total: number) => {
        autoScanProgress = { current, total };
      },
    });

    if (result.status === 'not_configured') {
      error.set('Auto-import folder is not configured. Set the path in Settings → Auto-import.');
      return;
    }
    if (result.status === 'folder_missing') {
      error.set(result.message ?? 'Configured game folder was not found.');
      return;
    }
    if (result.status === 'error') {
      error.set(result.message ?? 'Auto-import failed.');
      return;
    }

    // autoScanGameFolder refreshes the pets store itself on a DB change (#253).
    const backfillNote = result.backfilled > 0 ? `, ${result.backfilled} unlocked for sharing` : '';
    const summary = `Auto-import: ${result.imported} new, ${result.skipped} already imported${backfillNote} (of ${result.scanned} files).`;
    if (result.failures.length > 0) {
      const lines = result.failures.map((f: { file: string; reason: string }) => `${f.file}: ${f.reason}`);
      error.set(`${summary}\n${result.failures.length} failed:\n${lines.join('\n')}`);
    } else if (result.imported > 0 || result.backfilled > 0) {
      error.set(summary);
    }
  } catch (err) {
    error.set(`Auto-import failed: ${errorMessage(err)}`);
  } finally {
    autoScanning = false;
    autoScanProgress = null;
    // Reflect whatever the scan left un-imported (e.g. files that failed).
    void refreshPendingImportCount();
  }
}

function closeEditor(): void {
  showEditor = false;
  editingPet = null;
}

function handleDelete(pet: Pet): void {
  deletingPet = pet;
}

async function confirmDelete(): Promise<void> {
  if (deletingPet) {
    await appState.deletePet(deletingPet.id);
    deletingPet = null;
  }
}

function cancelDelete(): void {
  deletingPet = null;
}

function handlePetCardKeydown(e: KeyboardEvent, index: number): void {
  const len = filteredPets.length;
  if (len === 0) return;

  let nextIndex = -1;
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    nextIndex = Math.min(index + 1, len - 1);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    nextIndex = Math.max(index - 1, 0);
  } else if (e.key === 'Home') {
    e.preventDefault();
    nextIndex = 0;
  } else if (e.key === 'End') {
    e.preventDefault();
    nextIndex = len - 1;
  }

  if (nextIndex >= 0 && nextIndex !== index) {
    const cards = document.querySelectorAll<HTMLElement>('.pet-list-items .pet-card');
    cards[nextIndex]?.focus();
  }
}

const drag = createDragState();
const isDraggable = $derived(!searchQuery && selectedTags.length === 0);

async function handleDrop(e: DragEvent, dropIndex: number): Promise<void> {
  e.preventDefault();
  drag.dragOverIndex = null;
  if (drag.draggedIndex === null || drag.draggedIndex === dropIndex) return;

  // Resolve by pet ID so indices are correct regardless of filtering
  const fromPet = filteredPets[drag.draggedIndex];
  if (!fromPet) {
    drag.draggedIndex = null;
    return;
  }

  const previous = [...$pets];
  const reordered = [...$pets];
  const fromIdx = reordered.findIndex((p: Pet) => p.id === fromPet.id);
  if (fromIdx < 0) {
    drag.draggedIndex = null;
    return;
  }

  const [moved] = reordered.splice(fromIdx, 1);
  if (dropIndex >= filteredPets.length) {
    reordered.push(moved);
  } else {
    const toPet = filteredPets[dropIndex];
    if (!toPet) {
      drag.draggedIndex = null;
      return;
    }
    const toIdx = reordered.findIndex((p: Pet) => p.id === toPet.id);
    if (toIdx < 0) {
      drag.draggedIndex = null;
      return;
    }
    reordered.splice(toIdx, 0, moved);
  }
  pets.set(reordered);
  drag.draggedIndex = null;

  try {
    await appState.reorderPets(reordered.map((p: Pet) => p.id));
  } catch {
    pets.set(previous);
  }
}

// Keyboard-accessible reordering (#105). Handle indices are positions in the
// rendered `filteredPets`, which can be a subset of `$pets` (the starred/stabled
// marker filters narrow it even while `isDraggable` is true). So translate the
// move to `$pets` by pet id — the same id-resolution the drag `handleDrop` uses
// — rather than indexing `$pets` directly.
let reorderAnnouncement = $state('');
const kbReorder = createKeyboardReorder({
  count: () => filteredPets.length,
  reorder: (from: number, to: number) => pets.set(moveByFilteredIndex($pets, filteredPets, from, to, (p: Pet) => p.id)),
  persist: () => appState.reorderPets($pets.map((p: Pet) => p.id)),
  snapshot: () => [...$pets],
  restore: (snap: unknown) => pets.set(snap as Pet[]),
  label: (i: number) => filteredPets[i]?.name || 'Unnamed',
  announce: (msg: string) => {
    reorderAnnouncement = msg;
  },
  focusItem: (i: number) => {
    document.querySelectorAll<HTMLElement>('.pet-list-items .reorder-handle')[i]?.focus();
  },
});
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
    class="pet-list"
    class:file-drag-active={fileDragActive}
    ondragover={handleFileDragOver}
    ondragleave={handleFileDragLeave}
    ondrop={handleFileDrop}
>
    {#if fileDragActive}
        <div class="file-drop-overlay" aria-hidden="true">
            <span>Drop genome files to upload</span>
        </div>
    {/if}
    <div class="pet-list-header">
        <input
            class="text-input text-input--lg"
            type="text"
            placeholder="Search pets..."
            bind:value={searchQuery}
        />
        <div class="marker-filter">
            <button
                class="marker-filter-btn"
                class:active={starredOnly}
                onclick={() => { starredOnly = !starredOnly; }}
                title="Show only starred pets"
            >⭐ Starred</button>
            <button
                class="marker-filter-btn"
                class:active={stabledOnly}
                onclick={() => { stabledOnly = !stabledOnly; }}
                title="Show only pets in your stables"
            >🏠 Stabled</button>
        </div>
        {#if availableTags.length > 0}
            <div class="tag-filter">
                {#each availableTags as tag}
                    <button
                        class="tag-filter-btn"
                        class:active={selectedTags.includes(tag)}
                        onclick={() => toggleTagFilter(tag)}
                    >{tag}</button>
                {/each}
            </div>
        {/if}
    </div>

    <div class="sr-only" aria-live="polite" role="status">{reorderAnnouncement}</div>
    <div class="pet-list-items" aria-label="Pet list">
        {#if filteredPets.length > 0}
            {#each filteredPets as pet, index (pet.id)}
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <div
                    class="pet-card-wrapper"
                    class:drag-over={drag.dragOverIndex === index && drag.draggedIndex !== index}
                    class:dragging={drag.draggedIndex === index}
                    class:kb-grabbed={kbReorder.isGrabbed(index)}
                    draggable={isDraggable}
                    ondragstart={(e) => drag.handleDragStart(e, index)}
                    ondragover={(e) => handleCardDragOver(e, index)}
                    ondragleave={drag.handleDragLeave}
                    ondrop={(e) => handleDrop(e, index)}
                    ondragend={drag.handleDragEnd}
                >
                    {#if isDraggable}
                        <button
                            type="button"
                            class="reorder-handle"
                            aria-label="Reorder {pet.name || 'Unnamed'}"
                            aria-grabbed={kbReorder.isGrabbed(index)}
                            title="Reorder: press Space to grab, arrow keys to move, Space to drop"
                            onkeydown={(e) => kbReorder.handleKeydown(e, index)}
                            onblur={kbReorder.handleBlur}
                        >⠿</button>
                    {/if}
                    {#if $compareSelectMode}
                        <input
                            type="checkbox"
                            class="compare-checkbox"
                            checked={isSelectedForComparison(pet.id)}
                            disabled={isCompareDisabled(pet)}
                            onchange={() => toggleComparisonPet(pet)}
                            aria-label="Select {pet.name || 'Unnamed'} for comparison"
                        />
                    {/if}
                    <PetCard
                        {pet}
                        selected={$selectedPet?.id === pet.id}
                        onclick={$compareSelectMode ? () => toggleComparisonPet(pet) : selectPet}
                        onkeydown={(e) => handlePetCardKeydown(e, index)}
                        onToggleMarker={toggleMarker}
                    />
                    <div class="pet-card-actions">
                        <button
                            class="action-btn edit-btn"
                            title="Edit pet"
                            data-action="edit"
                            data-pet-id={pet.id}
                            onclick={() => { editingPet = pet; showEditor = true; }}
                        >✎</button>
                        <button
                            class="action-btn delete-btn"
                            title="Delete pet"
                            data-action="delete"
                            data-pet-id={pet.id}
                            onclick={() => handleDelete(pet)}
                        >✕</button>
                    </div>
                </div>
            {/each}
            {#if isDraggable && drag.draggedIndex !== null}
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <div
                    class="drop-zone-end"
                    class:drag-over={drag.dragOverIndex === filteredPets.length}
                    ondragover={(e) => drag.handleDragOver(e, filteredPets.length)}
                    ondragleave={drag.handleDragLeave}
                    ondrop={(e) => handleDrop(e, filteredPets.length)}
                ></div>
            {/if}
        {:else if $pets.length > 0 && (searchQuery || selectedTags.length > 0 || starredOnly || stabledOnly)}
            <StatusPane variant="empty" body="No pets match the current filters" />
        {:else}
            <StatusPane variant="empty" body="No pets yet. Upload a genome file to get started." />
        {/if}
    </div>

    <div class="pet-list-footer">
        {#if $compareSelectMode}
            <button class="cancel-compare-btn" onclick={() => comparisonActions.toggleSelectMode()}>
                Cancel
            </button>
            <button
                class="compare-now-btn"
                disabled={!$comparisonReady}
                onclick={startCompare}
            >
                Compare ({[$comparisonPets[0], $comparisonPets[1]].filter(Boolean).length}/2) →
            </button>
        {:else}
            <button
                class="upload-btn"
                onclick={handleUpload}
                disabled={uploading || autoScanning}
            >
                {#if uploadProgress}
                    Uploading... ({uploadProgress.current}/{uploadProgress.total})
                {:else}
                    + Upload Genome
                {/if}
            </button>
            <button
                class="auto-scan-btn"
                onclick={handleAutoScan}
                disabled={uploading || autoScanning}
                title={$pendingImportCount > 0
                    ? `Auto-import: ${$pendingImportCount} new genome file${$pendingImportCount === 1 ? '' : 's'} in the game folder`
                    : 'Auto-import new genome files from the game folder'}
                aria-label={$pendingImportCount > 0
                    ? `Auto-import ${$pendingImportCount} new genome file${$pendingImportCount === 1 ? '' : 's'} from the game folder`
                    : 'Auto-import new genome files from the game folder'}
            >
                {#if autoScanProgress}
                    🔄 ({autoScanProgress.current}/{autoScanProgress.total})
                {:else}
                    🔄
                    {#if $pendingImportCount > 0}
                        <span class="pending-badge" aria-hidden="true">{$pendingImportCount > 99 ? '99+' : $pendingImportCount}</span>
                    {/if}
                {/if}
            </button>
            <button
                class="compare-mode-btn"
                onclick={() => comparisonActions.toggleSelectMode()}
                disabled={$pets.length < 2}
                title="Compare two pets"
            >⚖️</button>
        {/if}
        <span class="pet-count">{$pets.length} pets</span>
    </div>
</div>

{#if editingPet}
    <PetEditor
        pet={editingPet}
        bind:open={showEditor}
        onClose={closeEditor}
        onSave={() => {}}
    />
{/if}

{#if deletingPet}
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="modal-backdrop" onclick={cancelDelete} onkeydown={(e) => { if (e.key === 'Escape') cancelDelete(); }}>
    <div class="confirm-dialog" role="alertdialog" aria-label="Confirm delete" aria-modal="true" use:focusTrap>
        <p class="confirm-message">Delete <strong>{deletingPet.name}</strong>?</p>
        <p class="confirm-subtext">This action cannot be undone.</p>
        <div class="confirm-actions">
            <button class="btn btn-secondary" onclick={cancelDelete}>Cancel</button>
            <button class="btn btn-danger" onclick={confirmDelete}>Delete</button>
        </div>
    </div>
</div>
{/if}

<style>
    .confirm-dialog {
        background: var(--bg-primary);
        border-radius: 12px;
        box-shadow: var(--shadow-xl);
        padding: 24px;
        width: 340px;
        max-width: 90vw;
        text-align: center;
    }

    .confirm-message {
        font-size: 15px;
        color: var(--text-primary);
        margin: 0 0 4px 0;
    }

    .confirm-subtext {
        font-size: 12px;
        color: var(--text-muted);
        margin: 0 0 20px 0;
    }

    .confirm-actions {
        display: flex;
        gap: 8px;
        justify-content: center;
    }

    .pet-list {
        position: relative;
        display: flex;
        flex-direction: column;
        height: 100%;
    }

    .file-drop-overlay {
        position: absolute;
        inset: 0;
        z-index: 5;
        display: flex;
        align-items: center;
        justify-content: center;
        /* Let drag events fall through to the panel handlers underneath. */
        pointer-events: none;
        background: var(--bg-selected);
        border: 2px dashed var(--accent);
        border-radius: 8px;
        opacity: 0.95;
    }

    .file-drop-overlay span {
        font-size: 14px;
        font-weight: 600;
        color: var(--accent-text);
        padding: 12px 20px;
        border-radius: 8px;
        background: var(--bg-primary);
        box-shadow: var(--shadow-lg);
    }

    .pet-list-header {
        /* Extra right padding carves out space for the MasterPanel collapse button
           absolutely positioned at top: 6px; right: 6px (24px wide). */
        padding: 12px 34px 12px 12px;
        border-bottom: 1px solid var(--border-primary);
        flex-shrink: 0;
    }

    .marker-filter {
        display: flex;
        gap: 4px;
        margin-top: 8px;
    }

    .marker-filter-btn {
        padding: 2px 10px;
        border: 1px solid var(--border-primary);
        border-radius: 10px;
        background: var(--bg-primary);
        color: var(--text-tertiary);
        font-size: 11px;
        cursor: pointer;
        transition: all 0.15s;
    }

    .marker-filter-btn:hover {
        border-color: var(--accent);
        color: var(--accent-text);
    }

    .marker-filter-btn.active {
        background: var(--accent);
        border-color: var(--accent);
        color: var(--bg-primary);
    }

    .tag-filter {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        margin-top: 8px;
    }

    .tag-filter-btn {
        padding: 2px 10px;
        border: 1px solid var(--border-primary);
        border-radius: 10px;
        background: var(--bg-primary);
        color: var(--text-tertiary);
        font-size: 11px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.15s ease;
    }

    .tag-filter-btn:hover {
        border-color: var(--accent);
        color: var(--accent-text);
    }

    .tag-filter-btn.active {
        background: var(--accent);
        border-color: var(--accent);
        color: var(--bg-primary);
    }

    .pet-list-items {
        flex: 1;
        overflow-y: auto;
        padding: 8px 12px;
        display: flex;
        flex-direction: column;
        gap: 6px;
    }

    .pet-card-wrapper {
        position: relative;
        display: flex;
        align-items: center;
        gap: 6px;
    }

    .pet-card-wrapper[draggable='true'] {
        cursor: grab;
    }

    .pet-card-wrapper.dragging {
        opacity: 0.4;
    }

    .pet-card-wrapper.drag-over {
        border-top: 2px solid var(--accent);
    }

    .pet-card-wrapper.kb-grabbed {
        outline: 2px solid var(--accent);
        outline-offset: 1px;
        border-radius: 8px;
    }

    .reorder-handle {
        flex: 0 0 auto;
        width: 18px;
        height: 32px;
        padding: 0;
        border: none;
        background: none;
        color: var(--text-tertiary);
        cursor: grab;
        font-size: 14px;
        line-height: 1;
        opacity: 0;
        border-radius: 4px;
    }

    .pet-card-wrapper:hover .reorder-handle,
    .pet-card-wrapper:focus-within .reorder-handle,
    .reorder-handle:focus-visible {
        opacity: 1;
    }

    .reorder-handle:focus-visible {
        outline: 2px solid var(--accent);
        color: var(--text-primary);
    }

    .reorder-handle[aria-grabbed='true'] {
        cursor: grabbing;
        color: var(--accent);
        opacity: 1;
    }

    .drop-zone-end {
        min-height: 32px;
        flex: 1;
    }

    .drop-zone-end.drag-over {
        border-top: 2px solid var(--accent);
    }

    .pet-card-actions {
        position: absolute;
        right: 8px;
        top: 50%;
        transform: translateY(-50%);
        display: none;
        gap: 2px;
    }

    .pet-card-wrapper:hover .pet-card-actions,
    .pet-card-wrapper:focus-within .pet-card-actions {
        display: flex;
    }

    .action-btn {
        width: 24px;
        height: 24px;
        border: none;
        border-radius: 4px;
        background: transparent;
        cursor: pointer;
        font-size: 12px;
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--text-tertiary);
        transition: all 0.15s;
    }

    .edit-btn:hover {
        background: var(--bg-selected);
        color: var(--accent-text);
    }

    .delete-btn:hover {
        background: var(--error-bg);
        color: var(--error);
    }

    .pet-list-footer {
        padding: 12px;
        border-top: 1px solid var(--border-primary);
        display: flex;
        align-items: center;
        gap: 12px;
        flex-shrink: 0;
    }

    .upload-btn {
        flex: 1;
        padding: 8px 12px;
        background: var(--accent);
        color: white;
        border: none;
        border-radius: 6px;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        transition: background 0.15s;
    }

    .upload-btn:hover {
        background: var(--accent-hover);
    }

    .upload-btn:disabled {
        background: var(--text-muted);
        cursor: not-allowed;
    }

    .pet-count {
        font-size: 11px;
        color: var(--text-muted);
        white-space: nowrap;
    }

    .compare-checkbox {
        width: 16px;
        height: 16px;
        cursor: pointer;
        accent-color: var(--accent);
        flex-shrink: 0;
    }

    .compare-checkbox:disabled {
        opacity: 0.3;
        cursor: not-allowed;
    }

    .auto-scan-btn {
        position: relative;
        padding: 8px 10px;
        background: var(--bg-secondary);
        border: 1px solid var(--border-primary);
        border-radius: 6px;
        font-size: 13px;
        cursor: pointer;
        transition: all 0.15s ease;
        flex-shrink: 0;
    }

    .pending-badge {
        position: absolute;
        top: -6px;
        right: -6px;
        min-width: 16px;
        height: 16px;
        padding: 0 4px;
        box-sizing: border-box;
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--accent);
        color: var(--bg-primary);
        border-radius: 8px;
        font-size: 10px;
        font-weight: 700;
        line-height: 1;
        pointer-events: none;
    }

    .auto-scan-btn:hover:not(:disabled) {
        background: var(--bg-selected);
        border-color: var(--accent);
    }

    .auto-scan-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }

    .compare-mode-btn {
        padding: 8px 10px;
        background: var(--bg-secondary);
        border: 1px solid var(--border-primary);
        border-radius: 6px;
        font-size: 13px;
        cursor: pointer;
        transition: all 0.15s ease;
        flex-shrink: 0;
    }

    .compare-mode-btn:hover:not(:disabled) {
        background: var(--bg-selected);
        border-color: var(--accent);
    }

    .compare-mode-btn:disabled {
        opacity: 0.3;
        cursor: not-allowed;
    }

    .cancel-compare-btn {
        padding: 8px 12px;
        background: var(--bg-secondary);
        border: 1px solid var(--border-primary);
        border-radius: 6px;
        font-size: 12px;
        font-weight: 500;
        cursor: pointer;
        color: var(--text-secondary);
        transition: all 0.15s ease;
    }

    .cancel-compare-btn:hover {
        background: var(--bg-tertiary);
    }

    .compare-now-btn {
        flex: 1;
        padding: 8px 12px;
        background: var(--accent);
        color: white;
        border: none;
        border-radius: 6px;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        transition: background 0.15s;
    }

    .compare-now-btn:hover:not(:disabled) {
        background: var(--accent-hover);
    }

    .compare-now-btn:disabled {
        background: var(--text-muted);
        cursor: not-allowed;
    }
</style>
