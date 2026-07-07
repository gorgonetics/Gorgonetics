<script lang="ts">
import { ArrowLeft } from '@lucide/svelte';
import logoImg from '$lib/assets/logo.png';
import { activeTab, appState, canGoBack, type Tab } from '$lib/stores/pets.js';
import { overlayOpen, uiActions } from '$lib/stores/ui.js';
import DataMenu from './DataMenu.svelte';

// Destination navigation is gated (disabled) while a root overlay (Settings /
// pet editor) is open: switching the tab underneath would move the content and
// the nav highlight while the overlay stays on top, leaving the two in
// disagreement — and a nav click could silently discard editor changes (#396).
// Close the overlay (Back / Escape) first, then navigate.

function switchTab(tab: Tab) {
  if ($overlayOpen) return; // defence in depth — the buttons are also disabled
  appState.switchTab(tab);
}

function handleWindowKeydown(e: KeyboardEvent) {
  // Alt+Left → previous tab. Don't hijack it while the user is typing.
  if (!(e.altKey && e.key === 'ArrowLeft')) return;
  const t = e.target as HTMLElement | null;
  if (t?.tagName === 'INPUT' || t?.tagName === 'TEXTAREA' || t?.isContentEditable) return;
  // Always suppress the webview's own back gesture — even while the nav is
  // gated, Alt+Left must not navigate the app shell away.
  e.preventDefault();
  if ($overlayOpen) return; // nav is gated while a root overlay is open
  appState.goBack();
}

function handleMouseUp(e: MouseEvent) {
  // Mouse back/forward buttons (3/4): suppress the webview's history
  // navigation unconditionally so the app shell can't be navigated away,
  // then treat "back" as previous-tab — unless the nav is gated by an open
  // root overlay. goBack is a no-op without history, so the call is safe.
  if (e.button === 3 || e.button === 4) {
    e.preventDefault();
    if (e.button === 3 && !$overlayOpen) appState.goBack();
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
        disabled={!$canGoBack || $overlayOpen}
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
            disabled={$overlayOpen}
            onclick={() => switchTab("library")}
        >
            ✨ My Pets
        </button>
        <button
            class="tab-btn"
            class:active={$activeTab === "breed"}
            data-testid="tab-breed"
            disabled={$overlayOpen}
            onclick={() => switchTab("breed")}
        >
            💞 Breed
        </button>
        <button
            class="tab-btn"
            class:active={$activeTab === "community"}
            data-testid="tab-community"
            disabled={$overlayOpen}
            onclick={() => switchTab("community")}
        >
            🌐 Community
        </button>
        <button
            class="tab-btn"
            class:active={$activeTab === "reference"}
            data-testid="tab-reference"
            disabled={$overlayOpen}
            onclick={() => switchTab("reference")}
        >
            📚 Reference
        </button>
    </nav>
    <DataMenu />
    <button type="button" class="settings-toggle" disabled={$overlayOpen} onclick={() => uiActions.openSettings()} title="Settings" aria-label="Settings">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
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

    .tab-btn:hover:not(:disabled) {
        color: var(--text-secondary);
        background: var(--border-primary);
    }

    /* Gated while a root overlay (Settings / editor) is open. The active
       highlight stays visible so the current destination remains legible. */
    .tab-btn:disabled {
        opacity: 0.55;
        cursor: default;
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

    .settings-toggle:hover:not(:disabled) {
        background: var(--bg-tertiary);
        color: var(--text-secondary);
    }

    .settings-toggle:disabled {
        opacity: 0.4;
        cursor: default;
    }
</style>
