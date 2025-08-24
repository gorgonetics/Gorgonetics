<script>
    import { run, stopPropagation } from "svelte/legacy";

    /**
     * @typedef {Object} Props
     * @property {string} [animalType] - Props from parent
     * @property {string} [chromosome]
     */

    /** @type {Props} */
    const { animalType = "", chromosome = "" } = $props();

    // State
    let genes = $state([]);
    let effectOptions = $state([]);
    let loadingGenes = $state(false);
    let successMessage = $state("");
    let errorMessage = $state("");
    let expandedNotes = $state({});
    let openDropdown = $state(null);
    let originalGenes = [];
    let hasUnsavedChanges = $state(false);
    let savingChanges = $state(false);

    async function loadEffectOptions() {
        if (!animalType) return;

        try {
            const response = await fetch(`/api/effect-options/${animalType}`);

            if (response.ok) {
                effectOptions = await response.json();
            } else {
                console.error(
                    "Failed to load effect options:",
                    response.statusText,
                );
                // Fallback to all options if species-specific fails
                const fallbackResponse = await fetch("/api/effect-options");
                if (fallbackResponse.ok) {
                    effectOptions = await fallbackResponse.json();
                }
            }
        } catch (error) {
            console.error("Failed to load effect options:", error);
        }
    }

    // Load genes for the selected chromosome
    async function loadGenes() {
        if (!animalType || !chromosome) return;

        loadingGenes = true;
        errorMessage = "";

        try {
            const response = await fetch(
                `/api/genes/${animalType}/${chromosome}`,
            );
            if (response.ok) {
                genes = await response.json();
                originalGenes = JSON.parse(JSON.stringify(genes));
                hasUnsavedChanges = false;
            } else {
                errorMessage = "Failed to load genes";
            }
        } catch (error) {
            errorMessage = `Error loading genes: ${error.message}`;
        } finally {
            loadingGenes = false;
        }
    }

    // Save all changes
    async function saveAllChanges() {
        if (!hasUnsavedChanges) return;

        savingChanges = true;
        errorMessage = "";
        successMessage = "";

        try {
            const response = await fetch("/api/genes", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    animal_type: animalType,
                    chromosome: chromosome,
                    genes: genes,
                }),
            });

            if (response.ok) {
                originalGenes = JSON.parse(JSON.stringify(genes));
                hasUnsavedChanges = false;
                successMessage = "All changes saved successfully!";
                setTimeout(() => {
                    successMessage = "";
                }, 3000);
            } else {
                errorMessage = "Failed to save changes";
            }
        } catch (error) {
            errorMessage = `Error saving changes: ${error.message}`;
        } finally {
            savingChanges = false;
        }
    }

    // Export chromosome to JSON file
    async function exportChromosome() {
        if (!animalType || !chromosome) return;

        try {
            const response = await fetch(
                `/api/download/${animalType}/${chromosome}`,
            );
            if (response.ok) {
                const blob = await response.blob();
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `${animalType}_genes_chr${chromosome}.json`;
                document.body.appendChild(a);
                a.click();
                window.URL.revokeObjectURL(url);
                document.body.removeChild(a);
            } else {
                errorMessage = "Failed to export chromosome";
            }
        } catch (error) {
            errorMessage = `Error exporting chromosome: ${error.message}`;
        }
    }

    // Handle input changes
    function handleInputChange(gene, field, value) {
        const geneIndex = genes.findIndex((g) => g.gene === gene.gene);
        if (geneIndex !== -1) {
            genes[geneIndex] = { ...genes[geneIndex], [field]: value };
            genes = [...genes];
            checkForUnsavedChanges();
        }
    }

    // Check for unsaved changes
    function checkForUnsavedChanges() {
        hasUnsavedChanges = genes.some((gene) => isGeneChanged(gene));
    }

    // Check if a specific gene has changes
    function isGeneChanged(gene) {
        const original = originalGenes.find((g) => g.gene === gene.gene);
        if (!original) return false;

        return (
            (gene.effectDominant || "") !== (original.effectDominant || "") ||
            (gene.effectRecessive || "") !== (original.effectRecessive || "") ||
            (gene.appearance || "") !== (original.appearance || "") ||
            (gene.notes || "") !== (original.notes || "")
        );
    }

    // Get effect class for styling
    function getEffectClass(effect) {
        if (!effect || effect === "None") return "none";
        return effect.includes("+")
            ? "positive"
            : effect.includes("-")
              ? "negative"
              : "none";
    }

    // Toggle dropdown
    function toggleDropdown(geneId, field, event) {
        const dropdownId = `${geneId}-${field}`;
        openDropdown = openDropdown === dropdownId ? null : dropdownId;

        if (openDropdown) {
            // Check if dropdown should flip upward
            setTimeout(() => {
                const trigger = event.target;
                const dropdown = trigger.nextElementSibling;
                if (dropdown && dropdown.classList.contains("dropdown")) {
                    const rect = trigger.getBoundingClientRect();
                    const dropdownHeight = dropdown.offsetHeight;
                    const viewportHeight = window.innerHeight;

                    if (
                        rect.bottom + dropdownHeight > viewportHeight &&
                        rect.top > dropdownHeight
                    ) {
                        dropdown.style.top = "auto";
                        dropdown.style.bottom = "100%";
                        dropdown.style.marginTop = "0";
                        dropdown.style.marginBottom = "0.25rem";
                    }
                }
            }, 0);
        }
    }

    // Select option from dropdown
    function selectOption(gene, field, value) {
        handleInputChange(gene, field, value === "None" ? "" : value);
        openDropdown = null;
    }

    // Toggle notes expansion
    function toggleNotes(geneId) {
        expandedNotes[geneId] = !expandedNotes[geneId];
        expandedNotes = { ...expandedNotes };
    }

    // Load effect options when animalType changes
    run(() => {
        if (animalType) {
            loadEffectOptions();
        }
    });
    // Reactive statements
    run(() => {
        if (animalType && chromosome) {
            loadGenes();
        }
    });
