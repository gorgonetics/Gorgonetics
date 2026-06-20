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
  title: string;
  subtitle?: string;
  /** Optional decorative glyph (emoji) before the title. */
  icon?: string;
  /** Right-aligned controls (buttons, toggles, badges). */
  actions?: Snippet;
}

const { title, subtitle, icon, actions }: Props = $props();
</script>

<header class="page-header" data-testid="page-header">
  <div class="ph-text">
    <h2 class="ph-title">
      {#if icon}<span class="ph-icon" aria-hidden="true">{icon}</span>{/if}
      {title}
    </h2>
    {#if subtitle}
      <p class="ph-subtitle" data-testid="page-header-subtitle">{subtitle}</p>
    {/if}
  </div>
  {#if actions}
    <div class="ph-actions" data-testid="page-header-actions">
      {@render actions()}
    </div>
  {/if}
</header>

<style>
  .page-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    padding: 14px 22px;
    border-bottom: 1px solid var(--border-primary);
    background: var(--bg-primary);
    flex-shrink: 0;
  }
  .ph-text { min-width: 0; }
  .ph-title {
    display: flex;
    align-items: center;
    gap: 9px;
    margin: 0;
    font-size: 18px;
    font-weight: 700;
    color: var(--text-primary);
  }
  .ph-icon { font-size: 18px; line-height: 1; }
  .ph-subtitle { margin: 2px 0 0; font-size: 12px; color: var(--text-tertiary); }
  .ph-actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
</style>
