<script lang="ts">
// Lightweight stand-in for PetEditor so PetActions tests don't pull the real
// editor's config/store dependencies. Mirrors the `open` prop it is bound to.
const { open = false }: { open?: boolean } = $props();
</script>

{#if open}<div data-testid="pet-editor-stub">editor open</div>{/if}
