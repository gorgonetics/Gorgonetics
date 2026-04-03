<script>
import '../app.css';
import AuthWrapper from '$lib/components/AuthWrapper.svelte';
import MasterPanel from '$lib/components/layout/MasterPanel.svelte';
import TopBar from '$lib/components/layout/TopBar.svelte';

const { children } = $props();
</script>

<AuthWrapper>
    <div class="app-shell">
        <TopBar />
        <div class="app-body">
            <MasterPanel />
            <main class="detail-pane">
                {@render children()}
            </main>
        </div>
    </div>
</AuthWrapper>

<style>
    .app-shell {
        display: flex;
        flex-direction: column;
        height: 100%;
    }

    .app-body {
        display: flex;
        flex: 1;
        min-height: 0;
    }

    .detail-pane {
        flex: 1;
        overflow: hidden;
        background: #ffffff;
        min-width: 0;
        position: relative;
    }
</style>
