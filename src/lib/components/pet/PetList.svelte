<script>
import { normalizeSpecies } from '$lib/services/configService.js';
import { pickGenomeFiles, readFileContent } from '$lib/services/fileService.js';
import { compareSelectMode, comparisonActions, comparisonPets, comparisonReady } from '$lib/stores/comparison.js';
import { allTags as allTagsStore, appState, error, pets, selectedPet } from '$lib/stores/pets.js';
import { createDragState } from '$lib/utils/dragReorder.svelte.js';
import { focusTrap } from '$lib/utils/focusTrap.js';
import { getBasename } from '$lib/utils/path.js';
import PetCard from './PetCard.svelte';
import PetEditor from './PetEditor.svelte';

function isSelectedForComparison(petId) {
  return $comparisonPets[0]?.id === petId || $comparisonPets[1]?.id === petId;
}

function toggleComparisonPet(pet) {
  if (isSelectedForComparison(pet.id)) {
    comparisonActions.removePet(pet.id);
  } else {
    comparisonActions.addPet(pet);
  }
}

function isCompareDisabled(pet) {
  if (isSelectedForComparison(pet.id)) return false;
  if ($comparisonReady) return true;
  // Disable different species when first pet is selected
  const first = $comparisonPets[0];
  if (first && normalizeSpecies(first.species) !== normalizeSpecies(pet.species)) return true;
  return false;
}

function startCompare() {
  comparisonActions.toggleSelectMode();
  appState.switchTab('compare');
}

let searchQuery = $state('');
let selectedTags = $state([]);
let starredOnly = $state(false);
let stabledOnly = $state(true);
let uploading = $state(false);
let uploadProgress = $state(null);
let showEditor = $state(false);
let editingPet = $state(null);
let deletingPet = $state(null);

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

const filteredPets = $derived.by(() => {
  const q = searchQuery ? searchQuery.toLowerCase() : '';
  return $pets.filter((pet) => {
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

function toggleTagFilter(tag) {
  if (selectedTags.includes(tag)) {
    selectedTags = selectedTags.filter((t) => t !== tag);
  } else {
    selectedTags = [...selectedTags, tag];
  }
}

function selectPet(pet) {
  appState.selectPet(pet);
}

// appState.updatePet already reloads the pets store — no explicit loadPets needed.
async function toggleMarker(petId, key, value) {
  await appState.updatePet(petId, { [key]: value });
}

async function handleUpload() {
  try {
    const filePaths = await pickGenomeFiles();
    if (filePaths.length === 0) return;

    uploading = true;
    error.set(null);
    const total = filePaths.length;
    const failures = [];

    // Sequential upload — consider parallel with concurrency limit if this becomes a bottleneck
    for (let i = 0; i < filePaths.length; i++) {
      uploadProgress = { current: i + 1, total };
      const fileName = getBasename(filePaths[i]);
      try {
        const content = await readFileContent(filePaths[i]);
        const result = await appState.uploadPetQuiet(content, '', 'Male');
        if (result.status === 'error') {
          failures.push(`${fileName}: ${result.message}`);
        }
      } catch (err) {
        failures.push(`${fileName}: ${err.message}`);
      }
    }

    await appState.loadPets();

    if (failures.length > 0) {
      const succeeded = total - failures.length;
      error.set(`${succeeded}/${total} uploaded. ${failures.length} failed: ${failures.join('; ')}`);
    }
  } catch (err) {
    error.set(`Upload failed: ${err.message}`);
  } finally {
    uploading = false;
    uploadProgress = null;
  }
}

function closeEditor() {
  showEditor = false;
  editingPet = null;
}

function handleDelete(pet) {
  deletingPet = pet;
}

async function confirmDelete() {
  if (deletingPet) {
    await appState.deletePet(deletingPet.id);
    deletingPet = null;
  }
}

function cancelDelete() {
  deletingPet = null;
}

function handlePetCardKeydown(e, index) {
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
    const cards = document.querySelectorAll('.pet-list-items .pet-card');
    cards[nextIndex]?.focus();
  }
}

const drag = createDragState();
const isDraggable = $derived(!searchQuery && selectedTags.length === 0);

async function handleDrop(e, dropIndex) {
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
  const fromIdx = reordered.findIndex((p) => p.id === fromPet.id);
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
    const toIdx = reordered.findIndex((p) => p.id === toPet.id);
    if (toIdx < 0) {
      drag.draggedIndex = null;
      return;
    }
    reordered.splice(toIdx, 0, moved);
  }
  pets.set(reordered);
  drag.draggedIndex = null;

  try {
    await appState.reorderPets(reordered.map((p) => p.id));
  } catch {
    pets.set(previous);
  }
}
</script>

<div class="pet-list">
    <div class="pet-list-header">
        <input
            class="search-input"
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

    <div class="pet-list-items" aria-label="Pet list">
        {#if filteredPets.length > 0}
            {#each filteredPets as pet, index (pet.id)}
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <div
                    class="pet-card-wrapper"
                    class:drag-over={drag.dragOverIndex === index && drag.draggedIndex !== index}
                    class:dragging={drag.draggedIndex === index}
                    draggable={isDraggable}
                    ondragstart={(e) => drag.handleDragStart(e, index)}
                    ondragover={(e) => drag.handleDragOver(e, index)}
                    ondragleave={drag.handleDragLeave}
                    ondrop={(e) => handleDrop(e, index)}
                    ondragend={drag.handleDragEnd}
                >
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
            <div class="empty-state">No pets match the current filters</div>
        {:else}
            <div class="empty-state">No pets yet. Upload a genome file to get started.</div>
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
                disabled={uploading}
            >
                {#if uploadProgress}
                    Uploading... ({uploadProgress.current}/{uploadProgress.total})
                {:else}
                    + Upload Genome
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
        display: flex;
        flex-direction: column;
        height: 100%;
    }

    .pet-list-header {
        padding: 12px;
        border-bottom: 1px solid var(--border-primary);
        flex-shrink: 0;
    }

    .search-input {
        width: 100%;
        padding: 8px 12px;
        border: 1px solid var(--border-primary);
        border-radius: 6px;
        font-size: 13px;
        background: var(--bg-secondary);
        color: var(--text-primary);
        outline: none;
        transition: border-color 0.15s;
    }

    .search-input:focus {
        border-color: var(--accent);
        background: var(--bg-primary);
    }

    .search-input::placeholder {
        color: var(--text-muted);
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

    .empty-state {
        padding: 24px 12px;
        text-align: center;
        color: var(--text-muted);
        font-size: 13px;
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
