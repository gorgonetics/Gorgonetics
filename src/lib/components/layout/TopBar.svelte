<script>
import logoImg from '$lib/assets/logo.png';
import { activeTab, appState } from '$lib/stores/pets.js';
import DataMenu from './DataMenu.svelte';
import SettingsModal from './SettingsModal.svelte';

function switchTab(tab) {
  appState.switchTab(tab);
}
</script>

<header class="top-bar">
    <div class="top-bar-left">
        <img src={logoImg} alt="Gorgonetics" class="app-logo" />
        <span class="app-name">Gorgonetics</span>
    </div>
    <div class="top-bar-right">
    <nav aria-label="Main navigation" class="top-bar-tabs">
        <button
            class="tab-btn"
            class:active={$activeTab === "pets"}
            onclick={() => switchTab("pets")}
        >
            🐾 Pets
        </button>
        <button
            class="tab-btn"
            class:active={$activeTab === "editor"}
            onclick={() => switchTab("editor")}
        >
            🧬 Genes
        </button>
    </nav>
    <DataMenu />
    <SettingsModal />
    </div>
</header>

<style>
    .top-bar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        height: 48px;
        padding: 0 16px;
        background: var(--bg-primary);
        border-bottom: 1px solid var(--border-primary);
        flex-shrink: 0;
    }

    .top-bar-left {
        display: flex;
        align-items: center;
        gap: 10px;
    }

    .app-logo {
        width: 28px;
        height: 28px;
        border-radius: 6px;
    }

    .app-name {
        font-size: 16px;
        font-weight: 700;
        color: var(--text-primary);
        letter-spacing: -0.025em;
    }

    .top-bar-right {
        display: flex;
        align-items: center;
        gap: 12px;
    }

    .top-bar-tabs {
        display: flex;
        gap: 4px;
        background: var(--bg-tertiary);
        border-radius: 8px;
        padding: 3px;
    }

    .tab-btn {
        padding: 6px 16px;
        border: none;
        border-radius: 6px;
        background: transparent;
        color: var(--text-tertiary);
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.15s ease;
    }

    .tab-btn:hover {
        color: var(--text-secondary);
        background: var(--border-primary);
    }

    .tab-btn.active {
        background: var(--bg-primary);
        color: var(--text-primary);
        box-shadow: var(--shadow-sm);
    }
</style>
