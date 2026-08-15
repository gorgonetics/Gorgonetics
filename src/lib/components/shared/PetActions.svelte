<script lang="ts">
/**
 * Edit + delete actions for a single pet, reusable across the redesign shell.
 *
 * The pre-redesign UI wired these only into the Pets-tab card list
 * (`PetList.svelte`). The Library + Workspace IA has no equivalent, so this
 * lifts the same `PetEditor` modal and delete-confirm dialog into a shared
 * component that the library rows (icon variant) and the single-pet workspace
 * header (button variant) both mount. Deletion goes through the same
 * `appState.deletePet`. See docs/design/redesign-library-workspace-v1.md §5.
 */

import { appState } from '$lib/stores/pets.js';
import { uiActions } from '$lib/stores/ui.js';
import type { Pet } from '$lib/types/index.js';
import { focusTrap } from '$lib/utils/focusTrap.js';

interface Props {
  pet: Pet;
  /** `icon` → compact ✎/✕ glyphs for list rows; `button` → labelled controls for the detail header. */
  variant?: 'icon' | 'button';
}

const { pet, variant = 'icon' }: Props = $props();

let confirming = $state(false);

function openEditor(): void {
  uiActions.openEditor(pet);
}

function confirmDelete(): void {
  confirming = true;
}

function cancelDelete(): void {
  confirming = false;
}

async function doDelete(): Promise<void> {
  await appState.deletePet(pet.id);
  confirming = false;
}
</script>

{#if variant === 'icon'}
  <button
    class="action-btn edit-btn"
    title="Edit pet"
    aria-label="Edit {pet.name}"
    data-testid="pet-edit-btn"
    data-action="edit"
    data-pet-id={pet.id}
    onclick={openEditor}
  >✎</button>
  <button
    class="action-btn delete-btn"
    title="Delete pet"
    aria-label="Delete {pet.name}"
    data-testid="pet-delete-btn"
    data-action="delete"
    data-pet-id={pet.id}
    onclick={confirmDelete}
  >✕</button>
{:else}
  <button
    class="seg-btn"
    title="Edit pet"
    data-testid="pet-edit-btn"
    data-action="edit"
    data-pet-id={pet.id}
    onclick={openEditor}
  >Edit</button>
  <button
    class="seg-btn hdr-delete"
    title="Delete pet"
    data-testid="pet-delete-btn"
    data-action="delete"
    data-pet-id={pet.id}
    onclick={confirmDelete}
  >Delete</button>
{/if}

{#if confirming}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="modal-backdrop"
    onclick={(e) => { if (e.target === e.currentTarget) cancelDelete(); }}
    onkeydown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); cancelDelete(); } }}
  >
    <div class="confirm-dialog" role="alertdialog" aria-label="Confirm delete" aria-modal="true" use:focusTrap>
      <p class="confirm-message">Delete <strong>{pet.name}</strong>?</p>
      <p class="confirm-subtext">This action cannot be undone.</p>
      <div class="confirm-actions">
        <button class="btn btn-secondary" onclick={cancelDelete}>Cancel</button>
        <button class="btn btn-danger" onclick={doDelete}>Delete</button>
      </div>
    </div>
  </div>
{/if}

<style>
  /* Compact glyph buttons for list rows (icon variant). */
  .action-btn {
    width: 24px;
    height: 24px;
    display: grid;
    place-items: center;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-secondary);
    font-size: 13px;
    cursor: pointer;
    transition: background 0.12s, color 0.12s, border-color 0.12s;
  }
  .action-btn:hover { background: var(--bg-hover); border-color: var(--border-primary); color: var(--text-primary); }
  .action-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  .edit-btn:hover { color: var(--accent); }
  .action-btn.delete-btn:hover { color: var(--gene-negative); }

  /* `.seg-btn.` is load-bearing, not decoration: the global
     `.seg-btn:hover:not(:disabled)` is (0,3,0), and Svelte compiles a bare
     `.hdr-delete:hover` to (0,3,0) too — an exact tie broken only by which
     stylesheet the bundler emits last. Qualifying it to (0,4,0) keeps the
     destructive action's red hover deterministic. */
  .seg-btn.hdr-delete:hover { color: var(--gene-negative); }

  .confirm-dialog {
    background: var(--bg-primary);
    border-radius: var(--radius-xl);
    box-shadow: var(--shadow-xl);
    padding: var(--space-3xl);
    width: 340px;
    max-width: 90vw;
    text-align: center;
  }

  .confirm-message {
    font-size: 15px;
    color: var(--text-primary);
    margin: 0 0 var(--space-2xs) 0;
  }

  .confirm-subtext {
    font-size: 12px;
    color: var(--text-muted);
    margin: 0 0 var(--space-2xl) 0;
  }

  .confirm-actions {
    display: flex;
    gap: var(--space-sm);
    justify-content: center;
  }
</style>
