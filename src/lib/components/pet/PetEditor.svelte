<script>
import { untrack } from 'svelte';
import { getAllAttributeDisplayInfo, getAllAttributeNames } from '$lib/services/configService.js';
import { allTags as allTagsStore, appState } from '$lib/stores/pets.js';
import { HORSE_BREEDS } from '$lib/types/index.js';
import { focusTrap } from '$lib/utils/focusTrap.js';
import TagInput from './TagInput.svelte';

const ALL_ATTRIBUTES = getAllAttributeDisplayInfo();

let { pet, open = $bindable(), onClose, onSave } = $props();

const BREED_OPTIONS = {
  BeeWasp: ['Bee', 'Wasp'],
  Horse: Object.keys(HORSE_BREEDS),
  default: ['Mixed'],
};

const getBreedOptions = (species) => BREED_OPTIONS[species] || BREED_OPTIONS.default;
const breedOptions = $derived(getBreedOptions(pet.species));

function initEditState(p) {
  const opts = getBreedOptions(p.species);
  return {
    name: p.name || '',
    gender: p.gender || 'Male',
    breed: opts.includes(p.breed) ? p.breed : opts[0],
    attributes: Object.fromEntries(
      ALL_ATTRIBUTES.map((attr) => [attr.key.toLowerCase(), p[attr.key.toLowerCase()] ?? 50]),
    ),
  };
}

const initial = untrack(() => initEditState(pet));
let editName = $state(initial.name);
let editGender = $state(initial.gender);
let editBreed = $state(initial.breed);
const editAttributes = $state(initial.attributes);
let editTags = $state(untrack(() => [...(pet.tags ?? [])]));
let saveError = $state('');

const allTags = $derived($allTagsStore);

const availableAttributes = $derived(getAllAttributeNames(pet.species));
const filteredAttributeList = $derived(
  ALL_ATTRIBUTES.filter((attr) => availableAttributes.includes(attr.key.toLowerCase())),
);

async function handleSave() {
  try {
    const updateData = {};
    if (editName.trim() !== pet.name) updateData.name = editName.trim();
    if (editGender !== pet.gender) updateData.gender = editGender;
    if (editBreed.trim() !== (pet.breed || 'Mixed')) updateData.breed = editBreed.trim();

    const attributeChanges = {};
    for (const [key, value] of Object.entries(editAttributes)) {
      if (pet[key] !== value) attributeChanges[key] = value;
    }
    if (Object.keys(attributeChanges).length > 0) updateData.attributes = attributeChanges;

    if (JSON.stringify(editTags) !== JSON.stringify(pet.tags ?? [])) {
      updateData.tags = editTags;
    }

    if (Object.keys(updateData).length > 0) {
      await appState.updatePet(pet.id, updateData);
      await appState.loadPets();
      onSave?.(pet.id);
    }
    open = false;
    onClose?.();
  } catch (err) {
    saveError = err.message || 'Failed to save changes.';
  }
}

function handleCancel() {
  saveError = '';
  open = false;
  onClose?.();
}

function handleBackdropClick(e) {
  if (e.target === e.currentTarget) handleCancel();
}

function handleKeydown(e) {
  if (e.key === 'Escape') handleCancel();
}

function updateAttribute(attrKey, value) {
  editAttributes[attrKey] = Number.parseInt(value, 10) || 0;
}
</script>

