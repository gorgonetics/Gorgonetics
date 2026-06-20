<script lang="ts">
import { ArrowLeft } from '@lucide/svelte';
import logoImg from '$lib/assets/logo.png';
import { activeTab, appState, canGoBack, type Tab } from '$lib/stores/pets.js';
import DataMenu from './DataMenu.svelte';
import SettingsModal from './SettingsModal.svelte';

function switchTab(tab: Tab) {
  appState.switchTab(tab);
}

function handleWindowKeydown(e: KeyboardEvent) {
  // Alt+Left → previous tab. Don't hijack it while the user is typing.
  if (!(e.altKey && e.key === 'ArrowLeft')) return;
  const t = e.target as HTMLElement | null;
  if (t?.tagName === 'INPUT' || t?.tagName === 'TEXTAREA' || t?.isContentEditable) return;
  e.preventDefault();
  appState.goBack();
}

function handleMouseUp(e: MouseEvent) {
  // Mouse "back" button (button 3) → previous tab. goBack is a no-op
  // when there's no history, so an unconditional call is safe.
  if (e.button === 3) {
    e.preventDefault();
    appState.goBack();
  }
}
</script>

<svelte:window onkeydown={handleWindowKeydown} onmouseup={handleMouseUp} />

<header class="top-bar">
    <div class="top-bar-left">
        <img src={logoImg} alt="Gorgonetics" class="app-logo" />
        <span class="app-name">Gorgonetics</span>
    </div>
    <div class="top-bar-right">
    <button
        class="back-btn"
        onclick={() => appState.goBack()}
        disabled={!$canGoBack}
        title="Back to previous tab (Alt+←)"
        aria-label="Back to previous tab"
    >
        <ArrowLeft size={16} />
    </button>
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
        <button
            class="tab-btn"
            class:active={$activeTab === "stable"}
            onclick={() => switchTab("stable")}
        >
            📋 Stable
        </button>
        <button
            class="tab-btn"
            class:active={$activeTab === "breeding"}
            onclick={() => switchTab("breeding")}
        >
            💞 Breed
        </button>
        <button
            class="tab-btn"
            class:active={$activeTab === "compare"}
            onclick={() => switchTab("compare")}
        >
            ⚖️ Compare
        </button>
        <button
            class="tab-btn"
            class:active={$activeTab === "community"}
            data-testid="tab-community"
            onclick={() => switchTab("community")}
        >
            🌐 Community
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

    .back-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 30px;
        height: 30px;
        border: none;
        border-radius: 6px;
        background: var(--bg-tertiary);
        color: var(--text-secondary);
        cursor: pointer;
        transition: all 0.15s ease;
    }

    .back-btn:hover:not(:disabled) {
        color: var(--text-primary);
        background: var(--border-primary);
    }

    .back-btn:disabled {
        opacity: 0.35;
        cursor: default;
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
