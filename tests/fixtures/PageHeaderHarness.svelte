<script lang="ts">
/** Test harness: renders PageHeader with an `actions` snippet so the slot
 * can be asserted without hand-rolling createRawSnippet in the test. */
import PageHeader from '$lib/components/shared/PageHeader.svelte';

interface Props {
  title: string;
  subtitle?: string;
  icon?: string;
}
const { title, subtitle, icon }: Props = $props();
</script>

<PageHeader {title} {subtitle} {icon}>
  {#snippet actions()}
    <button type="button" data-testid="harness-action">Do thing</button>
  {/snippet}
</PageHeader>
