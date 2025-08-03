<script>
    import {
        selectedPet,
        loading,
        error,
        geneEditingView,
        appState,
    } from "../stores/appState.js";
    import PetVisualization from "./PetVisualization.svelte";
    import GeneEditingView from "./GeneEditingView.svelte";

    function getWelcomeMessage() {
        return {
            title: "Pet Management",
            subtitle: "Upload and manage your Project Gorgon pet genome files",
            icon: "🐾",
        };
    }

    $: welcomeMessage =
        !$selectedPet && !$geneEditingView ? getWelcomeMessage() : null;
</script>

<div class="app-main">
    <!-- Error Display -->
    {#if $error}
        <div class="error-banner" role="alert">
            <span class="error-icon">⚠️</span>
            <span class="error-text">{$error}</span>
            <button class="error-close" on:click={() => appState.clearError()}
                >×</button
            >
        </div>
    {/if}

    <!-- Loading State -->
    {#if $loading}
        <div class="loading-state">
            <div class="loading-spinner"></div>
            <p>Loading...</p>
        </div>
        <!-- Welcome/Empty State -->
    {:else if welcomeMessage}
        <div class="welcome-state">
            <div class="welcome-icon">{welcomeMessage.icon}</div>
            <h2 class="welcome-title">{welcomeMessage.title}</h2>
            <p class="welcome-subtitle">{welcomeMessage.subtitle}</p>
        </div>
        <!-- Pet Visualization -->
    {:else if $selectedPet}
        <PetVisualization pet={$selectedPet} />
        <!-- Gene Editing View -->
    {:else if $geneEditingView}
        <GeneEditingView
            animalType={$geneEditingView.animalType}
            chromosome={$geneEditingView.chromosome}
        />
    {/if}
</div>

<style>
    .app-main {
        flex: 1;
        background-color: #f8fafc;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        height: 100%;
        min-height: 0;
        padding: 1.5rem;
    }

    .app-main:has(.pet-visualization),
    .app-main:has(.gene-editing-view) {
        padding: 0;
    }

    .error-banner {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding: 1rem;
        margin-bottom: 1.5rem;
        background-color: #fef2f2;
        border: 1px solid #fecaca;
        border-radius: 8px;
        color: #dc2626;
    }

    .error-icon {
        font-size: 1.25rem;
        flex-shrink: 0;
    }

    .error-text {
        flex: 1;
        font-size: 0.875rem;
    }

    .error-close {
        background: none;
        border: none;
        font-size: 1.5rem;
        cursor: pointer;
        color: #dc2626;
        line-height: 1;
        padding: 0;
        width: 24px;
        height: 24px;
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .error-close:hover {
        background-color: rgba(220, 38, 38, 0.1);
        border-radius: 4px;
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

    .loading-state p {
        color: #6b7280;
        font-style: italic;
        margin: 0;
    }

    .welcome-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 4rem 2rem;
        text-align: center;
        min-height: 400px;
    }

    .welcome-icon {
        font-size: 4rem;
        margin-bottom: 1rem;
        opacity: 0.7;
    }

    .welcome-title {
        font-size: 2rem;
        font-weight: 700;
        color: #111827;
        margin: 0 0 0.5rem 0;
    }

    .welcome-subtitle {
        font-size: 1.125rem;
        color: #6b7280;
        margin: 0 0 2rem 0;
        max-width: 500px;
    }

    /* Shared Visualization Styles */
    :global(.pet-visualization) {
        flex: 1;
        overflow-y: auto;
        min-height: 0;
        height: 100%;
        display: flex;
        flex-direction: column;
    }

    :global(.visualization-header) {
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

    :global(.visualization-title) {
        font-size: 1.25rem;
        font-weight: 700;
        color: white;
        margin: 0;
    }

    :global(.visualization-stats) {
        display: flex;
        gap: 1rem;
        align-items: center;
        flex: 1;
    }

    :global(.stat-item) {
        font-size: 0.8rem;
        color: rgba(255, 255, 255, 0.8);
    }

    :global(.unknown-indicator) {
        color: #f59e0b;
        font-weight: 600;
        font-size: 0.8rem;
    }

    :global(.view-controls) {
        display: flex;
        gap: 4px;
    }

    :global(.view-btn) {
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

    :global(.view-btn:hover) {
        background: rgba(255, 255, 255, 0.2);
        color: white;
    }

    :global(.view-btn.active) {
        background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%);
        border-color: #1d4ed8;
        color: white;
    }

    :global(.view-btn:disabled) {
        opacity: 0.6;
        cursor: not-allowed;
    }

    :global(.gene-visualizer-container) {
        flex: 1;
        width: 100%;
        min-height: 0;
        position: relative;
        contain: layout style;
        padding: 1.5rem;
    }

    @media (max-width: 768px) {
        .app-main {
            padding: 1rem;
        }

        .app-main:has(.pet-visualization),
        .app-main:has(.gene-editing-view) {
            padding: 0;
        }

        .welcome-state {
            padding: 2rem 1rem;
        }

        .welcome-title {
            font-size: 1.5rem;
        }

        .welcome-subtitle {
            font-size: 1rem;
        }

        :global(.visualization-header) {
            padding: 1rem;
            flex-direction: column;
            gap: 1rem;
            align-items: stretch;
        }

        :global(.gene-visualizer-container) {
            padding: 0.75rem;
        }
    }
</style>
