<script>
  import { onMount } from 'svelte';
  import { authStore, isAuthenticated, isLoading, user } from '../stores/authStore.js';
  import { apiClient } from '../services/apiClient.js';
  import LoginForm from './LoginForm.svelte';
  import RegisterForm from './RegisterForm.svelte';

  let authMode = 'login'; // 'login' or 'register'

  onMount(async () => {
    // Initialize authentication on app startup
    await authStore.initialize();
    
    // Set the token in the API client if user is authenticated
    if ($isAuthenticated) {
      const token = authStore.getAccessToken();
      apiClient.setAuthToken(token);
    }
  });

  function switchToRegister() {
    authMode = 'register';
    authStore.clearError();
  }

  function switchToLogin() {
    authMode = 'login';
    authStore.clearError();
  }

  function handleAuthSuccess() {
    // Set the token in the API client for future requests
    const token = authStore.getAccessToken();
    apiClient.setAuthToken(token);
  }

  async function handleLogout() {
    await authStore.logout();
    apiClient.setAuthToken(null);
  }
</script>

{#if $isLoading}
  <div class="loading-screen">
    <div class="loading-spinner"></div>
    <p>Loading...</p>
  </div>
{:else if $isAuthenticated}
  <!-- User is authenticated - show the main app content -->
  <div class="authenticated-header">
    <div class="user-info">
      <span>Welcome, {$user?.username || 'User'}!</span>
      {#if $user?.role === 'admin'}
        <span class="admin-badge">Admin</span>
      {/if}
    </div>
    <button class="logout-btn" on:click={handleLogout}>
      Logout
    </button>
  </div>
  <slot />
{:else}
  <!-- User is not authenticated - show login/register forms -->
  <div class="auth-container">
    {#if authMode === 'login'}
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
  </div>
{/if}

<style>
  .loading-screen {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100vh;
    background-color: #f8fafc;
  }

  .loading-spinner {
    width: 40px;
    height: 40px;
    border: 4px solid #e5e7eb;
    border-top: 4px solid #3b82f6;
    border-radius: 50%;
    animation: spin 1s linear infinite;
    margin-bottom: 1rem;
  }

  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }

  .loading-screen p {
    color: #6b7280;
    font-size: 1.1rem;
  }

  .auth-container {
    min-height: 100vh;
    background-color: #f8fafc;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .authenticated-header {
    position: sticky;
    top: 0;
    background: white;
    border-bottom: 1px solid #e5e7eb;
    padding: 1rem 1.5rem;
    display: flex;
    justify-content: space-between;
    align-items: center;
    z-index: 1000;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  }

  .user-info {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    font-weight: 500;
    color: #374151;
  }

  .admin-badge {
    background-color: #dc2626;
    color: white;
    font-size: 0.75rem;
    font-weight: 600;
    padding: 0.25rem 0.5rem;
    border-radius: 9999px;
    text-transform: uppercase;
    letter-spacing: 0.025em;
  }

  .logout-btn {
    background-color: #6b7280;
    color: white;
    padding: 0.5rem 1rem;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.875rem;
    font-weight: 500;
    transition: background-color 0.2s;
  }

  .logout-btn:hover {
    background-color: #4b5563;
  }
</style>