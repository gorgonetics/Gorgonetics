<script>
import { onDestroy } from 'svelte';
import { run, stopPropagation } from 'svelte/legacy';
import * as configService from '$lib/services/configService.js';
import * as geneService from '$lib/services/geneService.js';

/**
 * @typedef {Object} Props
 * @property {string} [animalType] - Props from parent
 * @property {string} [chromosome]
 */

/** @type {Props} */
const { animalType = '', chromosome = '' } = $props();

// State
let genes = $state([]);
let effectOptions = $state([]);
let loadingGenes = $state(false);
let successMessage = $state('');
let errorMessage = $state('');
let successTimer = null;
let expandedNotes = $state({});
let openDropdown = $state(null);
let originalGenes = [];

const negativeOptions = $derived(effectOptions.filter((opt) => opt.includes('-')).sort());
const positiveOptions = $derived(effectOptions.filter((opt) => opt.includes('+')).sort());

const EFFECT_TYPES = [
  { label: 'Dominant', field: 'effectDominant', key: 'dominant' },
  { label: 'Recessive', field: 'effectRecessive', key: 'recessive' },
];
let hasUnsavedChanges = $state(false);
let savingChanges = $state(false);

onDestroy(() => clearTimeout(successTimer));

async function loadEffectOptions() {
  if (!animalType) return;
  try {
    effectOptions = configService.getEffectOptionsForSpecies(animalType);
  } catch {
    effectOptions = configService.getEffectOptions();
  }
}

// Load genes for the selected chromosome
async function loadGenes() {
  if (!animalType || !chromosome) return;

  loadingGenes = true;
  errorMessage = '';

  try {
    genes = await geneService.getGenesByChromosome(animalType, chromosome);
    originalGenes = JSON.parse(JSON.stringify(genes));
    hasUnsavedChanges = false;
  } catch (err) {
    errorMessage = `Error loading genes: ${err instanceof Error ? err.message : String(err)}`;
  } finally {
    loadingGenes = false;
  }
}

// Save all changes
async function saveAllChanges() {
  if (!hasUnsavedChanges) return;

  savingChanges = true;
  errorMessage = '';
  successMessage = '';

  try {
    await geneService.updateGenesBulk(animalType, chromosome, genes);
    originalGenes = JSON.parse(JSON.stringify(genes));
    hasUnsavedChanges = false;
    successMessage = 'All changes saved successfully!';
    clearTimeout(successTimer);
    successTimer = setTimeout(() => {
      successMessage = '';
    }, 3000);
  } catch (err) {
    errorMessage = `Error saving changes: ${err instanceof Error ? err.message : String(err)}`;
  } finally {
    savingChanges = false;
  }
}

