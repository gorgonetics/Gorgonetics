<script>
    import "../app.css";
    import AuthWrapper from "$lib/components/AuthWrapper.svelte";
    import Sidebar from "$lib/components/layout/Sidebar.svelte";
    import { onMount } from "svelte";

    const { children } = $props();
    let sidebarCollapsed = $state(false);

    onMount(() => {
        // Restore sidebar state from localStorage
        const savedState = localStorage.getItem("sidebarCollapsed");
        if (savedState !== null) {
            sidebarCollapsed = JSON.parse(savedState);
        }
    });

    function toggleSidebar() {
        sidebarCollapsed = !sidebarCollapsed;
        localStorage.setItem(
            "sidebarCollapsed",
            JSON.stringify(sidebarCollapsed),
        );
    }
</script>

<AuthWrapper>
    <div class="app-layout" class:sidebar-collapsed={sidebarCollapsed}>
        <Sidebar {sidebarCollapsed} {toggleSidebar} />
        <main class="flex-1 overflow-auto">
            {@render children()}
        </main>
    </div>
</AuthWrapper>


<style>
    .app-layout {
        display: flex;
        height: 100vh;
        overflow: hidden;
    }

    .app-layout.sidebar-collapsed {
        /* Styles for collapsed sidebar state */
    }
</style>
