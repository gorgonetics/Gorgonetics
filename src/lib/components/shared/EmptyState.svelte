<script lang="ts">
/**
 * One empty / prompt state for the whole app. Replaces the ad-hoc paw-print
 * "Select a pet to view details" markup that was copy-pasted across views —
 * including onto the Genes tab, where it described the wrong thing. Every
 * caller passes context-appropriate copy, so an empty state always explains
 * what *this* surface needs. See docs/design/redesign-library-workspace-v1.md.
 */

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
const hasAction = $derived(!!actionLabel && !!onAction);
</script>

<div class="empty-state" data-testid="empty-state">
  <div class="es-inner">
    {#if icon}
      <div class="es-icon" data-testid="empty-state-icon" aria-hidden="true">{icon}</div>
    {/if}
    <h3 class="es-title">{title}</h3>
    {#if body}
      <p class="es-body">{body}</p>
    {/if}
    {#if hasAction}
      <button type="button" class="es-action" data-testid="empty-state-action" onclick={onAction}>
        {actionLabel}
      </button>
    {/if}
  </div>
</div>

<style>
  .empty-state {
    height: 100%;
    display: grid;
    place-items: center;
    padding: 32px;
    text-align: center;
  }
  .es-inner { max-width: 380px; display: flex; flex-direction: column; align-items: center; gap: 6px; }
  .es-icon { font-size: 40px; line-height: 1; opacity: 0.55; margin-bottom: 6px; }
  .es-title { font-size: 16px; font-weight: 600; color: var(--text-secondary); margin: 0; }
  .es-body { font-size: 13px; color: var(--text-muted); margin: 0; }
  .es-action {
    margin-top: 12px;
    padding: 7px 16px;
    border: none;
    border-radius: var(--radius-md);
    background: var(--accent);
    color: var(--text-inverse);
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
  }
  .es-action:hover { background: var(--accent-hover); }
</style>