</script>

<div class="pet-visualization">
    <div class="visualization-header">
        <h3 class="visualization-title">
            🧬 Gene Editor: {animalType} - Chromosome {chromosome}
        </h3>
        <div class="visualization-stats">
            <span class="stat-item">{genes.length} genes</span>
            {#if hasUnsavedChanges}
                <span class="unknown-indicator">⚠️ Unsaved changes</span>
            {/if}
        </div>
        <div class="view-controls">
            <button
                class="view-btn"
                class:active={hasUnsavedChanges}
                onclick={saveAllChanges}
                disabled={!hasUnsavedChanges || savingChanges}
            >
                {#if savingChanges}
                    Saving...
                {:else if hasUnsavedChanges}
                    Save Changes
                {:else}
                    All Saved
                {/if}
            </button>
            <button
                class="view-btn"
                onclick={exportChromosome}
                title="Export chromosome as JSON"
            >
                📥 Export
            </button>
        </div>
    </div>

    <!-- Messages -->
    {#if errorMessage}
        <div class="message error">
            <span class="message-icon">⚠️</span>
            {errorMessage}
        </div>
    {/if}

    {#if successMessage}
        <div class="message success">
            <span class="message-icon">✅</span>
            {successMessage}
        </div>
    {/if}

    <!-- Content -->
    <div class="gene-visualizer-container">
        {#if loadingGenes}
            <div class="loading">
                <div class="spinner large"></div>
                <p>Loading genes...</p>
            </div>
        {:else if genes.length === 0}
            <div class="empty">
                <p>No genes found for {animalType} chromosome {chromosome}</p>
            </div>
        {:else}
            <div class="genes-grid">
                {#each genes as gene (gene.gene)}
                    <div class="gene-card" class:changed={isGeneChanged(gene)}>
                        <!-- Gene Header -->
                        <div class="gene-header">
                            <span class="gene-id">{gene.gene}</span>
                            <button
                                class="notes-btn"
                                class:active={expandedNotes[gene.gene]}
                                onclick={() => toggleNotes(gene.gene)}
                                title="Toggle notes"
                            >
                                📝
                            </button>
                        </div>

                        <!-- Gene Fields -->
                        <div class="gene-fields">
                            <!-- Dominant Effect -->
                            <div class="field">
                                <label>Dominant</label>
                                <div class="select-wrapper">
                                    <button
                                        class="select-trigger {getEffectClass(
                                            gene.effectDominant,
                                        )}"
                                        onclick={stopPropagation((e) =>
                                            toggleDropdown(
                                                gene.gene,
                                                "dominant",
                                                e,
                                            ),
                                        )}
                                    >
                                        {gene.effectDominant || "None"}
                                        <span class="chevron">▼</span>
                                    </button>

                                    {#if openDropdown === `${gene.gene}-dominant`}
                                        <div class="dropdown">
                                            <button
                                                class="option none"
                                                onclick={stopPropagation(() =>
                                                    selectOption(
                                                        gene,
                                                        "effectDominant",
                                                        "None",
                                                    ),
                                                )}
                                            >
                                                None
                                            </button>

                                            <div class="effects-grid">
                                                <div
                                                    class="effects-column negative"
                                                >
                                                    {#each effectOptions
                                                        .filter( (opt) => opt.includes("-"), )
                                                        .sort() as option}
                                                        <button
                                                            class="option negative"
                                                            onclick={stopPropagation(
                                                                () =>
                                                                    selectOption(
                                                                        gene,
                                                                        "effectDominant",
                                                                        option,
                                                                    ),
                                                            )}
                                                        >
                                                            {option}
                                                        </button>
                                                    {/each}
                                                </div>

                                                <div
                                                    class="effects-column positive"
                                                >
                                                    {#each effectOptions
                                                        .filter( (opt) => opt.includes("+"), )
                                                        .sort() as option}
                                                        <button
                                                            class="option positive"
                                                            onclick={stopPropagation(
                                                                () =>
                                                                    selectOption(
                                                                        gene,
                                                                        "effectDominant",
                                                                        option,
                                                                    ),
                                                            )}
                                                        >
                                                            {option}
                                                        </button>
                                                    {/each}
                                                </div>
                                            </div>
                                        </div>
                                    {/if}
                                </div>
                            </div>

                            <!-- Recessive Effect -->
                            <div class="field">
                                <label>Recessive</label>
                                <div class="select-wrapper">
                                    <button
                                        class="select-trigger {getEffectClass(
                                            gene.effectRecessive,
                                        )}"
                                        onclick={stopPropagation((e) =>
                                            toggleDropdown(
                                                gene.gene,
                                                "recessive",
                                                e,
                                            ),
                                        )}
                                    >
                                        {gene.effectRecessive || "None"}
                                        <span class="chevron">▼</span>
                                    </button>

                                    {#if openDropdown === `${gene.gene}-recessive`}
                                        <div class="dropdown">
                                            <button
                                                class="option none"
                                                onclick={stopPropagation(() =>
                                                    selectOption(
                                                        gene,
                                                        "effectRecessive",
                                                        "None",
                                                    ),
                                                )}
                                            >
                                                None
                                            </button>

                                            <div class="effects-grid">
                                                <div
                                                    class="effects-column negative"
                                                >
                                                    {#each effectOptions
                                                        .filter( (opt) => opt.includes("-"), )
                                                        .sort() as option}
                                                        <button
                                                            class="option negative"
                                                            onclick={stopPropagation(
                                                                () =>
                                                                    selectOption(
                                                                        gene,
                                                                        "effectRecessive",
                                                                        option,
                                                                    ),
                                                            )}
                                                        >
                                                            {option}
                                                        </button>
                                                    {/each}
                                                </div>

                                                <div
                                                    class="effects-column positive"
                                                >
                                                    {#each effectOptions
                                                        .filter( (opt) => opt.includes("+"), )
                                                        .sort() as option}
                                                        <button
                                                            class="option positive"
                                                            onclick={stopPropagation(
                                                                () =>
                                                                    selectOption(
                                                                        gene,
                                                                        "effectRecessive",
                                                                        option,
                                                                    ),
                                                            )}
                                                        >
                                                            {option}
                                                        </button>
                                                    {/each}
                                                </div>
                                            </div>
                                        </div>
                                    {/if}
                                </div>
                            </div>

                            <!-- Appearance -->
                            <div class="field">
                                <label>Appearance</label>
                                <input
                                    type="text"
                                    value={gene.appearance || ""}
                                    oninput={(e) =>
                                        handleInputChange(
                                            gene,
                                            "appearance",
                                            e.target.value,
                                        )}
                                    placeholder="Enter appearance"
                                />
                            </div>
                        </div>

                        <!-- Notes Section -->
                        {#if expandedNotes[gene.gene]}
                            <div class="notes-section">
                                <textarea
                                    value={gene.notes || ""}
                                    oninput={(e) =>
                                        handleInputChange(
                                            gene,
                                            "notes",
                                            e.target.value,
                                        )}
                                    placeholder="Add notes..."
                                    rows="3"
                                ></textarea>
                            </div>
                        {/if}
                    </div>
                {/each}
            </div>
        {/if}
    </div>
</div>

<!-- Click outside to close dropdown -->
<svelte:window
    onclick={(e) => {
        if (!e.target.closest(".select-wrapper")) {
            openDropdown = null;
        }
    }}
/>

<style>
    /* Messages */
    .message {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 1rem 2rem;
        font-weight: 500;
    }

    .message.error {
        background: #fef2f2;
        color: #dc2626;
        border-bottom: 1px solid #fecaca;
    }

    .message.success {
        background: #f0fdf4;
        color: #16a34a;
        border-bottom: 1px solid #bbf7d0;
    }

    .message-icon {
        font-size: 1.1rem;
    }

    .loading,
    .empty {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        min-height: 200px;
        gap: 1rem;
        color: #6b7280;
    }

    /* Spinner */
    .spinner {
        width: 16px;
        height: 16px;
        border: 2px solid transparent;
        border-top: 2px solid currentColor;
        border-radius: 50%;
        animation: spin 1s linear infinite;
    }

    .spinner.large {
        width: 32px;
        height: 32px;
        border-width: 3px;
    }

    @keyframes spin {
        to {
            transform: rotate(360deg);
        }
    }

    /* Content scrolling */
    .gene-visualizer-container {
        overflow-y: auto;
    }

    /* Genes Grid */
    .genes-grid {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 1rem;
        padding-bottom: 2rem;
    }

    /* Gene Card */
    .gene-card {
        background: white;
        border: 2px solid #e5e7eb;
        border-radius: 8px;
        padding: 1rem;
        transition: all 0.2s ease;
        position: relative;
        min-width: 0;
    }

    .gene-card:hover {
        border-color: #d1d5db;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    }

    .gene-card.changed {
        border-color: #f59e0b;
        background: #fffbeb;
    }

    .gene-card.changed::before {
        content: "●";
        position: absolute;
        top: 1rem;
        right: 1rem;
        color: #f59e0b;
        font-size: 1.2rem;
    }

    /* Gene Header */
    .gene-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 0.75rem;
        padding-bottom: 0.5rem;
        border-bottom: 1px solid #e5e7eb;
    }

    .gene-id {
        font-size: 1rem;
        font-weight: 700;
        color: #111827;
    }

    .notes-btn {
        padding: 0.25rem;
        border: none;
        background: none;
        cursor: pointer;
        opacity: 0.6;
        transition: all 0.2s ease;
        border-radius: 4px;
    }

    .notes-btn:hover,
    .notes-btn.active {
        opacity: 1;
        background: #f3f4f6;
    }

    /* Gene Fields */
    .gene-fields {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
    }

    .field {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
    }

    .field label {
        font-size: 0.75rem;
        font-weight: 600;
        color: #374151;
        text-transform: uppercase;
        letter-spacing: 0.025em;
    }

    .field input {
        padding: 0.5rem;
        border: 2px solid #e5e7eb;
        border-radius: 6px;
        font-size: 0.75rem;
        transition: all 0.2s ease;
    }

    .field input:focus {
        outline: none;
        border-color: #3b82f6;
        box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
    }

    /* Select Wrapper */
    .select-wrapper {
        position: relative;
    }

    .select-trigger {
        display: flex;
        align-items: center;
        justify-content: space-between;
        width: 100%;
        padding: 0.5rem;
        border: 2px solid #e5e7eb;
        border-radius: 6px;
        background: white;
        font-size: 0.75rem;
        font-weight: 500;
        text-align: left;
        cursor: pointer;
        transition: all 0.2s ease;
    }

    .select-trigger:hover {
        border-color: #d1d5db;
    }

    .select-trigger.positive {
        background: linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%);
        border-color: #22c55e;
        color: #059669;
    }

    .select-trigger.negative {
        background: linear-gradient(135deg, #fef2f2 0%, #fecaca 100%);
        border-color: #ef4444;
        color: #dc2626;
    }

    .select-trigger.none {
        color: #6b7280;
    }

    .chevron {
        font-size: 0.625rem;
        opacity: 0.6;
        transition: transform 0.2s ease;
    }

    /* Dropdown */
    .dropdown {
        position: absolute;
        top: 100%;
        left: 0;
        right: 0;
        z-index: 1000;
        margin-top: 0.25rem;
        background: white;
        border: 2px solid #e5e7eb;
        border-radius: 8px;
        box-shadow: 0 10px 25px rgba(0, 0, 0, 0.1);
        max-height: 300px;
        overflow-y: auto;
    }

    .option {
        display: block;
        width: 100%;
        padding: 0.5rem;
        border: none;
        background: none;
        text-align: left;
        font-size: 0.75rem;
        cursor: pointer;
        transition: background-color 0.15s ease;
    }

    .option:hover {
        background: #f3f4f6;
    }

    .option.none {
        color: #6b7280;
        border-bottom: 1px solid #e5e7eb;
    }

    .option.positive {
        color: #059669;
    }

    .option.positive:hover {
        background: #ecfdf5;
    }

    .option.negative {
        color: #dc2626;
    }

    .option.negative:hover {
        background: #fef2f2;
    }

    /* Effects Grid */
    .effects-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        border-top: 1px solid #e5e7eb;
    }

    .effects-column {
        display: flex;
        flex-direction: column;
    }

    .effects-column:first-child {
        border-right: 1px solid #e5e7eb;
    }

    .effects-column .option {
        border-radius: 0;
        border-bottom: 1px solid #f3f4f6;
    }

    .effects-column .option:last-child {
        border-bottom: none;
    }

    /* Notes */
    .notes-section {
        margin-top: 0.75rem;
        padding-top: 0.75rem;
        border-top: 1px solid #e5e7eb;
    }

    .notes-section textarea {
        width: 100%;
        padding: 0.5rem;
        border: 2px solid #e5e7eb;
        border-radius: 6px;
        font-size: 0.75rem;
        resize: vertical;
        min-height: 60px;
        transition: all 0.2s ease;
    }

    .notes-section textarea:focus {
        outline: none;
        border-color: #3b82f6;
        box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
    }

    /* Responsive */
    @media (max-width: 1200px) {
        .genes-grid {
            grid-template-columns: repeat(2, 1fr);
        }
    }

    @media (max-width: 768px) {
        .genes-grid {
            grid-template-columns: 1fr;
            gap: 0.75rem;
        }

        .gene-card {
            padding: 0.75rem;
        }

        .gene-fields {
            gap: 0.5rem;
        }
    }
</style>
