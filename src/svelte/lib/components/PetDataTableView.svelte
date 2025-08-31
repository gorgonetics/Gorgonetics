<script>
    import { Table } from "@flowbite-svelte-plugins/datatable";
    import { pets, appState } from "../stores/appState.js";
    import { X } from "@lucide/svelte";

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

    function closePetTableView() {
        appState.hidePetTableView();
    }
</script>

<div class="pet-datatable-view">
    <div class="table-header">
        <div class="header-content">
            <h2 class="table-title">🐾 Pet Management Table</h2>
            <p class="table-subtitle">Search, sort, and manage all your pets</p>
        </div>
        <button 
            class="close-btn"
            onclick={closePetTableView}
            title="Close table view"
        >
            <X size={20} />
        </button>
    </div>
    
    <div class="table-container">
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
    .pet-datatable-view {
        flex: 1;
        padding: 2rem;
        background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
        display: flex;
        flex-direction: column;
        min-height: 100vh;
    }

    .table-header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        margin-bottom: 2rem;
        gap: 1.5rem;
        padding: 1.5rem 2rem;
        background: white;
        border-radius: 12px;
        box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05);
    }

    .header-content {
        flex: 1;
    }

    .table-title {
        font-size: 2.5rem;
        font-weight: 800;
        background: linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
        margin: 0 0 0.5rem 0;
        line-height: 1.2;
    }

    .table-subtitle {
        font-size: 1.125rem;
        color: #6b7280;
        margin: 0;
        font-weight: 500;
    }

    .close-btn {
        padding: 0.75rem;
        background: #f3f4f6;
        border: 1px solid #d1d5db;
        border-radius: 8px;
        color: #6b7280;
        cursor: pointer;
        transition: all 0.2s ease;
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .close-btn:hover {
        background: #e5e7eb;
        color: #374151;
        transform: translateY(-1px);
    }

    .table-container {
        flex: 1;
        background: white;
        border-radius: 12px;
        box-shadow: 0 8px 25px rgba(0, 0, 0, 0.1);
        overflow: hidden;
        min-height: 500px;
        padding: 1.5rem;
    }

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
    :global(.table-container table) {
        width: 100%;
        border-collapse: collapse;
    }

    :global(.table-container thead th) {
        background: #f9fafb;
        color: #374151;
        font-weight: 500;
        font-size: 0.875rem;
        padding: 0.75rem 1rem;
        border-bottom: 1px solid #e5e7eb;
        text-align: left;
    }

    :global(.table-container thead th:hover) {
        background: #f3f4f6;
    }

    :global(.table-container tbody td) {
        padding: 1rem;
        border-bottom: 1px solid #f3f4f6;
        font-size: 0.875rem;
        color: #111827;
    }

    :global(.table-container tbody tr:hover) {
        background-color: #f8fafc;
    }

    /* Search and controls */
    :global(.table-container input) {
        border: 2px solid #e5e7eb;
        border-radius: 8px;
        padding: 0.75rem 1rem;
        font-size: 0.875rem;
        background: #f9fafb;
        transition: all 0.2s ease;
    }

    :global(.table-container input:focus) {
        border-color: #3b82f6;
        background: white;
        box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
        outline: none;
    }

    :global(.table-container select) {
        background: white;
        border: 1px solid #d1d5db;
        border-radius: 6px;
        padding: 0.5rem;
        color: #374151;
        font-size: 0.875rem;
    }

    :global(.table-container button) {
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

    :global(.table-container button:hover) {
        background: #f3f4f6;
        border-color: #9ca3af;
    }

    :global(.table-container button.active) {
        background: #3b82f6;
        border-color: #3b82f6;
        color: white;
    }

    @media (max-width: 768px) {
        .pet-datatable-view {
            padding: 1rem;
        }

        .table-header {
            padding: 1rem;
            margin-bottom: 1rem;
            flex-direction: column;
            gap: 1rem;
        }

        .table-title {
            font-size: 1.875rem;
        }

        .table-container {
            padding: 1rem;
        }
    }
</style>