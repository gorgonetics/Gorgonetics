<script lang="ts">
/**
 * One breed control for the whole app. A compact popover trigger
 * ("Breed: All ▾") that opens a single-select list of breeds (name +
 * abbreviation). Replaces the dropdowns and 11-wide button rows that
 * previously diverged across the Stable filter, pet gene grid, comparison
 * diff controls, and the trio view. See docs/design/redesign-library-workspace-v1.md.
 *
 * Generic: `breeds` is a name→abbreviation map passed by the caller, so the
 * same control serves filters (single-select breed) and lenses (offspring
 * breed) without knowing about any species.
 */
import { onDestroy, onMount } from 'svelte';

interface Props {
  /** Currently selected breed name; '' means "all / no filter". */
  value: string;
  /** Breed name → abbreviation, e.g. `HORSE_BREEDS`. */
  breeds: Record<string, string>;
  /** Trigger prefix, e.g. "Breed" or "Offspring breed". */
  label?: string;
  /** Label for the "no filter" option. */
  allLabel?: string;
  /** Greys out the trigger and suppresses the popover (e.g. Compare's Auto
   *  mode owns the breed). The current value still shows on the trigger. */
  disabled?: boolean;
  onChange: (value: string) => void;
}

const { value, breeds, label = 'Breed', allLabel = 'All', disabled = false, onChange }: Props = $props();

let open = $state(false);
let root = $state<HTMLDivElement | undefined>();

const entries = $derived(Object.entries(breeds));
const currentLabel = $derived(value === '' ? allLabel : value);

function choose(next: string): void {
  open = false;
  if (next !== value) onChange(next);
}

function onDocClick(e: MouseEvent): void {
  if (open && root && !root.contains(e.target as Node)) open = false;
}

function onKeydown(e: KeyboardEvent): void {
  if (open && e.key === 'Escape') {
    open = false;
    e.stopPropagation();
  }
}

onMount(() => {
  document.addEventListener('click', onDocClick);
  document.addEventListener('keydown', onKeydown);
});

onDestroy(() => {
  document.removeEventListener('click', onDocClick);
  document.removeEventListener('keydown', onKeydown);
});
</script>

<div class="breed-selector" data-testid="breed-selector" bind:this={root}>
  <button
    type="button"
    class="bs-trigger"
    data-testid="breed-selector-trigger"
    aria-haspopup="true"
    aria-expanded={open}
    {disabled}
    onclick={(e) => { if (disabled) return; e.stopPropagation(); open = !open; }}
  >
    <span class="bs-label">{label}:</span>
    <strong class="bs-value">{currentLabel}</strong>
    <span class="bs-caret" aria-hidden="true">▾</span>
  </button>

  {#if open}
    <div class="bs-pop" data-testid="breed-selector-pop" role="group" aria-label={label}>
      <button
        type="button"
        class="bs-opt"
        class:sel={value === ''}
        aria-pressed={value === ''}
        data-breed=""
        onclick={() => choose('')}
      >
        <span class="bs-tick" aria-hidden="true">{value === '' ? '✓' : ''}</span>
        <span class="bs-name">{allLabel}</span>
      </button>
      {#each entries as [name, abbrev] (name)}
        <button
          type="button"
          class="bs-opt"
          class:sel={value === name}
          aria-pressed={value === name}
          data-breed={name}
          onclick={() => choose(name)}
        >
          <span class="bs-tick" aria-hidden="true">{value === name ? '✓' : ''}</span>
          <span class="bs-name">{name}</span>
          <span class="bs-ab">{abbrev}</span>
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .breed-selector { position: relative; display: inline-block; }

  .bs-trigger {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    border: 1px solid var(--border-primary);
    border-radius: 7px;
    background: var(--bg-primary);
    color: var(--text-secondary);
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
  }
  .bs-trigger:hover:not(:disabled) { border-color: var(--border-secondary); }
  .bs-trigger:disabled { opacity: 0.5; cursor: default; }

  .bs-label { color: var(--text-tertiary); }
  .bs-value { color: var(--text-secondary); }
  .bs-caret { color: var(--text-muted); font-size: 9px; }

  .bs-pop {
    position: absolute;
    top: calc(100% + 5px);
    left: 0;
    z-index: 30;
    min-width: 180px;
    max-height: 260px;
    overflow: auto;
    padding: 5px;
    background: var(--bg-primary);
    border: 1px solid var(--border-primary);
    border-radius: 9px;
    box-shadow: var(--shadow-md, 0 4px 14px rgba(0, 0, 0, 0.1));
  }

  .bs-opt {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 9px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--text-secondary);
    font-size: 12px;
    text-align: left;
    cursor: pointer;
  }
  .bs-opt:hover { background: var(--bg-hover); }
  .bs-opt.sel { color: var(--accent-text, var(--accent)); font-weight: 600; }

  .bs-tick { width: 12px; flex-shrink: 0; color: var(--accent); }
  .bs-name { flex: 1; }
  .bs-ab {
    color: var(--text-muted);
    font-size: 10px;
    font-family: var(--mono, ui-monospace, monospace);
    margin-left: auto;
  }
</style>
