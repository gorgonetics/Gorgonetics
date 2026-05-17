<script>
/**
 * Centered loading / empty / error pane. Shared shape across the tab
 * surfaces (Stable, Compare, Community, Breeding…). The `loading`
 * variant renders the global `.spinner` (24px). `error` variant gets
 * `role="alert"` for accessibility.
 *
 * Props:
 *  - `variant`     — 'loading' | 'empty' | 'error'
 *  - `icon`        — optional emoji/character above the text
 *                    (ignored when variant='loading')
 *  - `title`       — bold one-liner; optional
 *  - `body`        — descriptive paragraph; optional
 *  - `actionLabel` — text on an optional secondary-button below the body
 *  - `onAction`    — click handler for the action button; required
 *                    alongside actionLabel
 */
const { variant = 'empty', icon, title, body, actionLabel, onAction } = $props();
</script>

<div
  class="status-pane"
  class:status-pane-error={variant === 'error'}
  role={variant === 'error' ? 'alert' : undefined}
  data-testid="status-pane"
>
  {#if variant === 'loading'}
    <div class="spinner"></div>
  {:else if icon}
    <div class="status-icon">{icon}</div>
  {/if}
  {#if title}<p class="status-title">{title}</p>{/if}
  {#if body}<p class="status-body">{body}</p>{/if}
  {#if actionLabel && onAction}
    <button class="btn btn-secondary" onclick={onAction}>{actionLabel}</button>
  {/if}
</div>

<style>
  .status-pane {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    padding: 32px 20px;
    text-align: center;
    color: var(--text-tertiary);
  }
  .status-pane-error {
    color: var(--text-primary);
  }
  .status-icon {
    font-size: 32px;
  }
  .status-title {
    margin: 0;
    font-size: 14px;
    color: var(--text-primary);
    font-weight: 600;
  }
  .status-body {
    margin: 0;
    font-size: 12px;
  }
</style>
