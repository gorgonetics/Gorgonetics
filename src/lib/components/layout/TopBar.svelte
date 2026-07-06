<script lang="ts">
import { ArrowLeft } from '@lucide/svelte';
import logoImg from '$lib/assets/logo.png';
import { activeTab, appState, canGoBack, type Tab } from '$lib/stores/pets.js';
import { uiActions } from '$lib/stores/ui.js';
import DataMenu from './DataMenu.svelte';

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
            class:active={$activeTab === "library"}
            data-testid="tab-library"
            onclick={() => switchTab("library")}
        >
            ✨ My Pets
        </button>
        <button
            class="tab-btn"
            class:active={$activeTab === "breed"}
            data-testid="tab-breed"
            onclick={() => switchTab("breed")}
        >
            💞 Breed
        </button>
        <button
            class="tab-btn"
            class:active={$activeTab === "community"}
            data-testid="tab-community"
            onclick={() => switchTab("community")}
        >
            🌐 Community
        </button>
        <button
            class="tab-btn"
            class:active={$activeTab === "reference"}
            data-testid="tab-reference"
            onclick={() => switchTab("reference")}
        >
            📚 Reference
        </button>
    </nav>
    <DataMenu />
    <button class="settings-toggle" onclick={() => uiActions.openSettings()} title="Settings" aria-label="Settings">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
            <circle cx="12" cy="12" r="3"/>
        </svg>
    </button>
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

    .settings-toggle {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 32px;
        height: 32px;
        border: none;
        border-radius: 6px;
        background: transparent;
        color: var(--text-tertiary);
        cursor: pointer;
        transition: all 0.15s ease;
    }

    .settings-toggle:hover {
        background: var(--bg-tertiary);
        color: var(--text-secondary);
    }
</style>
