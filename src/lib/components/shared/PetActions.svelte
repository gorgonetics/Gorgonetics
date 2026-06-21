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

import PetEditor from '$lib/components/pet/PetEditor.svelte';
import { appState } from '$lib/stores/pets.js';
import type { Pet } from '$lib/types/index.js';
import { focusTrap } from '$lib/utils/focusTrap.js';

interface Props {
  pet: Pet;
  /** `icon` → compact ✎/✕ glyphs for list rows; `button` → labelled controls for the detail header. */
  variant?: 'icon' | 'button';
}

const { pet, variant = 'icon' }: Props = $props();

let showEditor = $state(false);
let confirming = $state(false);

function openEditor(): void {
  showEditor = true;
}

function closeEditor(): void {
  showEditor = false;
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
    data-testid="pet-edit-btn"
    data-action="edit"
    data-pet-id={pet.id}
    onclick={openEditor}
  >✎</button>
  <button
    class="action-btn delete-btn"
    title="Delete pet"
    data-testid="pet-delete-btn"
    data-action="delete"
    data-pet-id={pet.id}
    onclick={confirmDelete}
  >✕</button>
{:else}
  <button
    class="hdr-btn"
    title="Edit pet"
    data-testid="pet-edit-btn"
    data-action="edit"
    data-pet-id={pet.id}
    onclick={openEditor}
  >Edit</button>
  <button
    class="hdr-btn hdr-delete"
    title="Delete pet"
    data-testid="pet-delete-btn"
    data-action="delete"
    data-pet-id={pet.id}
    onclick={confirmDelete}
  >Delete</button>
{/if}

{#if showEditor}
  <PetEditor {pet} bind:open={showEditor} onClose={closeEditor} onSave={() => {}} />
{/if}

{#if confirming}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="modal-backdrop"
    onclick={(e) => { if (e.target === e.currentTarget) cancelDelete(); }}
    onkeydown={(e) => { if (e.key === 'Escape') cancelDelete(); }}
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
    width: 22px;
    height: 22px;
    display: grid;
    place-items: center;
    border: none;
    border-radius: 5px;
    background: transparent;
    color: var(--text-tertiary);
    font-size: 12px;
    cursor: pointer;
    transition: background 0.12s, color 0.12s;
  }
  .action-btn:hover { background: var(--bg-hover); color: var(--text-primary); }
  .edit-btn:hover { color: var(--accent); }
  .action-btn.delete-btn:hover { color: var(--gene-negative); }

  /* Button variant: self-styled to match the detail header's .view-btn look
     (a sibling's scoped style won't reach this child component's elements). */
  .hdr-btn {
    padding: 5px 14px;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--text-tertiary);
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .hdr-btn:hover { color: var(--text-secondary); }
  .hdr-delete:hover { color: var(--gene-negative); }

  .confirm-dialog {
    background: var(--bg-primary);
    border-radius: 12px;
    box-shadow: var(--shadow-xl);
    padding: 24px;
    width: 340px;
    max-width: 90vw;
    text-align: center;
  }

  .confirm-message {
    font-size: 15px;
    color: var(--text-primary);
    margin: 0 0 4px 0;
  }

  .confirm-subtext {
    font-size: 12px;
    color: var(--text-muted);
    margin: 0 0 20px 0;
  }

  .confirm-actions {
    display: flex;
    gap: 8px;
    justify-content: center;
  }
</style>
