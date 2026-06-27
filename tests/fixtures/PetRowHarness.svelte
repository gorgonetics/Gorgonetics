<script lang="ts">
/** Test harness: renders PetRow with a `trailing` snippet so the slot
 * (and its click-isolation from row activation) can be asserted. */
import PetRow from '$lib/components/shared/PetRow.svelte';

interface Props {
  name: string;
  meta?: string;
  selectable?: boolean;
  selected?: boolean;
  active?: boolean;
  density?: 'card' | 'row';
  onActivate?: () => void;
  onToggleSelect?: () => void;
  onTrailing?: () => void;
}
const { onTrailing, ...rest }: Props = $props();
</script>

<PetRow {...rest}>
  {#snippet trailing()}
    <button type="button" data-testid="harness-trailing-btn" onclick={() => onTrailing?.()}>★</button>
  {/snippet}
</PetRow>
