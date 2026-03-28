<script>
    import { activeTab, appState, error } from "$lib/stores/pets.js";
    import GeneEditor from "$lib/components/gene/GeneEditor.svelte";
    import PetUpload from "$lib/components/forms/PetUploadForm.svelte";

    /** @type {{ sidebarCollapsed?: boolean, toggleSidebar: Function }} */
    const { sidebarCollapsed = false, toggleSidebar } = $props();

    function switchTab(tab) {
        appState.switchTab(tab);
    }
</script>

<div class="sidebar" class:collapsed={sidebarCollapsed}>
    <!-- Logo & Title -->
    <div class="sidebar-header">
        <div class="logo-section">
            <div class="logo-box">
                <span class="dna-emoji">🔬</span>
            </div>
            <div class="title-box" class:hidden={sidebarCollapsed}>
                <h1 class="gradient-text">Gorgonetics</h1>
                <p>Breeding Tool</p>
            </div>
        </div>

        <!-- Tab Navigation -->
        <div class="tab-container">
            <div class="tab-list">
                <button
                    class="tab"
                    class:active={$activeTab === "pets"}
                    onclick={() => switchTab("pets")}
                >
                    <span class="tab-icon">🐾</span>
                    {#if !sidebarCollapsed}
                        <span class="tab-text">Pet Manager</span>
                    {/if}
                </button>

                <button
                    class="tab"
                    class:active={$activeTab === "editor"}
                    onclick={() => switchTab("editor")}
                >
                    <span class="tab-icon">🧬</span>
                    {#if !sidebarCollapsed}
                        <span class="tab-text">Gene Editor</span>
                    {/if}
                </button>
            </div>
        </div>
    </div>

    <!-- Tool Controls Container -->
    {#if !sidebarCollapsed}
        <div class="sidebar-controls">
            <!-- Error Display -->
            {#if $error}
                <div class="error" role="alert">
                    {$error}
                    <button
                        class="error-close"
                        onclick={() => appState.clearError()}>×</button
                    >
                </div>
            {/if}

            <!-- Pet Management Panel -->
            {#if $activeTab === "pets"}
                <div class="tab-panel" role="tabpanel">
                    <PetUpload />
                </div>
            {/if}

            <!-- Gene Editor Panel -->
            {#if $activeTab === "editor"}
                <div class="tab-panel" role="tabpanel">
                    <GeneEditor />
                </div>
            {/if}
        </div>
    {/if}

    <!-- App Info Section -->
    {#if !sidebarCollapsed}
        <div class="user-section">
            <div class="user-info">
                <div class="user-avatar">
                    <span class="user-icon">🔬</span>
                </div>
                <div class="user-details">
                    <div class="username">Gorgonetics</div>
                    <div class="user-role">Desktop App</div>
                </div>
            </div>
        </div>
    {/if}

    <!-- Sidebar Footer with Toggle -->
    <div class="sidebar-footer">
        <button
            class="sidebar-toggle"
            onclick={toggleSidebar}
            title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
            <span class="toggle-icon">‹</span>
        </button>
    </div>
</div>

<style>
    .sidebar {
        width: 280px;
        background: linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%);
        box-shadow: 2px 0 8px rgba(0, 0, 0, 0.12);
        display: flex;
        flex-direction: column;
        transition: width 0.3s ease;
        position: relative;
        height: 100vh;
        overflow: hidden;
        flex-shrink: 0;
        contain: layout style;
    }

    .sidebar.collapsed {
        width: 80px;
    }

    .sidebar-header {
        background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
        color: white;
        padding: 0;
        border-bottom: none;
        flex-shrink: 0;
    }

    .logo-section {
        display: flex;
        align-items: center;
        gap: 16px;
        padding: 24px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        flex-shrink: 0;
        position: relative;
        transition: all 0.3s ease;
        margin-bottom: 0;
    }

    .logo-box {
        flex-shrink: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 60px;
        height: 60px;
        background: linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%);
        border-radius: 12px;
        box-shadow: 0 4px 14px 0 rgba(59, 130, 246, 0.3);
        border: none;
    }

    .dna-emoji {
        font-family:
            "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji",
            sans-serif;
        -webkit-text-fill-color: initial;
        color: white;
        background: none;
        font-size: 32px;
        animation: glow 3s ease-in-out infinite alternate;
    }

    @keyframes glow {
        0% {
            filter: drop-shadow(0 0 5px rgba(255, 255, 255, 0.3));
        }
        100% {
            filter: drop-shadow(0 0 10px rgba(255, 255, 255, 0.6));
        }
    }

    .title-box {
        flex: 1;
        text-align: left;
        min-width: 0;
        height: 48px;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        justify-content: center;
        transition: visibility 0.2s ease;
    }

    .title-box.hidden {
        visibility: hidden;
    }

    .gradient-text {
        font-size: 24px;
        margin: 0;
        font-weight: 700;
        line-height: 1.2;
        white-space: nowrap;
        background: linear-gradient(135deg, #60a5fa 0%, #a78bfa 100%);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
    }

    .title-box p {
        font-size: 12px;
        color: rgba(255, 255, 255, 0.7);
        font-weight: 500;
        letter-spacing: 0.5px;
        margin: 0;
        white-space: nowrap;
    }

    .tab-container {
        background: rgba(255, 255, 255, 0.05);
        transition: all 0.3s ease;
    }

    .tab-list {
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: 16px;
    }

    .tab {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 12px 16px;
        background: rgba(255, 255, 255, 0.1);
        border: 1px solid rgba(255, 255, 255, 0.2);
        border-radius: 8px;
        color: rgba(255, 255, 255, 0.8);
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.3s ease;
        text-align: left;
        width: 100%;
    }

    .tab:hover {
        background: rgba(255, 255, 255, 0.15);
        border-color: rgba(255, 255, 255, 0.3);
        color: white;
    }

    .tab.active {
        background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%);
        border-color: #1d4ed8;
        color: white;
        box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);
    }

    .sidebar-controls {
        flex: 1;
        padding: 24px;
        display: flex;
        flex-direction: column;
        gap: 20px;
        transition: all 0.3s ease;
        overflow-y: auto;
        min-height: 0;
    }

    .tab-panel {
        display: flex;
        flex-direction: column;
        gap: 1rem;
        padding: 0;
    }

    .error {
        position: relative;
        margin-bottom: 1rem;
    }

    .error-close {
        position: absolute;
        top: 0.5rem;
        right: 0.75rem;
        background: none;
        border: none;
        font-size: 1.25rem;
        cursor: pointer;
        color: #dc2626;
        line-height: 1;
    }

    /* User Section Styles */
    .user-section {
        padding: 16px 24px;
        border-top: 1px solid rgba(255, 255, 255, 0.1);
        background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
        display: flex;
        flex-direction: column;
        gap: 12px;
        margin-top: auto;
        flex-shrink: 0;
        position: relative;
        overflow: hidden;
    }

    .user-info {
        display: flex;
        align-items: center;
        gap: 12px;
        position: relative;
        z-index: 1;
    }

    .user-avatar {
        width: 40px;
        height: 40px;
        background: linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%);
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        box-shadow: 0 2px 8px rgba(59, 130, 246, 0.3);
    }

    .user-icon {
        font-size: 20px;
        color: white;
    }

    .user-details {
        flex: 1;
        min-width: 0;
    }

    .username {
        font-size: 14px;
        font-weight: 600;
        color: white;
        line-height: 1.2;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .user-role {
        font-size: 11px;
        color: rgba(255, 255, 255, 0.6);
        font-weight: 500;
        letter-spacing: 0.5px;
        text-transform: uppercase;
    }

    .user-role.admin {
        color: #fbbf24;
        font-weight: 600;
    }

    .sidebar-footer {
        padding: 20px;
        border-top: 1px solid rgba(255, 255, 255, 0.1);
        background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
        display: flex;
        justify-content: center;
        margin-top: auto;
        flex-shrink: 0;
        overflow: hidden;
    }

    .sidebar-toggle {
        width: 36px;
        height: 36px;
        background: rgba(255, 255, 255, 0.1);
        border: 1px solid rgba(255, 255, 255, 0.2);
        border-radius: 8px;
        color: rgba(255, 255, 255, 0.8);
        font-size: 16px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.3s ease;
        backdrop-filter: blur(10px);
        flex-shrink: 0;
    }

    .sidebar-toggle:hover {
        background: rgba(255, 255, 255, 0.2);
        color: white;
        border-color: rgba(255, 255, 255, 0.3);
    }

    .toggle-icon {
        transition: transform 0.3s ease;
        font-weight: bold;
    }

    .sidebar.collapsed .toggle-icon {
        transform: rotate(180deg);
    }
</style>
