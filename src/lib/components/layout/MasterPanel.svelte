<script>
import GeneEditor from '$lib/components/gene/GeneEditor.svelte';
import PetList from '$lib/components/pet/PetList.svelte';
import { activeTab } from '$lib/stores/pets.js';
</script>

<aside class="master-panel">
    {#if $activeTab === "pets"}
        <PetList />
    {:else if $activeTab === "editor"}
        <div class="gene-editor-wrapper">
            <GeneEditor />
        </div>
    {/if}
</aside>

<style>
    .master-panel {
        width: 260px;
        border-right: 1px solid var(--border-primary);
        background: var(--bg-secondary);
        display: flex;
        flex-direction: column;
        flex-shrink: 0;
        height: 100%;
        overflow: hidden;
    }

    .gene-editor-wrapper {
        padding: 16px;
        overflow-y: auto;
        flex: 1;
    }
</style>
