<script>
    import { Table } from "@flowbite-svelte-plugins/datatable";
    import { pets, appState } from "$lib/stores/pets.js";
    import { FALLBACK_ATTRIBUTE_LIST } from "$lib/utils/apiUtils.js";
    import PetEditor from "$lib/components/pet/PetEditor.svelte";
    import VisualizationHeader from "$lib/components/layout/VisualizationHeader.svelte";

    let showEditor = $state(false);
    let editingPet = $state(null);

    function formatDate(dateString) {
        if (!dateString) return "Unknown";
        try {
            return new Date(dateString).toLocaleDateString();
        } catch {
            return "Invalid date";
        }
    }

    async function selectPet(pet) {
        await appState.selectPet(pet);
    }

    async function deletePet(pet, event) {
        event?.stopPropagation();
        if (confirm(`Are you sure you want to delete ${pet.name}?`)) {
            await appState.deletePet(pet.id);
        }
    }

    function editPet(pet) {
        editingPet = pet;
        showEditor = true;
    }

    function closeEditor() {
        showEditor = false;
        editingPet = null;
    }

    function handlePetSaved() {
        // Optionally select the updated pet or do other actions
    }

    function assemblePetsData(petsArray) {
        // Build dynamic headings from attribute list
        const baseHeadings = ["Pet Name", "Species", "Gender", "Breed"];
        const attributeHeadings = FALLBACK_ATTRIBUTE_LIST.map(
            (attr) => attr.name,
        );
        const endHeadings = ["Created Date", "Actions"];
        const headings = [
            ...baseHeadings,
            ...attributeHeadings,
            ...endHeadings,
        ];

        if (!petsArray || petsArray.length === 0) {
            return { headings, data: [] };
        }

        const data = petsArray.map((pet) => {
            const baseData = [
                pet.name || "Unnamed",
                pet.species || "Unknown",
                pet.gender || "Male",
                pet.breed || "Mixed",
            ];

            // Add actual attribute values from pet data
            const attributeData = FALLBACK_ATTRIBUTE_LIST.map((attr) => {
                const attrKey = attr.key.toLowerCase();
                // Access attributes directly from pet object (they're stored as direct properties)
                const value = pet[attrKey] ?? 50;
                return value;
            });

            // Generate action buttons based on pet type
            let actionButtons;
            if (pet.is_demo || pet.readonly) {
                // Demo pets - only show view button and demo indicator
                actionButtons = `<div class="table-actions">
                    <span class="demo-badge" title="Sample pet for demonstration">📘 Sample</span>
                    <button class="flowbite-btn flowbite-btn-sm flowbite-btn-light" data-action="view" data-pet-id="${pet.id}" title="View sample pet details">
                        <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/>
                        </svg>
                    </button>
                </div>`;
            } else {
                // Regular pets - show all buttons
                actionButtons = `<div class="table-actions">
                    <button class="flowbite-btn flowbite-btn-sm flowbite-btn-light" data-action="view" data-pet-id="${pet.id}" title="View pet details">
                        <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/>
                        </svg>
                    </button>
                    <button class="flowbite-btn flowbite-btn-sm flowbite-btn-primary" data-action="edit" data-pet-id="${pet.id}" title="Edit pet">
                        <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/>
                        </svg>
                    </button>
                    <button class="flowbite-btn flowbite-btn-sm flowbite-btn-danger" data-action="delete" data-pet-id="${pet.id}" title="Delete pet">
                        <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
                        </svg>
                    </button>
                </div>`;
            }

            const endData = [formatDate(pet.created_at), actionButtons];

            return [...baseData, ...attributeData, ...endData];
        });

        return { headings, data };
    }

    const items = $derived(assemblePetsData($pets));

    // Handle table button clicks
    function handleTableClick(event) {
        const button = event.target.closest("button[data-action]");
        if (!button) return;

        const action = button.dataset.action;
        const petId = parseInt(button.dataset.petId);
        const pet = $pets.find((p) => p.id === petId);

        if (!pet) return;

        switch (action) {
            case "view":
                selectPet(pet);
                break;
            case "edit":
                editPet(pet);
                break;
            case "delete":
                deletePet(pet);
                break;
        }
    }
