<script lang="ts">
/**
 * One pet row for the whole app, in two densities. Replaces the five divergent
 * pet renderings (Pets sidebar card, Compare picker, Stable table row, Breed
 * pair row, Community table row) that each had their own markup, selection,
 * and action affordances. See docs/design/redesign-library-workspace-v1.md.
 *
 * Generic by composition: the row owns the avatar, name, meta line, optional
 * multi-select checkbox, and activation; everything source-specific (star,
 * action icons, +Genes score, uploaded date) goes in the `trailing` snippet so
 * the local library and the community catalogue can reuse the same row.
 */
import type { Snippet } from 'svelte';

interface Props {
  name: string;
  /** Decorative glyph (species emoji). */
  avatar?: string;
  /** Subtitle line, e.g. "Horse · Standardbred · Female". Hidden in row density. */
  meta?: string;
  density?: 'card' | 'row';
  /** Show the multi-select checkbox. */
  selectable?: boolean;
  selected?: boolean;
  /** Highlight as the currently-open row (master-detail current item). */
  active?: boolean;
  onActivate?: () => void;
  onToggleSelect?: () => void;
  /** Right-aligned, source-specific content (star, actions, score, date). */
  trailing?: Snippet;
}

const {
  name,
  avatar,
  meta,
  density = 'card',
  selectable = false,
  selected = false,
  active = false,
  onActivate,
  onToggleSelect,
  trailing,
}: Props = $props();

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    onActivate?.();
  }
}
</script>

<div
  class="pet-row density-{density}"
  class:selected
  class:active
  data-testid="pet-row"
  role="button"
  tabindex="0"
  aria-current={active ? 'true' : undefined}
  onclick={() => onActivate?.()}
  onkeydown={onKeydown}
>
  {#if selectable}
    <input
      type="checkbox"
      class="pr-select"
      data-testid="pet-row-select"
      checked={selected}
      aria-label="Select {name}"
      onclick={(e) => e.stopPropagation()}
      onchange={() => onToggleSelect?.()}
    />
  {/if}

  {#if avatar}
    <span class="pr-avatar" aria-hidden="true">{avatar}</span>
  {/if}

  <span class="pr-main">
    <span class="pr-name">{name}</span>
    {#if meta}<span class="pr-meta">{meta}</span>{/if}
  </span>

  {#if trailing}
    <!-- Isolate trailing actions (star, icons) from row activation, for both
         pointer and keyboard, so clicking/Entering an action doesn't open the row. -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <span
      class="pr-trailing"
      data-testid="pet-row-trailing"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => e.stopPropagation()}
    >
      {@render trailing()}
    </span>
  {/if}
</div>

<style>
  .pet-row {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    text-align: left;
    background: var(--bg-primary);
    border: 1px solid var(--border-primary);
    border-radius: 9px;
    padding: 9px 10px;
    cursor: pointer;
    transition: border-color 0.12s, background 0.12s;
  }
  .pet-row:hover { background: var(--bg-hover); }
  .pet-row:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  .pet-row.selected { border-color: var(--accent); background: var(--bg-selected); }
  .pet-row.active { border-color: var(--accent); background: var(--bg-selected); }

  /* Compact table density: no card chrome, thinner, no meta line. */
  .pet-row.density-row {
    border: none;
    border-bottom: 1px solid var(--border-primary);
    border-radius: 0;
    padding: 7px 10px;
    gap: 8px;
  }
  .density-row .pr-avatar { font-size: 13px; }
  .density-row .pr-meta { display: none; }

  .pr-select { width: 15px; height: 15px; accent-color: var(--accent); flex-shrink: 0; }
  .pr-avatar {
    width: 30px; height: 30px; flex-shrink: 0;
    display: grid; place-items: center;
    background: var(--bg-tertiary); border-radius: 7px; font-size: 16px;
  }
  .density-row .pr-avatar { width: 22px; height: 22px; border-radius: 5px; }

  .pr-main { min-width: 0; flex: 1; display: flex; flex-direction: column; }
  .pr-name {
    display: block; font-size: 13px; font-weight: 600; color: var(--text-primary);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .pr-meta {
    display: block; font-size: 11px; color: var(--text-tertiary);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }

  .pr-trailing { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }
</style>
