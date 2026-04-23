<script>
import ComparisonPetPicker from '$lib/components/comparison/ComparisonPetPicker.svelte';
import GeneEditor from '$lib/components/gene/GeneEditor.svelte';
import PetList from '$lib/components/pet/PetList.svelte';
import { activeTab } from '$lib/stores/pets.js';
import {
  commitSidebarWidth,
  MAX_WIDTH,
  MIN_WIDTH,
  setSidebarWidth,
  sidebar,
  toggleSidebar,
} from '$lib/stores/sidebar.svelte.js';

let dragging = $state(false);

$effect(() => {
  if (!dragging) return;
  let pendingX = null;
  let frame = 0;
  const onMove = (ev) => {
    pendingX = ev.clientX;
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (pendingX !== null) setSidebarWidth(pendingX);
    });
  };
  const onUp = () => {
    dragging = false;
    if (frame) cancelAnimationFrame(frame);
    commitSidebarWidth();
  };
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
  return () => {
    if (frame) cancelAnimationFrame(frame);
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
  };
});

function startDrag(e) {
  if (e.button !== 0) return;
  e.preventDefault();
  dragging = true;
}

function onHandleKeydown(e) {
  const step = e.shiftKey ? 32 : 8;
  if (e.key === 'ArrowLeft') {
    e.preventDefault();
    setSidebarWidth(sidebar.width - step);
    commitSidebarWidth();
  } else if (e.key === 'ArrowRight') {
    e.preventDefault();
    setSidebarWidth(sidebar.width + step);
    commitSidebarWidth();
  } else if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    toggleSidebar();
  }
}
</script>

{#if sidebar.collapsed}
    <button class="sidebar-rail" title="Expand sidebar" aria-label="Expand sidebar" onclick={toggleSidebar}>
        ›
    </button>
{:else}
    <aside class="master-panel" style:width="{sidebar.width}px">
        <button
            class="sidebar-collapse-btn"
            title="Collapse sidebar"
            aria-label="Collapse sidebar"
            onclick={toggleSidebar}
        >‹</button>
        {#if $activeTab === "pets"}
            <PetList />
        {:else if $activeTab === "editor"}
            <div class="gene-editor-wrapper">
                <GeneEditor />
            </div>
        {:else if $activeTab === "compare"}
            <ComparisonPetPicker />
        {/if}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
            class="resize-handle"
            class:dragging
            onmousedown={startDrag}
            onkeydown={onHandleKeydown}
            role="separator"
            aria-label="Resize sidebar"
            aria-orientation="vertical"
            aria-valuemin={MIN_WIDTH}
            aria-valuemax={MAX_WIDTH}
            aria-valuenow={sidebar.width}
            tabindex="0"
        ></div>
    </aside>
{/if}

<style>
    .master-panel {
        border-right: 1px solid var(--border-primary);
        background: var(--bg-secondary);
        display: flex;
        flex-direction: column;
        flex-shrink: 0;
        height: 100%;
        overflow: hidden;
        position: relative;
    }

    .gene-editor-wrapper {
        padding: 16px;
        overflow-y: auto;
        flex: 1;
    }

    .resize-handle {
        position: absolute;
        top: 0;
        right: -3px;
        width: 6px;
        height: 100%;
        cursor: col-resize;
        background: transparent;
        z-index: 20;
    }

    .resize-handle:hover,
    .resize-handle:focus-visible,
    .resize-handle.dragging {
        background: var(--accent);
        opacity: 0.5;
        outline: none;
    }

    .sidebar-collapse-btn {
        position: absolute;
        top: 6px;
        right: 6px;
        z-index: 15;
        width: 20px;
        height: 20px;
        padding: 0;
        border: 1px solid var(--border-primary);
        background: var(--bg-primary);
        color: var(--text-secondary);
        border-radius: 4px;
        font-size: 12px;
        line-height: 1;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .sidebar-collapse-btn:hover {
        background: var(--bg-tertiary);
        color: var(--text-primary);
    }

    .sidebar-rail {
        flex-shrink: 0;
        width: 14px;
        height: 100%;
        padding: 0;
        border: none;
        border-right: 1px solid var(--border-primary);
        background: var(--bg-secondary);
        color: var(--text-tertiary);
        font-size: 12px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .sidebar-rail:hover {
        background: var(--bg-tertiary);
        color: var(--text-primary);
    }
</style>
