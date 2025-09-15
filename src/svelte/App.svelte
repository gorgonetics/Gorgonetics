<script>
  import { onMount } from 'svelte';
  import Sidebar from './lib/components/Sidebar.svelte';
  import MainContent from './lib/components/MainContent.svelte';
  import AuthWrapper from './lib/components/AuthWrapper.svelte';
  import { appState } from './lib/stores/appState.js';

  let sidebarCollapsed = $state(false);

  onMount(async () => {
    // Load pets for both authenticated and anonymous users
    await appState.loadPets();

    // Restore sidebar state from localStorage
    const savedState = localStorage.getItem('sidebarCollapsed');
    if (savedState !== null) {
      sidebarCollapsed = JSON.parse(savedState);
    }
  });

  // Reload pets when authentication status changes
  $effect(() => {
    appState.loadPets();
  });

  function toggleSidebar() {
    sidebarCollapsed = !sidebarCollapsed;
    localStorage.setItem('sidebarCollapsed', JSON.stringify(sidebarCollapsed));
  }
</script>

<AuthWrapper>
  <div class="app-layout" class:sidebar-collapsed={sidebarCollapsed}>
    <Sidebar {sidebarCollapsed} {toggleSidebar} />
    <MainContent />
  </div>
</AuthWrapper>

<style>
  :global(body) {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen',
      'Ubuntu', 'Cantarell', 'Open Sans', 'Helvetica Neue', sans-serif;
    background-color: #f8fafc;
  }

  .app-layout {
    display: flex;
    height: 100vh;
    overflow: hidden;
  }

  .app-layout.sidebar-collapsed {
    /* Styles for collapsed sidebar state */
  }

  :global(.loading) {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 2rem;
    color: #6b7280;
    font-style: italic;
  }

  :global(.error) {
    color: #dc2626;
    background-color: #fef2f2;
    border: 1px solid #fecaca;
    border-radius: 6px;
    padding: 0.75rem;
    margin: 0.5rem 0;
  }

  :global(.success) {
    color: #059669;
    background-color: #f0fdf4;
    border: 1px solid #bbf7d0;
    border-radius: 6px;
    padding: 0.75rem;
    margin: 0.5rem 0;
  }
</style>