</script>

<div class="pet-visualization">
    <VisualizationHeader
        title="🐾 Pet Manager"
        stats={[{ text: `${$pets.length} pets total` }]}
        hasUnknownGenes={$pets.some((pet) => pet.has_unknown_genes)}
    />

    <div class="gene-visualizer-container" onclick={handleTableClick} onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleTableClick(e); }} role="button" tabindex="0">
        {#if $pets && $pets.length > 0}
            <Table
                dataTableOptions={{
                    data: items,
                    searchable: true,
                    sortable: true,
                    paging: true,
                    perPage: 10,
                    perPageSelect: [5, 10, 25, ["All", -1]],
                    fixedHeight: false,
                }}
            />
        {:else}
            <div class="empty-state">
                <div class="empty-icon">🐾</div>
                <h3>No pets found</h3>
                <p>
                    Upload some pet data to get started with genetic analysis.
                </p>
            </div>
        {/if}
    </div>
</div>

<!-- Pet Editor Modal -->
{#if editingPet}
    <PetEditor
        pet={editingPet}
        bind:open={showEditor}
        onClose={closeEditor}
        onSave={handlePetSaved}
    />
{/if}

<style>
    .gene-visualizer-container {
        flex: 1;
        width: 100%;
        min-height: 0;
        position: relative;
        contain: layout style;
        padding: 1rem;
        overflow-x: auto;
    }

    .empty-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        flex: 1;
        min-height: 200px;
        color: #6b7280;
        text-align: center;
    }

    .empty-icon {
        font-size: 4rem;
        margin-bottom: 1rem;
        opacity: 0.5;
    }

    .empty-state h3 {
        font-size: 1.5rem;
        margin-bottom: 0.5rem;
        color: #374151;
    }

    .empty-state p {
        font-size: 1rem;
        margin: 0;
    }

    /* Basic table styling */
    :global(.gene-visualizer-container table) {
        width: 100%;
        border-collapse: collapse;
        background: white;
        border-radius: 8px;
        overflow: hidden;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    }

    :global(.gene-visualizer-container thead th) {
        background: #f9fafb;
        color: #374151;
        font-weight: 500;
        font-size: 0.875rem;
        padding: 0.5rem 0.75rem;
        border-bottom: 1px solid #e5e7eb;
        text-align: left;
    }

    :global(.gene-visualizer-container thead th:hover) {
        background: #f3f4f6;
    }

    /* Remove extra padding from datatable plugin buttons */
    :global(.gene-visualizer-container thead th button) {
        padding: 0 !important;
        margin: 0 !important;
        background: none !important;
        border: none !important;
        font: inherit !important;
        color: inherit !important;
        text-align: inherit !important;
        cursor: pointer !important;
        outline: none !important;
        width: 100% !important;
        height: auto !important;
    }

    :global(.gene-visualizer-container tbody td) {
        padding: 0.625rem 0.75rem;
        border-bottom: 1px solid #f3f4f6;
        font-size: 0.875rem;
        color: #111827;
    }

    :global(.gene-visualizer-container tbody tr:hover) {
        background-color: #f8fafc;
    }

    /* Search and controls styling */
    :global(.gene-visualizer-container input) {
        border: 2px solid #e5e7eb;
        border-radius: 8px;
        padding: 0.75rem 1rem;
        font-size: 0.875rem;
        background: #f9fafb;
        transition: all 0.2s ease;
    }

    :global(.gene-visualizer-container input:focus) {
        border-color: #3b82f6;
        background: white;
        box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
        outline: none;
    }

    :global(.gene-visualizer-container select) {
        background: white;
        border: 1px solid #d1d5db;
        border-radius: 6px;
        padding: 0.5rem;
        color: #374151;
        font-size: 0.875rem;
    }

    :global(.gene-visualizer-container button) {
        background: white;
        border: 1px solid #d1d5db;
        color: #374151;
        padding: 0.5rem 1rem;
        margin: 0 0.25rem;
        border-radius: 6px;
        font-size: 0.875rem;
        cursor: pointer;
        transition: all 0.2s ease;
    }

    :global(.gene-visualizer-container button:hover) {
        background: #f3f4f6;
        border-color: #9ca3af;
    }

    :global(.gene-visualizer-container button.active) {
        background: #3b82f6;
        border-color: #3b82f6;
        color: white;
    }

    /* Action buttons styles */
    :global(.table-actions) {
        display: flex;
        gap: 0.25rem;
        align-items: center;
        justify-content: center;
        flex-wrap: wrap;
    }

    /* Demo badge styles */
    :global(.demo-badge) {
        background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%);
        color: white;
        font-size: 0.6rem;
        font-weight: 600;
        padding: 0.125rem 0.375rem;
        border-radius: 12px;
        letter-spacing: 0.025em;
        text-transform: uppercase;
        box-shadow: 0 1px 3px rgba(59, 130, 246, 0.3);
        white-space: nowrap;
        border: none;
        cursor: default;
        display: inline-flex;
        align-items: center;
        gap: 0.125rem;
    }

    :global(.action-btn) {
        padding: 0.25rem 0.5rem;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 0.75rem;
        transition: all 0.2s ease;
        background-color: transparent;
        min-width: 24px;
        height: 24px;
        display: flex;
        align-items: center;
        justify-content: center;
    }

    :global(.action-btn:hover) {
        background-color: #f3f4f6;
        transform: scale(1.1);
    }

    :global(.view-btn:hover) {
        background-color: #eff6ff;
    }

    :global(.edit-btn:hover) {
        background-color: #f0fdf4;
    }

    :global(.save-btn:hover) {
        background-color: #f0f9ff;
    }

    :global(.cancel-btn:hover) {
        background-color: #fef2f2;
    }

    :global(.delete-btn:hover) {
        background-color: #fef2f2;
    }

    /* Flowbite-style button base */
    :global(.flowbite-btn) {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-weight: 500;
        border-radius: 0.5rem;
        border: 1px solid transparent;
        cursor: pointer;
        transition: all 0.15s ease-in-out;
        text-decoration: none;
        outline: none;
    }

    :global(.flowbite-btn-sm) {
        padding: 0.375rem 0.75rem;
        font-size: 0.75rem;
        line-height: 1rem;
    }

    /* Light variant */
    :global(.flowbite-btn-light) {
        color: #374151;
        background-color: #f9fafb;
        border-color: #d1d5db;
    }

    :global(.flowbite-btn-light:hover) {
        background-color: #f3f4f6;
        border-color: #9ca3af;
    }

    /* Primary variant */
    :global(.flowbite-btn-primary) {
        color: white;
        background-color: #3b82f6;
        border-color: #3b82f6;
    }

    :global(.flowbite-btn-primary:hover) {
        background-color: #2563eb;
        border-color: #2563eb;
    }

    /* Danger variant */
    :global(.flowbite-btn-danger) {
        color: white;
        background-color: #ef4444;
        border-color: #ef4444;
    }

    :global(.flowbite-btn-danger:hover) {
        background-color: #dc2626;
        border-color: #dc2626;
    }

    /* Edit input styles within table */
    :global(.edit-input) {
        font-size: 0.875rem;
        border: 1px solid #3b82f6 !important;
        border-radius: 4px !important;
        padding: 2px 4px !important;
        background: white !important;
        outline: none !important;
        width: 100% !important;
    }

    :global(.edit-input:focus) {
        box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.2) !important;
    }
</style>
