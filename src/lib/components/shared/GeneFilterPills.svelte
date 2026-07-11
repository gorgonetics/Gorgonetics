<script lang="ts" module>
export interface FilterPillItem {
  /** Stable key used by the tri-state filter (attribute/appearance key). */
  key: string;
  /** Visible label. */
  name: string;
  /** Emoji/icon shown before the name (attributes). */
  icon?: string;
  /** Colour swatch shown before the name (appearances). */
  swatch?: string;
  /** Tooltip; defaults to `name`. */
  title?: string;
}
</script>

<script lang="ts">
/**
 * One tri-state focus/hide filter row for the genome grids. A reset ("All")
 * pill plus one pill per category: click to focus, Ctrl/⌘+click to multi-select,
 * Alt+click to hide. The pill set previously lived (identically) in both the
 * Compare diff controls and the Trio view; this is the single shared surface.
 * See docs/design/redesign-library-workspace-v1.md (§3, component unification).
 *
 * Presentational only — the caller owns the selected/hidden arrays and the
 * triStateToggle logic, so the same row serves attributes (icon) and
 * appearances (colour swatch).
 */
interface Props {
  /** Row label, e.g. "Attribute" or "Appearance". */
  label: string;
  items: FilterPillItem[];
  selected: string[];
  hidden: string[];
  onToggle: (key: string, ctrlKey: boolean, altKey: boolean) => void;
  onReset: () => void;
  /** Optional interaction hint rendered under the row. */
  hint?: string;
  testid?: string;
}

const { label, items, selected, hidden, onToggle, onReset, hint, testid }: Props = $props();

const allActive = $derived(selected.length === 0 && hidden.length === 0);
</script>

<div class="gfp" data-testid={testid}>
  <div class="gfp-row" role="group" aria-label={label}>
    <span class="gfp-label">{label}:</span>
    <button type="button" class="gfp-btn" class:active={allActive} aria-pressed={allActive} onclick={onReset}>All</button>
    {#each items as item (item.key)}
      <button
        type="button"
        class="gfp-btn"
        class:active={selected.includes(item.key)}
        class:hidden-pill={hidden.includes(item.key)}
        aria-pressed={hidden.includes(item.key) ? 'mixed' : selected.includes(item.key)}
        style:--swatch-color={item.swatch}
        onclick={(e) => onToggle(item.key, e.ctrlKey || e.metaKey, e.altKey)}
        title={item.title ?? item.name}
      >
        <!-- Swatch wins when defined (incl. ""→grey fallback, matching the
             appearance grid); otherwise an icon. Both are their own flex item so
             the row gap spaces them from the label identically. -->
        {#if item.swatch != null}<span class="gfp-swatch"></span>{:else if item.icon}<span class="gfp-icon" aria-hidden="true">{item.icon}</span>{/if}{item.name}
      </button>
    {/each}
    {#if hint}<span class="gfp-hint">{hint}</span>{/if}
  </div>
</div>

<style>
  .gfp { display: flex; flex-direction: column; }
  .gfp-row { display: flex; align-items: center; gap: 3px; flex-wrap: wrap; padding: 0 4px; }
  .gfp-label { font-size: 11px; font-weight: 600; color: var(--text-tertiary); margin-right: 4px; }
  .gfp-btn {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 3px 8px;
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-sm);
    background: var(--bg-primary);
    color: var(--text-tertiary);
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s;
    white-space: nowrap;
  }
  .gfp-btn:hover { border-color: var(--border-secondary); color: var(--text-secondary); }
  .gfp-btn.active { background: var(--accent); border-color: var(--accent); color: var(--text-inverse); }
  .gfp-btn.hidden-pill {
    background: var(--error-bg);
    border-color: var(--error-border);
    color: var(--error-text);
    text-decoration: line-through;
  }
  .gfp-swatch {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--swatch-color, #6b7280);
    border: 1px solid rgba(0, 0, 0, 0.2);
  }
  .gfp-hint { font-size: 10px; color: var(--text-muted); font-style: italic; margin-left: 6px; }
</style>
