<script>
import { selectPet } from '$lib/stores/community.svelte.js';
import { formatShortDate } from '$lib/utils/timestamp.js';

const { pet, selected = false } = $props();

const uploadedLabel = $derived(formatShortDate(pet.uploadedAt));

function handleClick() {
  selectPet(pet.contentHash);
}

function handleKey(e) {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    selectPet(pet.contentHash);
  }
}
</script>

<!--
  Selection on a real `<tr>` so assistive tech keeps the underlying
  table-row semantics (a previous revision spelled `role="button"` and
  silently dropped the row's role, hiding cells from screen readers).
  `aria-selected` carries the visual selection state; the row remains
  tabbable and Enter/Space-activatable for keyboard users.
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
  <td class="cell-name">{pet.name || '(unnamed)'}</td>
  <td class="cell-character">{pet.character || '—'}</td>
  <td class="cell-species">{pet.species || '—'}</td>
  <td class="cell-tags">
    {#each pet.tags as t (t)}
      <span class="tag-badge">{t}</span>
    {/each}
  </td>
  <td class="cell-uploaded">{uploadedLabel}</td>
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