{#if open}
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="modal-backdrop" onclick={handleBackdropClick} onkeydown={handleKeydown}>
  <div class="modal-panel" role="dialog" aria-label="Edit Pet" aria-modal="true" use:focusTrap>
    <div class="modal-header">
      <h2>Edit Pet</h2>
      <button class="modal-close" onclick={handleCancel}>×</button>
    </div>

    <div class="modal-body">
      {#if saveError}
        <div class="save-error" role="alert">{saveError}</div>
      {/if}

      <section class="form-section">
        <h3>Basic Information</h3>
        <div class="field">
          <label for="petName">Pet Name</label>
          <input id="petName" type="text" bind:value={editName} placeholder="Enter pet name" />
        </div>
        <div class="field-row">
          <div class="field">
            <label for="petSpecies">Species</label>
            <input id="petSpecies" type="text" value={pet.species || 'Unknown'} disabled />
          </div>
          <div class="field">
            <label for="petBreeder">Breeder</label>
            <input id="petBreeder" type="text" value={pet.breeder || 'Unknown'} disabled />
          </div>
          <div class="field">
            <label for="petGender">Gender</label>
            <select id="petGender" bind:value={editGender}>
              <option value="Male">Male</option>
              <option value="Female">Female</option>
            </select>
          </div>
          <div class="field">
            <label for="petBreed">Breed</label>
            <select id="petBreed" bind:value={editBreed}>
              {#each breedOptions as breed}
                <option value={breed}>{breed}</option>
              {/each}
            </select>
          </div>
        </div>
      </section>

      <section class="form-section">
        <h3>Tags</h3>
        <TagInput tags={editTags} {allTags} onchange={(t) => { editTags = t; }} />
      </section>

      <section class="form-section">
        <h3>Attributes ({pet.species})</h3>
        <div class="attributes-grid">
          {#each filteredAttributeList as attr (attr.key)}
            <div class="attr-field">
              <label for="attr-{attr.key}">
                <span class="attr-icon">{attr.icon}</span>
                {attr.name}
              </label>
              <input
                type="number"
                id="attr-{attr.key}"
                min="0"
                max="100"
                value={editAttributes[attr.key.toLowerCase()] ?? 50}
                oninput={(e) => updateAttribute(attr.key.toLowerCase(), e.target.value)}
              />
            </div>
          {/each}
        </div>
      </section>
    </div>

    <div class="modal-footer">
      <button class="btn btn-secondary" onclick={handleCancel}>Cancel</button>
      <button class="btn btn-primary" onclick={handleSave}>Save Changes</button>
    </div>
  </div>
</div>
{/if}

<style>
  .modal-panel {
    background: var(--bg-primary);
    border-radius: 12px;
    box-shadow: var(--shadow-xl);
    width: 560px;
    max-width: 90vw;
    max-height: 85vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid var(--border-primary);
  }

  .modal-header h2 {
    margin: 0;
    font-size: 16px;
    font-weight: 700;
    color: var(--text-primary);
  }

  .modal-close {
    background: none;
    border: none;
    font-size: 20px;
    color: var(--text-muted);
    cursor: pointer;
    padding: 4px 8px;
    border-radius: 4px;
    line-height: 1;
  }

  .modal-close:hover {
    background: var(--bg-tertiary);
    color: var(--text-secondary);
  }

  .modal-body {
    padding: 20px;
    overflow-y: auto;
    flex: 1;
  }

  .modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 14px 20px;
    border-top: 1px solid var(--border-primary);
    background: var(--bg-secondary);
  }

  .form-section {
    margin-bottom: 20px;
  }

  .form-section:last-child {
    margin-bottom: 0;
  }

  .form-section h3 {
    margin: 0 0 12px 0;
    font-size: 13px;
    font-weight: 600;
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .field {
    margin-bottom: 12px;
  }

  .field label {
    display: block;
    font-size: 13px;
    font-weight: 500;
    color: var(--text-secondary);
    margin-bottom: 4px;
  }

  .field input,
  .field select {
    width: 100%;
    padding: 8px 10px;
    border: 1px solid var(--border-primary);
    border-radius: 6px;
    font-size: 13px;
    color: var(--text-primary);
    background: var(--bg-primary);
    outline: none;
    transition: border-color 0.15s;
    box-sizing: border-box;
  }

  .field input:focus,
  .field select:focus {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px var(--accent-soft);
  }

  .field input:disabled {
    background: var(--bg-secondary);
    color: var(--text-muted);
  }

  .field-row {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 12px;
  }

  .attributes-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 10px;
  }

  .attr-field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .attr-field label {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    font-weight: 500;
    color: var(--text-secondary);
  }

  .attr-icon {
    font-size: 14px;
  }

  .attr-field input {
    width: 100%;
    padding: 6px 10px;
    border: 1px solid var(--border-primary);
    border-radius: 6px;
    font-size: 13px;
    color: var(--text-primary);
    background: var(--bg-primary);
    outline: none;
    box-sizing: border-box;
  }

  .attr-field input:focus {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px var(--accent-soft);
  }

  .save-error {
    background: var(--error-bg);
    border: 1px solid var(--error-border);
    border-radius: 6px;
    color: var(--error-text);
    font-size: 13px;
    padding: 10px 14px;
    margin-bottom: 16px;
  }
</style>
