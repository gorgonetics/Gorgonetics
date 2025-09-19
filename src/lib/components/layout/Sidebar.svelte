<script>
    import { apiClient } from "$lib/services/api.js";
    import { activeTab, appState, error } from "$lib/stores/pets.js";
    import { authStore, isAuthenticated, user } from "$lib/stores/auth.js";
    import { Modal } from "flowbite-svelte";
    import GeneEditor from "$lib/components/gene/GeneEditor.svelte";
    import LoginForm from "$lib/components/forms/LoginForm.svelte";
    import PetUpload from "$lib/components/forms/PetUploadForm.svelte";
    import RegisterForm from "$lib/components/forms/RegisterForm.svelte";

    /** @type {{ sidebarCollapsed?: boolean, toggleSidebar: Function }} */
    const { sidebarCollapsed = false, toggleSidebar } = $props();

    function switchTab(tab) {
        appState.switchTab(tab);
    }

    async function handleLogout() {
        await authStore.logout();
        apiClient.setAuthToken(null);
    }

    // Auth modal functionality for anonymous users
    let showAuthModalDialog = $state(false);
    let authModalMode = $state("login");

    function showAuthModal(mode) {
        authModalMode = mode;
        showAuthModalDialog = true;
    }

    function hideAuthModal() {
        showAuthModalDialog = false;
    }

    function handleAuthSuccess() {
        // Set the token in the API client for future requests
        const token = authStore.getAccessToken();
        apiClient.setAuthToken(token);
        hideAuthModal();
    }

    function switchToRegister() {
        authModalMode = "register";
        authStore.clearError();
    }

    function switchToLogin() {
        authModalMode = "login";
        authStore.clearError();
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
                    {#if $isAuthenticated}
                        <PetUpload />
                    {:else}
                        <div class="auth-required-message">
                            <div class="auth-required-icon">🔒</div>
                            <h3>Sign In Required</h3>
                            <p>
                                To upload and manage your pets, please sign in
                                to your account.
                            </p>
                            <button
                                class="quick-signin-btn"
                                onclick={() => showAuthModal("login")}
                            >
                                <span class="auth-icon">🔑</span>
                                Sign In
                            </button>
                        </div>
                    {/if}
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

    <!-- User Info Section -->
    {#if !sidebarCollapsed}
        {#if $isAuthenticated}
            <div class="user-section">
                <div class="user-info">
                    <div class="user-avatar">
                        <span class="user-icon">👤</span>
                    </div>
                    <div class="user-details">
                        <div class="username">{$user?.username || "User"}</div>
                        {#if $user?.role === "admin"}
                            <div class="user-role admin">Admin</div>
                        {:else}
                            <div class="user-role">User</div>
                        {/if}
                    </div>
                </div>
                <button
                    class="logout-btn"
                    onclick={handleLogout}
                    title="Logout"
                >
                    <span class="logout-icon">🚪</span>
                    <span class="logout-text">Logout</span>
                </button>
            </div>
        {:else}
            <div class="auth-section">
                <div class="guest-info">
                    <div class="guest-avatar">
                        <span class="guest-icon">👋</span>
                    </div>
                    <div class="guest-details">
                        <div class="guest-title">Welcome!</div>
                        <div class="guest-subtitle">EXPLORE GORGONETICS</div>
                    </div>
                </div>
                <div class="auth-buttons">
                    <button
                        class="login-btn"
                        onclick={() => showAuthModal("login")}
                        title="Sign In"
                    >
                        <span class="auth-icon">🔑</span>
                        <span class="auth-text">Sign In</span>
                    </button>
                    <button
                        class="register-btn"
                        onclick={() => showAuthModal("register")}
                        title="Create Account"
                    >
                        <span class="auth-icon">✨</span>
                        <span class="auth-text">Sign Up</span>
                    </button>
                </div>
            </div>
        {/if}
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

<!-- Auth Modal for Anonymous Users -->
<Modal bind:open={showAuthModalDialog} size="md" autoclose outsideclose>
    <div
        slot="header"
        class="flex items-center text-lg font-semibold text-gray-900 dark:text-white"
    >
        {authModalMode === "login" ? "Sign In" : "Create Account"}
    </div>

    {#if authModalMode === "login"}
        <LoginForm
            on:loginSuccess={handleAuthSuccess}
            on:switchToRegister={switchToRegister}
        />
    {:else}
        <RegisterForm
            on:registerSuccess={handleAuthSuccess}
            on:switchToLogin={switchToLogin}
        />
    {/if}
</Modal>

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

    /* Auth Required Message Styles */
    .auth-required-message {
        text-align: center;
        padding: 32px 20px;
        background: linear-gradient(135deg, #fef3c7 0%, #fcd34d 100%);
        border-radius: 12px;
        border: 2px dashed #f59e0b;
        margin: 16px 0;
    }

    .auth-required-icon {
        font-size: 48px;
        margin-bottom: 16px;
        opacity: 0.8;
    }

    .auth-required-message h3 {
        margin: 0 0 12px 0;
        font-size: 18px;
        font-weight: 600;
        color: #92400e;
    }

    .auth-required-message p {
        margin: 0 0 20px 0;
        font-size: 14px;
        color: #a16207;
        line-height: 1.5;
    }

    .quick-signin-btn {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 12px 24px;
        background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%);
        border: none;
        border-radius: 8px;
        color: white;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.3s ease;
        box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);
    }

    .quick-signin-btn:hover {
        background: linear-gradient(135deg, #2563eb 0%, #1e40af 100%);
        transform: translateY(-2px);
        box-shadow: 0 6px 16px rgba(59, 130, 246, 0.4);
    }

    .quick-signin-btn .auth-icon {
        font-size: 16px;
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

    .logout-btn {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 8px 12px;
        background: rgba(239, 68, 68, 0.1);
        border: 1px solid rgba(239, 68, 68, 0.2);
        border-radius: 6px;
        color: #fca5a5;
        font-size: 12px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.3s ease;
        align-self: flex-start;
    }

    .logout-btn:hover {
        background: rgba(239, 68, 68, 0.2);
        border-color: rgba(239, 68, 68, 0.3);
        color: #f87171;
    }

    .logout-icon {
        font-size: 14px;
    }

    .logout-text {
        white-space: nowrap;
    }

    /* Auth Section (Guest) Styles */
    .auth-section {
        padding: 16px 24px;
        border-top: 1px solid rgba(255, 255, 255, 0.1);
        background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
        display: flex;
        flex-direction: column;
        gap: 12px;
        margin-top: auto;
        flex-shrink: 0;
    }

    .guest-info {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-bottom: 8px;
    }

    .guest-avatar {
        width: 40px;
        height: 40px;
        background: linear-gradient(135deg, #10b981 0%, #059669 100%);
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        box-shadow: 0 4px 12px rgba(16, 185, 129, 0.4);
        border: 2px solid rgba(255, 255, 255, 0.1);
    }

    .guest-icon {
        color: white !important;
        font-size: 20px;
        filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.3));
    }

    .guest-details {
        flex: 1;
        min-width: 0;
    }

    .guest-title {
        font-size: 14px;
        font-weight: 600;
        color: white !important;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
        margin-bottom: 2px;
        line-height: 1.2;
    }

    .guest-subtitle {
        font-size: 11px;
        color: rgba(255, 255, 255, 0.8) !important;
        text-transform: uppercase;
        letter-spacing: 0.8px;
        font-weight: 500;
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
    }

    .auth-buttons {
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    .login-btn,
    .register-btn {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px 16px;
        border: 1px solid rgba(255, 255, 255, 0.2);
        border-radius: 8px;
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.3s ease;
        text-align: center;
        width: 100%;
        justify-content: center;
        backdrop-filter: blur(10px);
        position: relative;
        z-index: 1;
    }

    .login-btn {
        background: rgba(59, 130, 246, 0.1);
        border-color: rgba(59, 130, 246, 0.3);
        color: #93c5fd;
    }

    .login-btn:hover {
        background: rgba(59, 130, 246, 0.2);
        border-color: rgba(59, 130, 246, 0.4);
        color: #dbeafe;
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(59, 130, 246, 0.2);
    }

    .register-btn {
        background: rgba(16, 185, 129, 0.1);
        border-color: rgba(16, 185, 129, 0.3);
        color: #6ee7b7;
    }

    .register-btn:hover {
        background: rgba(16, 185, 129, 0.2);
        border-color: rgba(16, 185, 129, 0.4);
        color: #d1fae5;
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(16, 185, 129, 0.2);
    }

    .auth-icon {
        font-size: 14px;
    }

    .auth-text {
        white-space: nowrap;
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
