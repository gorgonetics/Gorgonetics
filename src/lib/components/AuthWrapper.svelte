<script>
  import { onMount } from 'svelte';
  import { authStore, isAuthenticated, isLoading, user } from '$lib/stores/auth.js';
  import { apiClient } from '$lib/services/api.js';
  import LoginForm from '$lib/components/forms/LoginForm.svelte';
  import RegisterForm from '$lib/components/forms/RegisterForm.svelte';

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
{:else}
  <!-- Always show the main app content, authentication is now optional -->
  <slot {authMode} {switchToLogin} {switchToRegister} {handleAuthSuccess} />
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

</style>