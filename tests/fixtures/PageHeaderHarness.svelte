<script lang="ts">
/** Test harness: renders PageHeader with an `actions` snippet so the slot
 * can be asserted without hand-rolling createRawSnippet in the test. */
import PageHeader from '$lib/components/shared/PageHeader.svelte';

interface Props {
  title?: string;
  subtitle?: string;
  icon?: string;
  wide?: boolean;
}
const { title, subtitle, icon, wide }: Props = $props();
</script>

<PageHeader {title} {subtitle} {icon} {wide}>
  {#snippet actions()}
    <button type="button" data-testid="harness-action">Do thing</button>
  {/snippet}
</PageHeader>
