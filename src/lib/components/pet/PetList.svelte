<script>
    import { pets, selectedPet, appState, error } from "$lib/stores/pets.js";
    import PetCard from "./PetCard.svelte";
    import PetEditor from "./PetEditor.svelte";
    import { pickGenomeFile, readFileContent } from "$lib/services/fileService.js";

    let searchQuery = $state("");
    let uploading = $state(false);
    let showEditor = $state(false);
    let editingPet = $state(null);

    const filteredPets = $derived(
        $pets.filter((pet) => {
            if (!searchQuery) return true;
            const q = searchQuery.toLowerCase();
            return (
                (pet.name || '').toLowerCase().includes(q) ||
                (pet.species || '').toLowerCase().includes(q)
            );
        })
    );

    function selectPet(pet) {
        appState.selectPet(pet);
    }

    async function handleUpload() {
        try {
            const filePath = await pickGenomeFile();
            if (!filePath) return;

            uploading = true;
            const content = await readFileContent(filePath);
            await appState.uploadPet(content, "", "Male");
        } catch (err) {
            error.set(`Upload failed: ${err.message}`);
        } finally {
            uploading = false;
        }
    }

    function closeEditor() {
        showEditor = false;
        editingPet = null;
    }

    async function handleDelete(pet) {
        if (confirm(`Delete "${pet.name}"?`)) {
            await appState.deletePet(pet.id);
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
    </div>

    <div class="pet-list-items">
        {#if filteredPets.length > 0}
            {#each filteredPets as pet (pet.id)}
                <div class="pet-card-wrapper">
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
        {:else if searchQuery}
            <div class="empty-state">No pets match "{searchQuery}"</div>
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
            {uploading ? 'Uploading...' : '+ Upload Genome'}
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

<style>
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
