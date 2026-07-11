<script lang="ts">
/**
 * One empty / prompt state for the whole app — a thin full-height wrapper
 * around StatusPane's `hero` look. Every caller passes context-appropriate
 * copy, so an empty state always explains what *this* surface needs.
 * See docs/design/redesign-library-workspace-v1.md.
 */
import StatusPane from '$lib/components/shared/StatusPane.svelte';

interface Props {
  /** Optional decorative glyph (emoji). Omit for a text-only state. */
  icon?: string;
  /** Short, specific headline — what to do, not an apology. */
  title: string;
  /** Optional one-line elaboration. */
  body?: string;
  /** Optional call to action. Both label and handler are required to show it. */
  actionLabel?: string;
  onAction?: () => void;
}

const { icon, title, body, actionLabel, onAction }: Props = $props();
/** StatusPane's action props are all-or-nothing; only forward a complete pair. */
const action = $derived(actionLabel && onAction ? { actionLabel, onAction } : {});
</script>

<div class="empty-state" data-testid="empty-state">
  <StatusPane variant="empty" hero {icon} {title} {body} {...action} />
</div>

<style>
  .empty-state {
    height: 100%;
    display: grid;
    place-items: center;
    padding: 32px;
  }
</style>
