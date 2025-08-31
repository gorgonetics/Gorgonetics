<script>
    import { Table } from "@flowbite-svelte-plugins/datatable";
    import { pets } from "../stores/appState.js";

    function formatDate(dateString) {
        if (!dateString) return "Unknown";
        try {
            return new Date(dateString).toLocaleDateString();
        } catch {
            return "Invalid date";
        }
    }

    function assemblePetsData(petsArray) {
        if (!petsArray || petsArray.length === 0) {
            return {
                headings: ["Pet Name", "Species", "Genes", "Created Date"],
                data: []
            };
        }

        return {
            headings: ["Pet Name", "Species", "Genes", "Created Date"],
            data: petsArray.map(pet => [
                pet.name || "Unnamed",
                pet.species || "Unknown",
                `${pet.known_genes || 0} known ${pet.has_unknown_genes ? "⚠️" : "🧬"}`,
                formatDate(pet.created_at)
            ])
        };
    }

    const items = $derived(assemblePetsData($pets));
</script>

<div class="pet-visualization">
    <div class="visualization-header">
        <h3 class="visualization-title">
            🐾 Pet Manager
        </h3>
        <div class="visualization-stats">
            <span class="stat-item">{$pets.length} pets total</span>
            {#if $pets.some(pet => pet.has_unknown_genes)}
                <span class="unknown-indicator">⚠️ Some pets have unknown genes</span>
            {/if}
        </div>
    </div>
    
    <div class="gene-visualizer-container">
        {#if $pets && $pets.length > 0}
            <Table 
                dataTableOptions={{
                    data: items,
                    searchable: true,
                    sortable: true,
                    paging: true,
                    perPage: 10,
                    perPageSelect: [5, 10, 25, ["All", -1]],
                    fixedHeight: false
                }}
            />
        {:else}
            <div class="empty-state">
                <div class="empty-icon">🐾</div>
                <h3>No pets found</h3>
                <p>Upload some pet data to get started with genetic analysis.</p>
            </div>
        {/if}
    </div>
</div>

<style>
    .empty-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        height: 400px;
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
</style>