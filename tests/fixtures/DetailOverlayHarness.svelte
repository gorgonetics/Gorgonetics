<script lang="ts">
/**
 * Test harness for DetailOverlay's document-level Escape handling: a base
 * overlay (A), an optional stacked overlay (B, mounted after A so it is the
 * topmost), and an optional fake true-modal (.modal-backdrop) that Escape
 * must defer to.
 */
import DetailOverlay from '$lib/components/shared/DetailOverlay.svelte';

interface Props {
  onBackA: () => void;
  onBackB?: () => void;
  showB?: boolean;
  showModal?: boolean;
}

const { onBackA, onBackB = () => {}, showB = false, showModal = false }: Props = $props();
</script>

<div class="host">
  <DetailOverlay onBack={onBackA} testid="overlay-a" backTestid="overlay-a-back">
    {#snippet title()}A{/snippet}
    <p>overlay A body</p>
  </DetailOverlay>

  {#if showB}
    <DetailOverlay onBack={onBackB} testid="overlay-b" backTestid="overlay-b-back">
      {#snippet title()}B{/snippet}
      <p>overlay B body</p>
    </DetailOverlay>
  {/if}

  {#if showModal}
    <div class="modal-backdrop" data-testid="fake-modal"><button type="button">ok</button></div>
  {/if}
</div>
