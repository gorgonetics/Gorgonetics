<script>
    import {
        pets,
        selectedPet,
        loading,
        appState,
    } from "../stores/appState.js";
    import { Trash2, Eye, Edit } from "@lucide/svelte";

    let editingPet = $state(null);
    let editName = $state("");

    function selectPet(pet) {
        appState.selectPet(pet);
    }

    async function deletePet(pet, event) {
        event.stopPropagation();

        if (confirm(`Are you sure you want to delete ${pet.name}?`)) {
            await appState.deletePet(pet.id);
        }
    }

    function startEdit(pet, event) {
        event.stopPropagation();
        editingPet = pet.id;
        editName = pet.name;
    }

    function cancelEdit() {
        editingPet = null;
        editName = "";
    }

    async function saveEdit(pet, event) {
        event.stopPropagation();

        if (editName.trim() && editName !== pet.name) {
            try {
                await appState.updatePet(pet.id, { name: editName.trim() });
                await appState.loadPets(); // Refresh the list
            } catch (err) {
                console.error("Failed to update pet name:", err);
            }
        }

        editingPet = null;
        editName = "";
    }

    function handleKeydown(event, pet) {
        if (event.key === "Enter") {
            saveEdit(pet, event);
        } else if (event.key === "Escape") {
            cancelEdit();
        }
    }

    function formatKnownGenes(knownCount, hasUnknown) {
        const genesText = `${knownCount || 0} known`;
        return hasUnknown ? `⚠️ ${genesText}` : `🧬 ${genesText}`;
    }

    function formatDate(dateString) {
        if (!dateString) return "Unknown";
        try {
            return new Date(dateString).toLocaleDateString();
        } catch {
            return "Invalid date";
        }
    }
</script>

<div class="form-group">
    <label>My Pets</label>
    <div class="pets-list">
        {#if $loading}
            <div class="loading">Loading pets...</div>
        {:else if $pets.length === 0}
            <div class="empty-state">
                <span class="empty-icon">🐾</span>
                <p>No pets added yet</p>
                <p class="empty-hint">Upload a genome file to get started</p>
            </div>
        {:else}
            {#each $pets as pet (pet.id)}
                <div
                    class="pet-card"
                    class:selected={$selectedPet && $selectedPet.id === pet.id}
                    onclick={() => selectPet(pet)}
                    role="button"
                >
                    <div class="pet-main">
                        <div class="pet-name-row">
                            {#if editingPet === pet.id}
                                <input
                                    type="text"
                                    bind:value={editName}
                                    onkeydown={(e) => handleKeydown(e, pet)}
                                    onblur={(e) => saveEdit(pet, e)}
                                    class="edit-input"
                                    onclick={(e) => e.stopPropagation()}
                                    autofocus
                                />
                            {:else}
                                <h4 class="pet-name">{pet.name}</h4>
                            {/if}

                            <div class="pet-actions">
                                <button
                                    class="action-btn view-btn"
                                    onclick={(e) => {
                                        e.stopPropagation();
                                        selectPet(pet);
                                    }}
                                    title="View pet details"
                                    aria-label="View {pet.name} details"
                                >
                                    <Eye size={12} />
                                </button>

                                <button
                                    class="action-btn edit-btn"
                                    onclick={(e) => startEdit(pet, e)}
                                    title="Edit pet name"
                                    aria-label="Edit {pet.name}"
                                >
                                    <Edit size={12} />
                                </button>

                                <button
                                    class="action-btn delete-btn"
                                    onclick={(e) => deletePet(pet, e)}
                                    title="Delete pet"
                                    aria-label="Delete {pet.name}"
                                >
                                    <Trash2 size={12} />
                                </button>
                            </div>
                        </div>

                        <div class="pet-species-row">
                            <span class="pet-type"
                                >{pet.species || "Unknown"}</span
                            >
                        </div>

                        <div class="pet-meta">
                            {formatKnownGenes(
                                pet.known_genes,
                                pet.has_unknown_genes,
                            )} • 📅 {formatDate(pet.created_at)}
                        </div>

                        {#if pet.description}
                            <p class="pet-description">{pet.description}</p>
                        {/if}
                    </div>
                </div>
            {/each}
        {/if}
    </div>
</div>

<style>
    .form-group {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
    }

    .form-group label {
        font-size: 0.875rem;
        font-weight: 500;
        color: #374151;
    }

    .pets-list {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        max-height: 400px;
        overflow-y: auto;
    }

    .loading {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 2rem;
        color: #6b7280;
        font-style: italic;
    }

    .empty-state {
        text-align: center;
        padding: 2rem;
        color: #6b7280;
    }

    .empty-icon {
        font-size: 2rem;
        display: block;
        margin-bottom: 0.5rem;
        opacity: 0.5;
    }

    .empty-state p {
        margin: 0.25rem 0;
        font-size: 0.875rem;
    }

    .empty-hint {
        font-size: 0.75rem !important;
        opacity: 0.8;
    }

    .pet-card {
        border: 1px solid #e5e7eb;
        border-radius: 8px;
        background: white;
        cursor: pointer;
        transition: all 0.2s ease;
        overflow: hidden;
    }

    .pet-card:hover:not(.selected) {
        border-color: #d1d5db;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
    }

    .pet-card.selected {
        border-color: #3b82f6;
        background-color: #eff6ff;
    }

    .pet-card.selected:hover {
        border-color: #2563eb;
        background-color: #dbeafe;
    }

    .pet-main {
        padding: 0.75rem;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
    }

    .pet-name-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.5rem;
    }

    .pet-species-row {
        margin-top: 0.25rem;
    }

    .pet-name {
        font-size: 0.875rem;
        font-weight: 600;
        color: #111827;
        margin: 0;
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .pet-type {
        font-size: 0.75rem;
        color: #6b7280;
        background-color: #f3f4f6;
        padding: 0.125rem 0.375rem;
        border-radius: 4px;
        flex-shrink: 0;
    }

    .pet-meta {
        font-size: 0.6875rem;
        color: #6b7280;
        line-height: 1.2;
    }

    .pet-description {
        font-size: 0.75rem;
        color: #6b7280;
        margin: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .pet-actions {
        display: flex;
        gap: 0.125rem;
        flex-shrink: 0;
    }

    .action-btn {
        padding: 0.25rem;
        border: none;
        border-radius: 3px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s ease;
        background-color: transparent;
    }

    .action-btn:hover {
        background-color: #f3f4f6;
    }

    .view-btn {
        color: #3b82f6;
    }

    .view-btn:hover {
        background-color: #eff6ff;
    }

    .edit-btn {
        color: #059669;
    }

    .edit-btn:hover {
        background-color: #f0fdf4;
    }

    .delete-btn {
        color: #dc2626;
    }

    .delete-btn:hover {
        background-color: #fef2f2;
    }

    .edit-input {
        font-size: 0.875rem;
        font-weight: 600;
        color: #111827;
        border: 1px solid #3b82f6;
        border-radius: 4px;
        padding: 0.125rem 0.25rem;
        background: white;
        outline: none;
        min-width: 0;
        flex: 1;
    }

    .edit-input:focus {
        box-shadow: 0 0 0 1px #3b82f6;
    }
</style>
