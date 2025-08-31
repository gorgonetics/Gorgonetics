<script>
    import { Table } from "@flowbite-svelte-plugins/datatable";
    import { pets, appState } from "../stores/appState.js";
    import { X } from "@lucide/svelte";

    // Simple fake data to test the plugin
    const fakeItems = [
        ["Fluffy", "Fairy Dragon", "15 known 🧬", "1/15/2024"],
        ["Shadow", "Undead Dragon", "8 known ⚠️", "1/20/2024"],
        ["Sparkle", "Fire Dragon", "12 known 🧬", "2/3/2024"],
        ["Midnight", "Ice Dragon", "6 known ⚠️", "2/10/2024"]
    ];

    function formatDate(dateString) {
        if (!dateString) return "Unknown";
        try {
            return new Date(dateString).toLocaleDateString();
        } catch {
            return "Invalid date";
        }
    }

    function assemblePetsData(petsArray) {
        const data = petsArray && petsArray.length > 0
            ? petsArray.map(pet => [
                pet.name || "Unnamed",
                pet.species || "Unknown",
                `${pet.known_genes || 0} known ${pet.has_unknown_genes ? "⚠️" : "🧬"}`,
                formatDate(pet.created_at)
            ])
            : fakeItems;

        return {
            headings: ["Pet Name", "Species", "Genes", "Created Date"],
            data: data
        };
    }

    // Transform pets data for the table
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
    </div>
</div>

<style>
    .pet-datatable-view {
        flex: 1;
        padding: 2rem;
        background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
        overflow: hidden;
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
        border: 1px solid rgba(255, 255, 255, 0.1);
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
        background: linear-gradient(135deg, #f3f4f6 0%, #e5e7eb 100%);
        border: 1px solid #d1d5db;
        border-radius: 8px;
        color: #6b7280;
        cursor: pointer;
        transition: all 0.3s ease;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
    }

    .close-btn:hover {
        background: linear-gradient(135deg, #e5e7eb 0%, #d1d5db 100%);
        color: #374151;
        transform: translateY(-1px);
        box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
    }

    .close-btn:active {
        transform: translateY(0);
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
    }

    .table-container {
        flex: 1;
        background: white;
        border-radius: 12px;
        box-shadow: 0 8px 25px rgba(0, 0, 0, 0.1);
        overflow: hidden;
        border: 1px solid rgba(255, 255, 255, 0.1);
        min-height: 500px;
    }

    /* DataTable styling - target the container and all elements inside */
    :global(.table-container) {
        font-family: inherit;
        padding: 1.5rem;
    }

    /* Style the main table */
    :global(.table-container table) {
        width: 100% !important;
        border-collapse: collapse !important;
        font-family: inherit !important;
        background: white !important;
    }

    /* Simple, clean table headers */
    :global(.table-container thead th) {
        background: #f9fafb !important;
        color: #374151 !important;
        font-weight: 500 !important;
        font-size: 0.875rem !important;
        padding: 0.75rem 1rem !important;
        border-bottom: 1px solid #e5e7eb !important;
        text-align: left !important;
        border: none !important;
        cursor: pointer !important;
        transition: background-color 0.15s ease !important;
    }

    /* Remove button styling from header buttons */
    :global(.table-container thead th button) {
        background: none !important;
        border: none !important;
        padding: 0 !important;
        margin: 0 !important;
        font: inherit !important;
        color: inherit !important;
        text-align: inherit !important;
        cursor: pointer !important;
        outline: none !important;
        box-shadow: none !important;
        border-radius: 0 !important;
        display: inline !important;
        width: auto !important;
        height: auto !important;
    }

    /* Simple hover effect */
    :global(.table-container thead th:hover) {
        background: #f3f4f6 !important;
    }

    :global(.table-container thead th button:hover) {
        background: none !important;
    }

    /* Minimal sorting indicators */
    :global(.table-container thead th[aria-sort="ascending"]::after) {
        content: " ↑" !important;
        color: #6b7280 !important;
        font-size: 0.875rem !important;
    }

    :global(.table-container thead th[aria-sort="descending"]::after) {
        content: " ↓" !important;
        color: #6b7280 !important;
        font-size: 0.875rem !important;
    }

    /* Body cell styling */
    :global(.table-container tbody td) {
        padding: 1rem 1.5rem !important;
        border-bottom: 1px solid #f3f4f6 !important;
        font-size: 0.875rem !important;
        color: #111827 !important;
        vertical-align: middle !important;
        border-top: none !important;
        border-left: none !important;
        border-right: none !important;
    }

    /* Row hover effects */
    :global(.table-container tbody tr:hover) {
        background-color: #f8fafc !important;
    }

    :global(.table-container tbody tr:hover td) {
        background-color: transparent !important;
    }

    /* Search input styling */
    :global(.table-container input) {
        border: 2px solid #e5e7eb !important;
        border-radius: 8px !important;
        padding: 0.75rem 1rem !important;
        font-size: 0.875rem !important;
        transition: all 0.2s ease !important;
        background: #f9fafb !important;
        box-shadow: none !important;
        width: 300px !important;
        max-width: 100% !important;
    }

    :global(.table-container input:focus) {
        border-color: #3b82f6 !important;
        background: white !important;
        box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1) !important;
        outline: none !important;
    }

    /* Select dropdown styling */
    :global(.table-container select) {
        background: white !important;
        border: 1px solid #d1d5db !important;
        border-radius: 6px !important;
        padding: 0.5rem !important;
        color: #374151 !important;
        font-size: 0.875rem !important;
    }

    /* General button styling for pagination etc */
    :global(.table-container button) {
        background: white !important;
        border: 1px solid #d1d5db !important;
        color: #374151 !important;
        padding: 0.5rem 1rem !important;
        margin: 0 0.25rem !important;
        border-radius: 6px !important;
        font-size: 0.875rem !important;
        cursor: pointer !important;
        transition: all 0.2s ease !important;
    }

    :global(.table-container button:hover) {
        background: #f3f4f6 !important;
        border-color: #9ca3af !important;
    }

    /* Active/current page button */
    :global(.table-container button.active) {
        background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%) !important;
        border-color: #1d4ed8 !important;
        color: white !important;
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

        .table-subtitle {
            font-size: 1rem;
        }

        :global(.dataTable-wrapper) {
            padding: 1rem;
        }

        :global(.dataTable-top) {
            flex-direction: column;
            align-items: stretch;
        }

        :global(.dataTable-table thead th),
        :global(.dataTable-table tbody td) {
            padding: 0.75rem 1rem !important;
            font-size: 0.8125rem !important;
        }

        :global(.dataTable-bottom) {
            padding: 1rem;
            margin-left: -1rem;
            margin-right: -1rem;
        }
    }
</style>