// Export chromosome to JSON file
async function exportChromosome() {
  if (!animalType || !chromosome) return;

  try {
    const data = await geneService.exportGenesToJson(animalType, chromosome);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${animalType}_genes_chr${chromosome}.json`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
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
    (gene.effectDominant || '') !== (original.effectDominant || '') ||
    (gene.effectRecessive || '') !== (original.effectRecessive || '') ||
    (gene.appearance || '') !== (original.appearance || '') ||
    (gene.notes || '') !== (original.notes || '')
  );
}

// Get effect class for styling
function getEffectClass(effect) {
  if (!effect || effect === 'None') return 'none';
  return effect.includes('+') ? 'positive' : effect.includes('-') ? 'negative' : 'none';
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
      if (dropdown?.classList.contains('dropdown')) {
        const rect = trigger.getBoundingClientRect();
        const dropdownHeight = dropdown.offsetHeight;
        const viewportHeight = window.innerHeight;

        if (rect.bottom + dropdownHeight > viewportHeight && rect.top > dropdownHeight) {
          dropdown.style.top = 'auto';
          dropdown.style.bottom = '100%';
          dropdown.style.marginTop = '0';
          dropdown.style.marginBottom = '0.25rem';
        }
      }
    }, 0);
  }
}

// Select option from dropdown
function selectOption(gene, field, value) {
  handleInputChange(gene, field, value === 'None' ? '' : value);
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

<div class="gene-editing-view">
    <div class="gene-editing-header">
        <div class="gene-editing-header-info">
            <h2 class="gene-editing-title">Gene Editor: {animalType} - {chromosome}</h2>
            <span class="gene-editing-count">{genes.length} genes</span>
        </div>
        <div class="gene-editing-actions">
            <button
                class="action-btn save-btn"
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
                class="action-btn export-btn"
                onclick={exportChromosome}
                title="Export chromosome as JSON"
            >
                Export
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
                            {#each EFFECT_TYPES as { label, field, key }}
                            <div class="field">
                                <!-- svelte-ignore a11y_label_has_associated_control -->
                                <label>{label}</label>
                                <div class="select-wrapper">
                                    <button
                                        class="select-trigger {getEffectClass(gene[field])}"
                                        onclick={stopPropagation((e) => toggleDropdown(gene.gene, key, e))}
                                    >
                                        {gene[field] || "None"}
                                        <span class="chevron">▼</span>
                                    </button>

                                    {#if openDropdown === `${gene.gene}-${key}`}
                                        <div class="dropdown">
                                            <button
                                                class="option none"
                                                onclick={stopPropagation(() => selectOption(gene, field, "None"))}
                                            >
                                                None
                                            </button>
                                            <div class="effects-grid">
                                                <div class="effects-column negative">
                                                    {#each negativeOptions as option (option)}
                                                        <button class="option negative" onclick={stopPropagation(() => selectOption(gene, field, option))}>{option}</button>
                                                    {/each}
                                                </div>
                                                <div class="effects-column positive">
                                                    {#each positiveOptions as option (option)}
                                                        <button class="option positive" onclick={stopPropagation(() => selectOption(gene, field, option))}>{option}</button>
                                                    {/each}
                                                </div>
                                            </div>
                                        </div>
                                    {/if}
                                </div>
                            </div>
                            {/each}

                            <!-- Appearance -->
                            <div class="field">
                                <label for="appearance-{gene.gene}">Appearance</label>
                                <input
                                    id="appearance-{gene.gene}"
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
    .gene-editing-view {
        display: flex;
        flex-direction: column;
        height: 100%;
        overflow: hidden;
    }

    .gene-editing-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 16px 20px;
        border-bottom: 1px solid #e5e7eb;
        background: #ffffff;
        flex-shrink: 0;
    }

    .gene-editing-title {
        font-size: 18px;
        font-weight: 700;
        color: #111827;
        margin: 0;
    }

    .gene-editing-count {
        font-size: 12px;
        color: #6b7280;
    }

    .gene-editing-actions {
        display: flex;
        gap: 8px;
    }

    .gene-editing-actions .action-btn {
        padding: 6px 14px;
        border: 1px solid #e5e7eb;
        border-radius: 6px;
        background: #ffffff;
        color: #374151;
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.15s;
    }

    .gene-editing-actions .save-btn:not(:disabled) {
        background: #3b82f6;
        border-color: #3b82f6;
        color: white;
    }

    .gene-editing-actions .action-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }

    .gene-editing-actions .action-btn:not(:disabled):hover {
        border-color: #9ca3af;
    }

    .view-btn {
        padding: 8px 16px;
        background: rgba(255, 255, 255, 0.1);
        border: 1px solid rgba(255, 255, 255, 0.2);
        border-radius: 6px;
        color: rgba(255, 255, 255, 0.8);
        font-size: 0.8rem;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s ease;
    }

    .view-btn:hover:not(:disabled) {
        background: rgba(255, 255, 255, 0.2);
        color: white;
    }

    .view-btn.active {
        background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%);
        border-color: #1d4ed8;
        color: white;
    }

    .view-btn:disabled {
        opacity: 0.6;
        cursor: not-allowed;
    }

    .gene-visualizer-container {
        flex: 1;
        width: 100%;
        min-height: 0;
        position: relative;
        padding: 1.5rem;
    }

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
        gap: 0.75rem;
        padding-bottom: 1.5rem;
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
    @media (min-width: 1800px) {
        .genes-grid {
            grid-template-columns: repeat(6, 1fr);
        }
    }

    @media (min-width: 1400px) and (max-width: 1799px) {
        .genes-grid {
            grid-template-columns: repeat(5, 1fr);
        }
    }

    @media (max-width: 1200px) {
        .genes-grid {
            grid-template-columns: repeat(3, 1fr);
        }
    }

    @media (max-width: 768px) {
        .genes-grid {
            grid-template-columns: 1fr;
            gap: 0.5rem;
        }

        .gene-card {
            padding: 0.75rem;
        }

        .gene-fields {
            gap: 0.5rem;
        }
    }
</style>
