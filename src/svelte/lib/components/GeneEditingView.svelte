<script>
    import { onMount } from "svelte";
    import { apiClient } from "../services/apiClient.js";

    export let animalType;
    export let chromosome;

    let genes = [];
    let effectOptions = [];
    let geneBlocks = {};

    let loadingGenes = false;
    let successMessage = "";
    let errorMessage = "";
    let expandedNotes = {};
    let openDropdown = null;
    let originalGenes = [];
    let hasUnsavedChanges = false;
    let savingChanges = false;

    onMount(async () => {
        try {
            effectOptions = await apiClient.getEffectOptions();
            await loadGenes();
        } catch (err) {
            console.error("Failed to load gene editing data:", err);
            errorMessage = "Failed to load gene editing data";
        }
    });

    async function loadGenes() {
        if (!animalType || !chromosome) return;

        try {
            loadingGenes = true;
            errorMessage = "";
            genes = await apiClient.getGenes(animalType, chromosome);
            originalGenes = JSON.parse(JSON.stringify(genes)); // Deep copy
            geneBlocks = groupGenesByBlock(genes);
            hasUnsavedChanges = false;
        } catch (err) {
            console.error("Failed to load genes:", err);
            errorMessage = "Failed to load genes";
        } finally {
            loadingGenes = false;
        }
    }

    function groupGenesByBlock(genesList) {
        const blocks = {};
        genesList.forEach((gene) => {
            const match = gene.gene.match(/^(\d+[A-Z])/);
            if (match) {
                const blockPrefix = match[1];
                if (!blocks[blockPrefix]) {
                    blocks[blockPrefix] = {
                        genes: [],
                        collapsed: false,
                    };
                }
                blocks[blockPrefix].genes.push(gene);
            }
        });
        return blocks;
    }

    function toggleGeneBlock(blockPrefix) {
        geneBlocks[blockPrefix].collapsed = !geneBlocks[blockPrefix].collapsed;
        geneBlocks = { ...geneBlocks };
    }

    function toggleNotes(geneId) {
        expandedNotes[geneId] = !expandedNotes[geneId];
        expandedNotes = { ...expandedNotes };
    }

    async function saveAllChanges() {
        try {
            savingChanges = true;
            errorMessage = "";

            const changedGenes = genes.filter((gene) => isGeneChanged(gene));

            for (const gene of changedGenes) {
                const updateData = {
                    animal_type: animalType,
                    gene: gene.gene,
                    effect_dominant: gene.effect_dominant,
                    effect_recessive: gene.effect_recessive,
                    appearance: gene.appearance,
                    notes: gene.notes || "",
                };

                await apiClient.updateGene(updateData);
            }

            // Update original state after successful save
            originalGenes = JSON.parse(JSON.stringify(genes));
            hasUnsavedChanges = false;
            successMessage = `Successfully saved ${changedGenes.length} gene(s)`;
            setTimeout(() => {
                successMessage = "";
            }, 3000);
        } catch (err) {
            console.error("Failed to save changes:", err);
            errorMessage = "Failed to save changes";
        } finally {
            savingChanges = false;
        }
    }

    function handleInputChange(gene, field, value) {
        const geneIndex = genes.findIndex((g) => g.gene === gene.gene);
        if (geneIndex !== -1) {
            genes[geneIndex][field] = value;
            genes = [...genes];
            geneBlocks = groupGenesByBlock(genes);
            checkForUnsavedChanges();
        }
    }

    function checkForUnsavedChanges() {
        hasUnsavedChanges = genes.some((gene) => isGeneChanged(gene));
    }

    function isGeneChanged(gene) {
        const original = originalGenes.find((g) => g.gene === gene.gene);
        if (!original) return false;

        return (
            (gene.effect_dominant || "None") !==
                (original.effect_dominant || "None") ||
            (gene.effect_recessive || "None") !==
                (original.effect_recessive || "None") ||
            (gene.appearance || "") !== (original.appearance || "") ||
            (gene.notes || "") !== (original.notes || "")
        );
    }

    function getEffectClass(effect) {
        if (!effect || effect === "None") return "none";
        if (effect.includes("+")) return "positive";
        if (effect.includes("-")) return "negative";
        return "neutral";
    }

    function toggleDropdown(dropdownId) {
        openDropdown = openDropdown === dropdownId ? null : dropdownId;
    }

    function selectOption(gene, field, value) {
        handleInputChange(gene, field, value);
        openDropdown = null;
    }

    // Reload genes when props change
    $: if (animalType && chromosome) loadGenes();
