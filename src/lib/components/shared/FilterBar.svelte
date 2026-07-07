<script lang="ts">
/**
 * One filter bar for the Library. Unifies the divergent filter vocabularies
 * the app uses today — per-card text, segmented species toggles, breed
 * dropdowns vs. button rows, and a mix of pills and `<select>`s — into a
 * single control language: a search box, a segmented species toggle, the
 * shared BreedSelector, and toggle pills for boolean flags.
 * See docs/design/redesign-library-workspace-v1.md.
 *
 * Fully controlled: the parent owns the filter state and gets a callback per
 * change. Every section is optional — omit a prop and that control disappears,
 * so the same bar serves species-scoped and species-agnostic surfaces.
 */
import BreedSelector from '$lib/components/shared/BreedSelector.svelte';

interface FlagSpec {
  key: string;
  label: string;
  active: boolean;
}

interface Props {
  search: string;
  onSearch: (value: string) => void;
  searchPlaceholder?: string;
  /** Species options (e.g. ['beewasp','horse']); omit to hide the toggle. */
  species?: string[];
  /** Active species; '' means "all". */
  activeSpecies?: string;
  onSpecies?: (value: string) => void;
  allSpeciesLabel?: string;
  /** Breed name→abbreviation map; omit to hide the breed control. */
  breeds?: Record<string, string>;
  breed?: string;
  onBreed?: (value: string) => void;
  /** Gender options (e.g. ['Male','Female']); omit to hide the gender toggle. */
  genders?: string[];
  /** Active gender; '' means "all". */
  activeGender?: string;
  onGender?: (value: string) => void;
  /** Available tags to filter by; omit to hide the tag pills. */
  tagOptions?: string[];
  /** Currently-active tags (AND semantics). */
  activeTags?: string[];
  onToggleTag?: (tag: string) => void;
  /** Toggle pills (starred, stabled, pet-quality). */
  flags?: FlagSpec[];
  onToggleFlag?: (key: string) => void;
}

const {
  search,
  onSearch,
  searchPlaceholder = 'Search pets…',
  species,
  activeSpecies = '',
  onSpecies,
  allSpeciesLabel = 'All',
  breeds,
  breed = '',
  onBreed,
  genders,
  activeGender = '',
  onGender,
  tagOptions,
  activeTags = [],
  onToggleTag,
  flags,
  onToggleFlag,
}: Props = $props();
</script>

<div class="filter-bar" data-testid="filter-bar">
  <input
    type="search"
    class="fb-search"
    data-testid="filter-search"
    placeholder={searchPlaceholder}
    value={search}
    oninput={(e) => onSearch(e.currentTarget.value)}
  />

  {#if species && species.length > 0}
    <div class="fb-seg" role="group" aria-label="Species" data-testid="filter-species">
      <button
        type="button"
        class="fb-seg-btn"
        class:active={activeSpecies === ''}
        aria-pressed={activeSpecies === ''}
        data-species=""
        onclick={() => onSpecies?.('')}
      >{allSpeciesLabel}</button>
      {#each species as sp (sp)}
        <button
          type="button"
          class="fb-seg-btn"
          class:active={activeSpecies === sp}
          aria-pressed={activeSpecies === sp}
          data-species={sp}
          onclick={() => onSpecies?.(sp)}
        >{sp}</button>
      {/each}
    </div>
  {/if}

  {#if breeds}
    <BreedSelector value={breed} {breeds} onChange={(v) => onBreed?.(v)} />
  {/if}

  {#if genders && genders.length > 0}
    <div class="fb-seg" role="group" aria-label="Gender" data-testid="filter-gender">
      <button
        type="button"
        class="fb-seg-btn"
        class:active={activeGender === ''}
        aria-pressed={activeGender === ''}
        data-gender=""
        onclick={() => onGender?.('')}
      >All</button>
      {#each genders as g (g)}
        <button
          type="button"
          class="fb-seg-btn"
          class:active={activeGender === g}
          aria-pressed={activeGender === g}
          data-gender={g}
          onclick={() => onGender?.(g)}
        >{g}</button>
      {/each}
    </div>
  {/if}

  {#if flags && flags.length > 0}
    <div class="fb-flags" data-testid="filter-flags">
      {#each flags as flag (flag.key)}
        <button
          type="button"
          class="fb-pill"
          class:active={flag.active}
          aria-pressed={flag.active}
          data-flag={flag.key}
          onclick={() => onToggleFlag?.(flag.key)}
        >{flag.label}</button>
      {/each}
    </div>
  {/if}

  {#if tagOptions && tagOptions.length > 0}
    <div class="fb-flags" data-testid="filter-tags">
      {#each tagOptions as tag (tag)}
        <button
          type="button"
          class="fb-pill"
          class:active={activeTags.includes(tag)}
          aria-pressed={activeTags.includes(tag)}
          data-tag={tag}
          onclick={() => onToggleTag?.(tag)}
        >🏷️ {tag}</button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .filter-bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }

  .fb-search {
    flex: 0 1 220px;
    min-width: 140px;
    padding: 6px 10px;
    border: 1px solid var(--border-primary);
    border-radius: 7px;
    background: var(--bg-secondary);
    color: var(--text-primary);
    font-size: 12px;
  }
  .fb-search::placeholder { color: var(--text-muted); }
  .fb-search:focus { outline: none; border-color: var(--accent); background: var(--bg-primary); }

  .fb-seg { display: inline-flex; background: var(--bg-tertiary); border-radius: 7px; padding: 2px; }
  .fb-seg-btn {
    border: none;
    background: transparent;
    color: var(--text-tertiary);
    font-size: 11px;
    font-weight: 600;
    padding: 4px 10px;
    border-radius: 5px;
    cursor: pointer;
    text-transform: capitalize;
  }
  .fb-seg-btn:hover { color: var(--text-secondary); }
  .fb-seg-btn.active { background: var(--bg-primary); color: var(--text-primary); box-shadow: var(--shadow-sm, 0 1px 2px rgba(0, 0, 0, 0.06)); }

  .fb-flags { display: flex; flex-wrap: wrap; gap: 4px; }
  .fb-pill {
    border: 1px solid var(--border-primary);
    background: var(--bg-primary);
    color: var(--text-tertiary);
    font-size: 11px;
    font-weight: 600;
    padding: 4px 9px;
    border-radius: 999px;
    cursor: pointer;
  }
  .fb-pill:hover { border-color: var(--accent); color: var(--accent); }
  .fb-pill.active { background: var(--accent); border-color: var(--accent); color: #fff; }
</style>
