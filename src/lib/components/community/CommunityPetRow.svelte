<script lang="ts">
import { selectPet } from '$lib/stores/community.svelte.js';
import type { SharedPet } from '$lib/types/index.js';
import { formatShortDate } from '$lib/utils/timestamp.js';

interface Props {
  pet: SharedPet;
  selected?: boolean;
}

const { pet, selected = false }: Props = $props();

const uploadedLabel = $derived(formatShortDate(pet.uploadedAt));

function handleClick() {
  selectPet(pet.contentHash);
}

function handleKey(e: KeyboardEvent) {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    selectPet(pet.contentHash);
  }
}
</script>

<!--
  Selection on a real `<tr>` under a `role="grid"` parent (see
  CommunityPetTable). `role="row"` is explicit for the grid context;
  each cell gets `role="gridcell"` so screen readers announce the
  grid structure + selection state instead of seeing the row as an
  opaque container (a previous revision spelled `role="button"` on
  the `<tr>` which silently dropped the row's table-row semantics).
  `aria-selected` carries the visual selection; the row stays
  tabbable and Enter/Space-activatable.
-->
<tr
  class="row"
  class:selected
  data-testid="community-row"
  data-content-hash={pet.contentHash}
  tabindex="0"
  aria-selected={selected}
  onclick={handleClick}
  onkeydown={handleKey}
>
  <td role="gridcell" class="cell-name">{pet.name || '(unnamed)'}</td>
  <td role="gridcell" class="cell-character">{pet.character || '—'}</td>
  <td role="gridcell" class="cell-species">{pet.species || '—'}</td>
  <td role="gridcell" class="cell-tags">
    {#each pet.tags as t (t)}
      <span class="tag-badge">{t}</span>
    {/each}
  </td>
  <td role="gridcell" class="cell-uploaded">{uploadedLabel}</td>
</tr>

<style>
  .row {
    cursor: pointer;
    transition: background 0.1s ease;
  }
  .row:hover {
    background: var(--bg-hover, var(--bg-secondary));
  }
  .row.selected {
    background: var(--bg-selected);
  }
  .row:focus-visible {
    outline: 2px solid var(--accent-text);
    outline-offset: -2px;
  }
  td {
    padding: 8px 12px;
    border-bottom: 1px solid var(--border-primary);
    vertical-align: middle;
    color: var(--text-primary);
  }
  .cell-name {
    font-weight: 600;
  }
  .cell-character,
  .cell-species {
    color: var(--text-secondary);
  }
  .cell-tags {
    max-width: 240px;
  }
  .cell-uploaded {
    text-align: right;
    white-space: nowrap;
    color: var(--text-tertiary);
    font-size: 12px;
  }
</style>
