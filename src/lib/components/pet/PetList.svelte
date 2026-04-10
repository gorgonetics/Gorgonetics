<script>
import { pickGenomeFiles, readFileContent } from '$lib/services/fileService.js';
import { allTags as allTagsStore, appState, error, pets, selectedPet } from '$lib/stores/pets.js';
import { createDragState } from '$lib/utils/dragReorder.svelte.js';
import { getBasename } from '$lib/utils/path.js';
import PetCard from './PetCard.svelte';
import PetEditor from './PetEditor.svelte';

let searchQuery = $state('');
let selectedTags = $state([]);
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

    <div class="pet-list-items">
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
                    <PetCard
                        {pet}
                        selected={$selectedPet?.id === pet.id}
                        onclick={selectPet}
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
        {:else if searchQuery || selectedTags.length > 0}
            <div class="empty-state">No pets match the current filters</div>
        {:else}
            <div class="empty-state">No pets yet. Upload a genome file to get started.</div>
        {/if}
    </div>

    <div class="pet-list-footer">
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
    <div class="confirm-dialog" role="alertdialog" aria-label="Confirm delete">
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
        background: #ffffff;
        border-radius: 12px;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.15);
        padding: 24px;
        width: 340px;
        max-width: 90vw;
        text-align: center;
    }

    .confirm-message {
        font-size: 15px;
        color: #111827;
        margin: 0 0 4px 0;
    }

    .confirm-subtext {
        font-size: 12px;
        color: #9ca3af;
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
        border-bottom: 1px solid #e5e7eb;
        flex-shrink: 0;
    }

    .search-input {
        width: 100%;
        padding: 8px 12px;
        border: 1px solid #e5e7eb;
        border-radius: 6px;
        font-size: 13px;
        background: #f9fafb;
        color: #111827;
        outline: none;
        transition: border-color 0.15s;
    }

    .search-input:focus {
        border-color: #3b82f6;
        background: #ffffff;
    }

    .search-input::placeholder {
        color: #9ca3af;
    }

    .tag-filter {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        margin-top: 8px;
    }

    .tag-filter-btn {
        padding: 2px 10px;
        border: 1px solid #e5e7eb;
        border-radius: 10px;
        background: #ffffff;
        color: #6b7280;
        font-size: 11px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.15s ease;
    }

    .tag-filter-btn:hover {
        border-color: #93c5fd;
        color: #3b82f6;
    }

    .tag-filter-btn.active {
        background: #3b82f6;
        border-color: #3b82f6;
        color: #ffffff;
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
    }

    .pet-card-wrapper[draggable='true'] {
        cursor: grab;
    }

    .pet-card-wrapper.dragging {
        opacity: 0.4;
    }

    .pet-card-wrapper.drag-over {
        border-top: 2px solid #3b82f6;
    }

    .drop-zone-end {
        min-height: 32px;
        flex: 1;
    }

    .drop-zone-end.drag-over {
        border-top: 2px solid #3b82f6;
    }

    .pet-card-actions {
        position: absolute;
        right: 8px;
        top: 50%;
        transform: translateY(-50%);
        display: none;
        gap: 2px;
    }

    .pet-card-wrapper:hover .pet-card-actions {
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
        color: #6b7280;
        transition: all 0.15s;
    }

    .edit-btn:hover {
        background: #eff6ff;
        color: #3b82f6;
    }

    .delete-btn:hover {
        background: #fef2f2;
        color: #ef4444;
    }

    .empty-state {
        padding: 24px 12px;
        text-align: center;
        color: #9ca3af;
        font-size: 13px;
    }

    .pet-list-footer {
        padding: 12px;
        border-top: 1px solid #e5e7eb;
        display: flex;
        align-items: center;
        gap: 12px;
        flex-shrink: 0;
    }

    .upload-btn {
        flex: 1;
        padding: 8px 12px;
        background: #3b82f6;
        color: white;
        border: none;
        border-radius: 6px;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        transition: background 0.15s;
    }

    .upload-btn:hover {
        background: #2563eb;
    }

    .upload-btn:disabled {
        background: #9ca3af;
        cursor: not-allowed;
    }

    .pet-count {
        font-size: 11px;
        color: #9ca3af;
        white-space: nowrap;
    }
</style>