</script>

<div class="gene-editing-view">
    <div class="genes-header">
        <h3 class="genes-title">🧬 {animalType} - Chromosome {chromosome}</h3>
        <div class="genes-stats">
            <span class="stat-item">{genes.length} genes</span>
            <span class="stat-item"
                >{Object.keys(geneBlocks).length} blocks</span
            >
            {#if hasUnsavedChanges}
                <span class="unsaved-indicator">⚠️ Unsaved changes</span>
            {/if}
        </div>
        <button
            class="save-btn"
            class:has-changes={hasUnsavedChanges}
            on:click={saveAllChanges}
            disabled={!hasUnsavedChanges || savingChanges}
        >
            {savingChanges
                ? "Saving..."
                : hasUnsavedChanges
                  ? "Save Changes"
                  : "No Changes"}
        </button>
    </div>

    <!-- Error/Success Messages -->
    {#if errorMessage}
        <div class="error-message">
            <span class="error-icon">⚠️</span>
            {errorMessage}
        </div>
    {/if}

    {#if successMessage}
        <div class="success-message">
            <span class="success-icon">✅</span>
            {successMessage}
        </div>
    {/if}

    {#if loadingGenes}
        <div class="loading-state">
            <div class="loading-spinner"></div>
            <p>Loading genes...</p>
        </div>
    {:else if Object.keys(geneBlocks).length > 0}
        <div class="genes-content">
            {#each Object.entries(geneBlocks) as [blockPrefix, block]}
                <div class="gene-block" class:collapsed={block.collapsed}>
                    <div
                        class="gene-block-header"
                        on:click={() => toggleGeneBlock(blockPrefix)}
                    >
                        <span class="fold-icon"
                            >{block.collapsed ? "▶" : "▼"}</span
                        >
                        <span class="block-title">Block {blockPrefix}</span>
                        <span class="block-count"
                            >({block.genes.length} genes)</span
                        >
                    </div>

                    {#if !block.collapsed}
                        <div class="gene-row">
                            {#each block.genes as gene}
                                <div
                                    class="gene-card"
                                    class:has-changes={isGeneChanged(gene)}
                                >
                                    <div class="gene-header">
                                        <span class="gene-id">{gene.gene}</span>
                                    </div>

                                    <div class="gene-fields">
                                        <div class="gene-field">
                                            <label>Dominant:</label>
                                            <div class="custom-select-wrapper">
                                                <div
                                                    class="custom-select-selected {getEffectClass(
                                                        gene.effect_dominant,
                                                    )}"
                                                    on:click={() =>
                                                        toggleDropdown(
                                                            `${gene.gene}-dominant`,
                                                        )}
                                                >
                                                    {gene.effect_dominant ||
                                                        "None"}
                                                </div>
                                                {#if openDropdown === `${gene.gene}-dominant`}
                                                    <div
                                                        class="custom-select-options"
                                                    >
                                                        <div
                                                            class="custom-option option-none none-option"
                                                            on:click={() =>
                                                                selectOption(
                                                                    gene,
                                                                    "effect_dominant",
                                                                    "None",
                                                                )}
                                                        >
                                                            None
                                                        </div>
                                                        <div
                                                            class="options-grid"
                                                        >
                                                            <div
                                                                class="negative-column"
                                                            >
                                                                {#each effectOptions
                                                                    .sort()
                                                                    .filter( (option) => option.includes("-"), ) as option}
                                                                    <div
                                                                        class="custom-option option-negative"
                                                                        on:click={() =>
                                                                            selectOption(
                                                                                gene,
                                                                                "effect_dominant",
                                                                                option,
                                                                            )}
                                                                    >
                                                                        {option}
                                                                    </div>
                                                                {/each}
                                                            </div>
                                                            <div
                                                                class="positive-column"
                                                            >
                                                                {#each effectOptions
                                                                    .sort()
                                                                    .filter( (option) => option.includes("+"), ) as option}
                                                                    <div
                                                                        class="custom-option option-positive"
                                                                        on:click={() =>
                                                                            selectOption(
                                                                                gene,
                                                                                "effect_dominant",
                                                                                option,
                                                                            )}
                                                                    >
                                                                        {option}
                                                                    </div>
                                                                {/each}
                                                            </div>
                                                        </div>
                                                    </div>
                                                {/if}
                                            </div>
                                        </div>

                                        <div class="gene-field">
                                            <label>Recessive:</label>
                                            <div class="custom-select-wrapper">
                                                <div
                                                    class="custom-select-selected {getEffectClass(
                                                        gene.effect_recessive,
                                                    )}"
                                                    on:click={() =>
                                                        toggleDropdown(
                                                            `${gene.gene}-recessive`,
                                                        )}
                                                >
                                                    {gene.effect_recessive ||
                                                        "None"}
                                                </div>
                                                {#if openDropdown === `${gene.gene}-recessive`}
                                                    <div
                                                        class="custom-select-options"
                                                    >
                                                        <div
                                                            class="custom-option option-none none-option"
                                                            on:click={() =>
                                                                selectOption(
                                                                    gene,
                                                                    "effect_recessive",
                                                                    "None",
                                                                )}
                                                        >
                                                            None
                                                        </div>
                                                        <div
                                                            class="options-grid"
                                                        >
                                                            <div
                                                                class="negative-column"
                                                            >
                                                                {#each effectOptions
                                                                    .sort()
                                                                    .filter( (option) => option.includes("-"), ) as option}
                                                                    <div
                                                                        class="custom-option option-negative"
                                                                        on:click={() =>
                                                                            selectOption(
                                                                                gene,
                                                                                "effect_recessive",
                                                                                option,
                                                                            )}
                                                                    >
                                                                        {option}
                                                                    </div>
                                                                {/each}
                                                            </div>
                                                            <div
                                                                class="positive-column"
                                                            >
                                                                {#each effectOptions
                                                                    .sort()
                                                                    .filter( (option) => option.includes("+"), ) as option}
                                                                    <div
                                                                        class="custom-option option-positive"
                                                                        on:click={() =>
                                                                            selectOption(
                                                                                gene,
                                                                                "effect_recessive",
                                                                                option,
                                                                            )}
                                                                    >
                                                                        {option}
                                                                    </div>
                                                                {/each}
                                                            </div>
                                                        </div>
                                                    </div>
                                                {/if}
                                            </div>
                                        </div>

                                        <div class="gene-field">
                                            <label>Appearance:</label>
                                            <input
                                                type="text"
                                                value={gene.appearance || ""}
                                                placeholder="Appearance trait..."
                                                on:input={(e) =>
                                                    handleInputChange(
                                                        gene,
                                                        "appearance",
                                                        e.target.value,
                                                    )}
                                            />
                                        </div>
                                    </div>

                                    <div class="notes-section">
                                        <button
                                            class="notes-toggle"
                                            on:click={() =>
                                                toggleNotes(gene.gene)}
                                        >
                                            📝 Notes {expandedNotes[gene.gene]
                                                ? "▼"
                                                : "▶"}
                                        </button>

                                        {#if expandedNotes[gene.gene]}
                                            <div class="notes-content expanded">
                                                <textarea
                                                    placeholder="Add notes about this gene..."
                                                    value={gene.notes || ""}
                                                    on:input={(e) =>
                                                        handleInputChange(
                                                            gene,
                                                            "notes",
                                                            e.target.value,
                                                        )}
                                                ></textarea>
                                            </div>
                                        {/if}
                                    </div>
                                </div>
                            {/each}
                        </div>
                    {/if}
                </div>
            {/each}
        </div>
    {:else}
        <div class="empty-state">
            <p>No genes found for {animalType} chromosome {chromosome}</p>
        </div>
    {/if}
</div>

<style>
    .gene-editing-view {
        flex: 1;
        display: flex;
        flex-direction: column;
        min-height: 0;
    }

    .genes-header {
        position: sticky;
        top: 0;
        z-index: 100;
        display: flex;
        align-items: center;
        gap: 2rem;
        padding: 0.75rem 1.5rem;
        background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
        border-radius: 0;
    }

    .genes-title {
        font-size: 1.25rem;
        font-weight: 700;
        color: white;
        margin: 0;
    }

    .genes-stats {
        display: flex;
        gap: 1rem;
        align-items: center;
        flex: 1;
    }

    .stat-item {
        font-size: 0.8rem;
        color: rgba(255, 255, 255, 0.8);
    }

    .unsaved-indicator {
        color: #f59e0b;
        font-weight: 600;
        font-size: 0.8rem;
    }

    .save-btn {
        padding: 0.5rem 1rem;
        border: 1px solid #e5e7eb;
        border-radius: 6px;
        background: #f9fafb;
        color: #6b7280;
        font-size: 0.8rem;
        font-weight: 500;
        cursor: not-allowed;
        transition: all 0.2s ease;
        white-space: nowrap;
    }

    .save-btn.has-changes {
        background: linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%);
        color: white;
        border-color: #3b82f6;
        cursor: pointer;
    }

    .save-btn.has-changes:hover:not(:disabled) {
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);
    }

    .save-btn:disabled {
        opacity: 0.6;
        cursor: not-allowed;
        transform: none;
    }

    .genes-content {
        flex: 1;
        padding: 1.5rem;
        overflow-y: auto;
        min-height: 0;
    }

    .loading-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 4rem;
        gap: 1rem;
    }

    .loading-spinner {
        width: 40px;
        height: 40px;
        border: 4px solid #e5e7eb;
        border-top: 4px solid #3b82f6;
        border-radius: 50%;
        animation: spin 1s linear infinite;
    }

    @keyframes spin {
        0% {
            transform: rotate(0deg);
        }
        100% {
            transform: rotate(360deg);
        }
    }

    .genes-content {
        display: flex;
        flex-direction: column;
        gap: 1rem;
    }

    .gene-block {
        border: 1px solid #e5e7eb;
        border-radius: 8px;
        overflow: visible;
        transition: all 0.2s ease;
    }

    .gene-block:hover {
        border-color: #d1d5db;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
    }

    .gene-block-header {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding: 1rem;
        background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
        border-bottom: 1px solid #e5e7eb;
        cursor: pointer;
        transition: background-color 0.2s ease;
    }

    .gene-block-header:hover {
        background: linear-gradient(135deg, #f1f5f9 0%, #e2e8f0 100%);
    }

    .fold-icon {
        font-size: 0.875rem;
        color: #6b7280;
        transition: transform 0.2s ease;
    }

    .block-title {
        font-weight: 600;
        color: #111827;
        flex: 1;
    }

    .block-count {
        font-size: 0.875rem;
        color: #6b7280;
    }

    .gene-block.collapsed .fold-icon {
        transform: rotate(-90deg);
    }

    .gene-block.collapsed .gene-row {
        display: none;
    }

    .gene-row {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        padding: 1rem;
    }

    .gene-card {
        border: 1px solid #e5e7eb;
        border-radius: 8px;
        padding: 0.75rem;
        background: white;
        transition: all 0.2s ease;
        display: flex;
        align-items: center;
        gap: 1rem;
    }

    .gene-card:hover {
        border-color: #d1d5db;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
    }

    .gene-card.has-changes {
        border-color: #f59e0b;
        background-color: #fffbeb;
    }

    .gene-header {
        min-width: 80px;
        flex-shrink: 0;
    }

    .gene-id {
        font-weight: 600;
        color: #111827;
        font-size: 1rem;
    }

    .gene-fields {
        display: flex;
        gap: 1rem;
        flex: 1;
        align-items: center;
    }

    .gene-field {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
        min-width: 120px;
    }

    .gene-field label {
        font-size: 0.6875rem;
        font-weight: 500;
        color: #374151;
        text-transform: uppercase;
        letter-spacing: 0.025em;
        white-space: nowrap;
    }

    .gene-field input {
        padding: 6px 26px 6px 8px;
        border: 2px solid #e2e8f0;
        border-radius: 8px;
        background: linear-gradient(135deg, #ffffff 0%, #f8fafc 100%);
        font-size: 11px;
        font-weight: 500;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
        transition: all 0.3s ease;
        appearance: none;
        cursor: pointer;
        max-height: 200px;
        overflow-y: auto;
    }

    .gene-field input:focus {
        outline: none;
        border-color: #3b82f6;
        box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
        background: linear-gradient(135deg, #ffffff 0%, #f0f9ff 100%);
    }

    /* Custom dropdown styling */
    .custom-select-wrapper {
        position: relative;
        width: 100%;
    }

    .custom-select-selected {
        padding: 6px 26px 6px 8px;
        border: 2px solid #e2e8f0;
        border-radius: 8px;
        background: linear-gradient(135deg, #ffffff 0%, #f8fafc 100%);
        cursor: pointer;
        font-size: 11px;
        display: flex;
        align-items: center;
        min-height: 24px;
        transition: all 0.3s ease;
        position: relative;
        font-weight: 500;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
    }

    .custom-select-selected::after {
        content: "▼";
        position: absolute;
        right: 8px;
        font-size: 10px;
        color: #64748b;
        transition: transform 0.3s ease;
    }

    .custom-select-selected:hover {
        border-color: #3b82f6;
        background: linear-gradient(135deg, #ffffff 0%, #f0f9ff 100%);
        box-shadow: 0 4px 12px rgba(59, 130, 246, 0.15);
    }

    .custom-select-selected.positive {
        border-color: #10b981;
        background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%);
    }

    .custom-select-selected.negative {
        border-color: #ef4444;
        background: linear-gradient(135deg, #fef2f2 0%, #fecaca 100%);
    }

    .custom-select-selected.none {
        border-color: #6b7280;
        background: linear-gradient(135deg, #f9fafb 0%, #f3f4f6 100%);
    }

    .custom-select-options {
        position: absolute;
        top: 100%;
        left: 0;
        right: 0;
        background: white;
        border: 2px solid #3b82f6;
        border-top: none;
        border-radius: 0 0 8px 8px;
        max-height: 300px;
        overflow-y: auto;
        z-index: 9999;
        box-shadow: 0 8px 25px rgba(0, 0, 0, 0.15);
        width: 300px;
    }

    .none-option {
        border-bottom: 1px solid #e5e7eb;
        margin-bottom: 4px;
    }

    .options-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 1px;
        background: #e5e7eb;
    }

    .negative-column,
    .positive-column {
        background: white;
        display: flex;
        flex-direction: column;
    }

    .custom-option {
        padding: 8px 12px;
        cursor: pointer;
        font-size: 11px;
        transition: all 0.3s ease;
        border-left: 4px solid transparent;
        font-weight: 500;
    }

    .custom-option:hover {
        background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
        border-left-color: #1d4ed8;
        color: white;
        font-weight: 700;
    }

    .custom-option.option-positive {
        background: linear-gradient(135deg, #dcfce7 0%, #bbf7d0 100%);
        color: #15803d;
        border-left-color: #16a34a;
        font-weight: 600;
    }

    .custom-option.option-negative {
        background: linear-gradient(135deg, #fef2f2 0%, #fecaca 100%);
        color: #dc2626;
        border-left-color: #dc2626;
        font-weight: 600;
    }

    .custom-option.option-none {
        background: #f9fafb;
        color: #6b7280;
        border-left-color: #6b7280;
        font-style: italic;
    }

    .effect-select.positive {
        border-color: #10b981;
        background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%);
    }

    .effect-select.negative {
        border-color: #ef4444;
        background: linear-gradient(135deg, #fef2f2 0%, #fecaca 100%);
    }

    .effect-select.none {
        border-color: #6b7280;
        background: linear-gradient(135deg, #f9fafb 0%, #f3f4f6 100%);
    }

    .notes-section {
        border-left: 1px solid #e5e7eb;
        padding-left: 1rem;
        margin-left: 1rem;
        flex-shrink: 0;
    }

    .notes-toggle {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        background: none;
        border: none;
        padding: 0;
        font-size: 0.875rem;
        color: #6b7280;
        cursor: pointer;
        transition: color 0.2s ease;
    }

    .notes-toggle:hover {
        color: #374151;
    }

    .notes-content {
        margin-top: 0.75rem;
        display: none;
    }

    .notes-content.expanded {
        display: block;
    }

    .notes-content textarea {
        width: 100%;
        min-height: 80px;
        padding: 0.5rem;
        border: 1px solid #d1d5db;
        border-radius: 6px;
        font-size: 0.875rem;
        font-family: inherit;
        resize: vertical;
        transition: border-color 0.2s ease;
    }

    .notes-content textarea:focus {
        outline: none;
        border-color: #3b82f6;
        box-shadow: 0 0 0 1px #3b82f6;
    }

    .empty-state {
        text-align: center;
        padding: 4rem;
        color: #6b7280;
    }

    .error-message,
    .success-message {
        padding: 1rem;
        border-radius: 8px;
        margin-bottom: 1rem;
        display: flex;
        align-items: center;
        gap: 0.5rem;
        font-size: 0.875rem;
    }

    .error-message {
        background-color: #fef2f2;
        color: #dc2626;
        border: 1px solid #fecaca;
    }

    .success-message {
        background-color: #f0fdf4;
        color: #059669;
        border: 1px solid #bbf7d0;
    }

    @media (max-width: 768px) {
        .genes-content {
            padding: 1rem;
        }

        .genes-header {
            flex-direction: column;
            gap: 1rem;
            align-items: stretch;
            padding: 0.75rem;
        }

        .genes-stats {
            flex-wrap: wrap;
        }

        .gene-card {
            flex-direction: column;
            align-items: stretch;
            gap: 0.75rem;
        }

        .gene-fields {
            flex-direction: column;
            gap: 0.75rem;
        }

        .notes-section {
            border-left: none;
            border-top: 1px solid #e5e7eb;
            padding-left: 0;
            padding-top: 1rem;
            margin-left: 0;
            margin-top: 1rem;
        }
    }

    /* Gene Editor Styles moved from gene-visualizer-styles.css */

    .gene-row {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 12px;
        transition: all 0.2s;
    }

    .gene-card {
        background: linear-gradient(135deg, #ffffff 0%, #f8fafc 100%);
        border: 1px solid #e2e8f0;
        border-radius: 12px;
        padding: 12px;
        transition: all 0.3s ease;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
    }

    .gene-card:hover {
        border-color: #3b82f6;
        background: linear-gradient(135deg, #ffffff 0%, #f0f9ff 100%);
        box-shadow: 0 8px 25px rgba(59, 130, 246, 0.15);
    }

    .gene-card.has-changes {
        border-color: #f59e0b;
        background: linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%);
        box-shadow: 0 4px 16px rgba(245, 158, 11, 0.2);
    }

    .gene-card.has-changes:hover {
        border-color: #d97706;
        background: linear-gradient(135deg, #fef3c7 0%, #fed7aa 100%);
        box-shadow: 0 8px 25px rgba(217, 119, 6, 0.25);
    }

    /* Effect styling */
    .effect-select {
        position: relative;
        font-weight: 500;
    }

    .effect-positive {
        background: linear-gradient(135deg, #dcfce7 0%, #bbf7d0 100%);
        border-color: #16a34a !important;
        color: #15803d;
    }

    .effect-positive:focus {
        box-shadow: 0 0 0 2px rgba(34, 197, 94, 0.2);
    }

    .effect-negative {
        background: linear-gradient(135deg, #fef2f2 0%, #fecaca 100%);
        border-color: #dc2626 !important;
        color: #dc2626;
    }

    .effect-negative:focus {
        box-shadow: 0 0 0 2px rgba(239, 68, 68, 0.2);
    }

    .effect-none {
        border-left: 4px solid #6b7280 !important;
        box-shadow: inset 0 0 0 1px rgba(107, 114, 128, 0.2);
        background: #f9fafb;
        color: #6b7280;
    }

    .notes-section {
        margin-top: 4px;
    }

    .notes-toggle {
        background: linear-gradient(135deg, #f1f5f9 0%, #e2e8f0 100%);
        border: 1px solid #cbd5e1;
        color: #475569;
        padding: 4px 10px;
        border-radius: 6px;
        font-size: 10px;
        cursor: pointer;
        transition: all 0.3s ease;
        width: 100%;
        text-align: center;
        font-weight: 600;
    }

    .notes-toggle:hover {
        background: linear-gradient(135deg, #e2e8f0 0%, #cbd5e1 100%);
        color: #334155;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
    }

    .notes-content {
        display: none;
        margin-top: 4px;
    }

    .notes-content.expanded {
        display: block;
    }

    .gene-field {
        position: relative;
    }

    .gene-field::after {
        content: "▼";
        position: absolute;
        right: 12px;
        top: 50%;
        transform: translateY(-50%);
        pointer-events: none;
        font-size: 12px;
        color: #64748b;
    }

    /* Custom Dropdown Styling */
    .custom-select-wrapper {
        position: relative;
        width: 100%;
    }

    .custom-select-selected {
        padding: 6px 26px 6px 8px;
        border: 2px solid #e2e8f0;
        border-radius: 8px;
        background: linear-gradient(135deg, #ffffff 0%, #f8fafc 100%);
        cursor: pointer;
        font-size: 11px;
        display: flex;
        align-items: center;
        min-height: 24px;
        transition: all 0.3s ease;
        position: relative;
        font-weight: 500;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
    }

    .custom-select-selected::after {
        content: "▼";
        position: absolute;
        right: 8px;
        font-size: 10px;
        color: #64748b;
        transition: transform 0.3s ease;
    }

    .custom-select-selected:hover {
        border-color: #3b82f6;
        background: linear-gradient(135deg, #ffffff 0%, #f0f9ff 100%);
        box-shadow: 0 4px 12px rgba(59, 130, 246, 0.15);
    }

    .custom-select-options {
        position: absolute;
        top: 100%;
        left: 0;
        right: 0;
        background: white;
        border: 2px solid #3b82f6;
        border-top: none;
        border-radius: 0 0 8px 8px;
        max-height: 200px;
        overflow-y: auto;
        z-index: 1000;
        box-shadow: 0 8px 25px rgba(0, 0, 0, 0.15);
        backdrop-filter: blur(10px);
    }

    .custom-option {
        padding: 8px 12px;
        cursor: pointer;
        font-size: 11px;
        transition: all 0.3s ease;
        border-left: 4px solid transparent;
        font-weight: 500;
    }

    .custom-option:hover {
        background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
        border-left-color: #1d4ed8;
        color: white;
        font-weight: 700;
        box-shadow: 0 2px 8px rgba(59, 130, 246, 0.3);
    }

    .custom-option.selected {
        font-weight: 600;
        background: linear-gradient(135deg, #e2e8f0 0%, #cbd5e1 100%);
        border-left-color: #3b82f6;
    }

    /* Option styling */
    .option-positive {
        background: linear-gradient(135deg, #dcfce7 0%, #bbf7d0 100%);
        color: #15803d;
        border-left-color: #16a34a;
    }

    .option-positive:hover {
        background: linear-gradient(
            135deg,
            #3b82f6 0%,
            #2563eb 100%
        ) !important;
        border-left-color: #1d4ed8 !important;
        color: white !important;
        font-weight: 700 !important;
        box-shadow: 0 2px 8px rgba(59, 130, 246, 0.3) !important;
    }

    .option-negative {
        background: linear-gradient(135deg, #fef2f2 0%, #fecaca 100%);
        color: #dc2626;
        border-left-color: #dc2626;
    }

    .option-negative:hover {
        background: linear-gradient(
            135deg,
            #3b82f6 0%,
            #2563eb 100%
        ) !important;
        border-left-color: #1d4ed8 !important;
        color: white !important;
        font-weight: 700 !important;
        box-shadow: 0 2px 8px rgba(59, 130, 246, 0.3) !important;
    }

    .option-none {
        background: #f9fafb;
        color: #6b7280;
        border-left-color: #6b7280;
    }

    .option-none:hover {
        background: linear-gradient(
            135deg,
            #3b82f6 0%,
            #2563eb 100%
        ) !important;
        border-left-color: #1d4ed8 !important;
        color: white !important;
        font-weight: 700 !important;
        box-shadow: 0 2px 8px rgba(59, 130, 246, 0.3) !important;
    }

    .options-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 0;
    }

    .negative-column .custom-option {
        border-right: 1px solid #e2e8f0;
    }
</style>
