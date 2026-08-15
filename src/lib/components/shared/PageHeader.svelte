<script lang="ts">
/**
 * One page-header pattern for the whole app. Today every view headers itself
 * differently — Pets/Genes have none, Stable a bare "Stable", Breed a big
 * "💞 Breeding Assistant" + subtitle, Community "Community catalogue" +
 * subtitle. This unifies them: an optional icon, a title, an optional
 * subtitle, and a right-aligned `actions` slot for controls.
 * See docs/design/redesign-library-workspace-v1.md.
 */
import type { Snippet } from 'svelte';

interface Props {
  /**
   * Page title. Optional: destinations whose name already appears in the nav
   * tab omit it to avoid the redundant repeat, leaving just the subtitle and/or
   * the actions row as the (slimmer) header band.
   */
  title?: string;
  subtitle?: string;
  /** Optional decorative glyph (emoji) before the title. */
  icon?: string;
  /** Right-aligned controls (buttons, toggles, badges). */
  actions?: Snippet;
  /**
   * Let `actions` take the full band width instead of hugging the right edge.
   * For destinations whose header *is* a control row (My Pets' FilterBar)
   * rather than a title with a few buttons beside it.
   */
  wide?: boolean;
}

const { title, subtitle, icon, actions, wide = false }: Props = $props();
</script>

<header class="page-header" data-testid="page-header">
  {#if title || subtitle}
    <div class="ph-text">
      {#if title}
        <h2 class="ph-title">
          {#if icon}<span class="ph-icon" aria-hidden="true">{icon}</span>{/if}
          {title}
        </h2>
      {/if}
      {#if subtitle}
        <p class="ph-subtitle" data-testid="page-header-subtitle">{subtitle}</p>
      {/if}
    </div>
  {/if}
  {#if actions}
    <div class="ph-actions" class:ph-actions-wide={wide} data-testid="page-header-actions">
      {@render actions()}
    </div>
  {/if}
</header>

<style>
  .page-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-xl);
    padding: var(--space-sm) var(--space-2xl);
    border-bottom: 1px solid var(--border-primary);
    background: var(--bg-primary);
    flex-shrink: 0;
  }
  .ph-text { min-width: 0; }
  .ph-title {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    margin: 0;
    font-size: 15px;
    font-weight: 700;
    color: var(--text-primary);
  }
  .ph-icon { font-size: 15px; line-height: 1; }
  .ph-subtitle { margin: 1px 0 0; font-size: 11.5px; color: var(--text-tertiary); }
  /* Controls can wrap under the title on narrow widths without forcing the band
     taller than needed on wide ones. */
  .ph-actions { display: flex; align-items: center; flex-wrap: wrap; justify-content: flex-end; gap: var(--space-sm); flex-shrink: 0; }
  /* `wide`: the control row IS the band, so it grows and starts at the left. */
  .ph-actions-wide { flex: 1; min-width: 0; justify-content: flex-start; }
</style>
