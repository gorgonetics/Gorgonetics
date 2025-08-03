<script>
    import { onMount } from "svelte";
    import { apiClient } from "../services/apiClient.js";
    import { appState } from "../stores/appState.js";

    let selectedAnimalType = "";
    let selectedChromosome = "";
    let animalTypes = [];
    let chromosomes = [];
    let loadingChromosomes = false;
    let editorError = "";

    onMount(async () => {
        try {
            animalTypes = await apiClient.getAnimalTypes();
        } catch (err) {
            console.error("Failed to load animal types:", err);
            editorError = "Failed to load animal types";
        }
    });

    async function loadChromosomes() {
        if (!selectedAnimalType) return;

        try {
            loadingChromosomes = true;
            editorError = "";
            chromosomes = await apiClient.getChromosomes(selectedAnimalType);
            selectedChromosome = "";
            // Clear any existing gene editing view
            appState.clearGeneEditingView();
        } catch (err) {
            console.error("Failed to load chromosomes:", err);
            editorError = "Failed to load chromosomes";
        } finally {
            loadingChromosomes = false;
        }
    }

    async function openGeneEditor() {
        if (!selectedAnimalType || !selectedChromosome) return;

        try {
            // Set the gene editing view in the main content
            appState.setGeneEditingView({
                animalType: selectedAnimalType,
                chromosome: selectedChromosome,
            });
        } catch (err) {
            console.error("Failed to open gene editor:", err);
            editorError = "Failed to open gene editor";
        }
    }

    $: if (selectedAnimalType) loadChromosomes();
</script>

<div class="gene-editor-controls">
    <div class="form-group">
        <label for="animalType">Animal Type:</label>
        <select
            id="animalType"
            bind:value={selectedAnimalType}
            disabled={loadingChromosomes}
        >
            <option value="">Select animal type...</option>
            {#each animalTypes as type}
                <option value={type}>{type}</option>
            {/each}
        </select>
    </div>

    <div class="form-group">
        <label for="chromosome">Chromosome:</label>
        <select
            id="chromosome"
            bind:value={selectedChromosome}
            disabled={loadingChromosomes || !selectedAnimalType}
        >
            <option value="">Select chromosome...</option>
            {#each chromosomes as chromosome}
                <option value={chromosome}>{chromosome}</option>
            {/each}
        </select>
    </div>

    <div class="form-group">
        <button
            class="load-btn"
            on:click={openGeneEditor}
            disabled={!selectedAnimalType ||
                !selectedChromosome ||
                loadingChromosomes}
        >
            {loadingChromosomes ? "Loading..." : "Edit Genes"}
        </button>
    </div>

    {#if editorError}
        <div class="error-message">
            <span class="error-icon">⚠️</span>
            {editorError}
        </div>
    {/if}
</div>

<style>
    .gene-editor-controls {
        display: flex;
        flex-direction: column;
        gap: 1rem;
    }

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

    .form-group select {
        padding: 0.5rem;
        border: 1px solid #d1d5db;
        border-radius: 6px;
        font-size: 0.875rem;
        background: white;
    }

    .form-group select:focus {
        outline: none;
        border-color: #3b82f6;
        box-shadow: 0 0 0 1px #3b82f6;
    }

    .form-group select:disabled {
        background-color: #f9fafb;
        color: #9ca3af;
    }

    .load-btn {
        padding: 0.5rem 1rem;
        background-color: #3b82f6;
        color: white;
        border: none;
        border-radius: 6px;
        font-size: 0.875rem;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s ease;
    }

    .load-btn:hover:not(:disabled) {
        background-color: #2563eb;
    }

    .load-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }

    .error-message {
        padding: 0.5rem;
        border-radius: 6px;
        background-color: #fef2f2;
        color: #dc2626;
        border: 1px solid #fecaca;
        display: flex;
        align-items: center;
        gap: 0.5rem;
        font-size: 0.875rem;
    }
</style>
