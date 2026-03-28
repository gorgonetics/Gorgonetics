<script>
    import { activeTab, appState } from "$lib/stores/pets.js";
    import logoImg from '$lib/assets/logo.png';

    function switchTab(tab) {
        appState.switchTab(tab);
    }
</script>

<header class="top-bar">
    <div class="top-bar-left">
        <img src={logoImg} alt="Gorgonetics" class="app-logo" />
        <span class="app-name">Gorgonetics</span>
    </div>
    <div class="top-bar-tabs">
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
    </div>
</header>

<style>
    .top-bar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        height: 48px;
        padding: 0 16px;
        background: #ffffff;
        border-bottom: 1px solid #e5e7eb;
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
        color: #111827;
        letter-spacing: -0.025em;
    }

    .top-bar-tabs {
        display: flex;
        gap: 4px;
        background: #f3f4f6;
        border-radius: 8px;
        padding: 3px;
    }

    .tab-btn {
        padding: 6px 16px;
        border: none;
        border-radius: 6px;
        background: transparent;
        color: #6b7280;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.15s ease;
    }

    .tab-btn:hover {
        color: #374151;
        background: #e5e7eb;
    }

    .tab-btn.active {
        background: #ffffff;
        color: #111827;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
    }
</style>
