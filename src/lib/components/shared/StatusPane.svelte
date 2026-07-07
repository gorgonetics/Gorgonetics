<script lang="ts">
/**
 * Centered loading / empty / error pane. Shared shape across the tab
 * surfaces (Stable, Compare, Community, Breeding…). The `loading`
 * variant renders the global `.spinner` (24px). `error` variant gets
 * `role="alert"` for accessibility.
 *
 * `hero` is the prominent empty-state look (bigger icon/title, primary
 * action) used by the EmptyState wrapper for whole-surface prompts;
 * the default compact look serves inline loading/error strips.
 */
/** The optional action button is all-or-nothing: label and handler travel together. */
type ActionProps = { actionLabel: string; onAction: () => void } | { actionLabel?: undefined; onAction?: undefined };

type Props = {
  /** Pane variant. */
  variant?: 'loading' | 'empty' | 'error';
  /** Prominent whole-surface styling (larger icon/title, primary action). */
  hero?: boolean;
  /** Optional emoji/character above the text (ignored when variant='loading'). */
  icon?: string;
  /** Bold one-liner. */
  title?: string;
  /** Descriptive paragraph. */
  body?: string;
} & ActionProps;

const { variant = 'empty', hero = false, icon, title, body, actionLabel, onAction }: Props = $props();
</script>

<div
  class="status-pane"
  class:status-pane-error={variant === 'error'}
  class:status-pane-hero={hero}
  role={variant === 'error' ? 'alert' : undefined}
  data-testid="status-pane"
>
  {#if variant === 'loading'}
    <div class="spinner"></div>
  {:else if icon}
    <div class="status-icon" data-testid="status-pane-icon" aria-hidden="true">{icon}</div>
  {/if}
  <!-- Hero titles are headings (as EmptyState's h3 was) so SR users can jump
       to the whole-surface prompt; h3 sits under a destination PageHeader's
       h2. Compact loading/error strips stay plain text. -->
  {#if title}
    <svelte:element this={hero ? 'h3' : 'p'} class="status-title">{title}</svelte:element>
  {/if}
  {#if body}<p class="status-body">{body}</p>{/if}
  {#if actionLabel && onAction}
    <button
      type="button"
      class="btn {hero ? 'btn-primary' : 'btn-secondary'}"
      data-testid="status-pane-action"
      onclick={onAction}
    >
      {actionLabel}
    </button>
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

  /* Hero: whole-surface prompt (via EmptyState). */
  .status-pane-hero {
    max-width: 380px;
    gap: 6px;
  }
  .status-pane-hero .status-icon {
    font-size: 40px;
    line-height: 1;
    opacity: 0.55;
    margin-bottom: 6px;
  }
  .status-pane-hero .status-title {
    font-size: 16px;
    color: var(--text-secondary);
  }
  .status-pane-hero .status-body {
    font-size: 13px;
    color: var(--text-muted);
  }
  .status-pane-hero .btn {
    margin-top: 12px;
  }
</style>
