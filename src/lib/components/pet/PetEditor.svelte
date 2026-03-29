<script>
import { Button, Input, Label, Modal, Select } from 'flowbite-svelte';
import { untrack } from 'svelte';
import { appState } from '$lib/stores/pets.js';
import { FALLBACK_ATTRIBUTE_LIST } from '$lib/utils/apiUtils.js';

/**
 * @typedef {Object} Props
 * @property {any} pet - The pet to edit
 * @property {boolean} open - Whether the modal is open
 * @property {Function} onClose - Callback when editor is closed
 * @property {Function} onSave - Callback when pet is saved
 */

/** @type {Props} */
// eslint-disable-next-line prefer-const -- open is $bindable and reassigned, requiring `let` for the whole destructuring
let { pet, open = $bindable(), onClose, onSave } = $props();

// Breed options by species - easy to modify later
const BREED_OPTIONS = {
  BeeWasp: ['Bee', 'Wasp'],
  Horse: [
    'Standardbred',
    'Kurbone',
    'Ilmarian',
    'Plateau Pony',
    'Satincoat',
    'Statehelm',
    'Blanketed',
    'Leopard',
    'Paint',
    'Calico',
  ],
  default: ['Mixed'],
};

const getBreedOptions = (species) => {
  return BREED_OPTIONS[species] || BREED_OPTIONS.default;
};

const breedOptions = $derived(getBreedOptions(pet.species));

/**
 * Initialize editable state from pet prop snapshot.
 * These capture the initial values for the edit form.
 * The component is recreated when a different pet is selected.
 */
function initEditState(/** @type {any} */ p) {
  const opts = getBreedOptions(p.species);
  return {
    name: p.name || '',
    gender: p.gender || 'Male',
    breed: opts.includes(p.breed) ? p.breed : opts[0],
    attributes: Object.fromEntries(
      FALLBACK_ATTRIBUTE_LIST.map((attr) => [attr.key.toLowerCase(), p[attr.key.toLowerCase()] ?? 50]),
    ),
  };
}

const initial = untrack(() => initEditState(pet));
let editName = $state(initial.name);
let editGender = $state(initial.gender);
let editBreed = $state(initial.breed);
const editAttributes = $state(initial.attributes);
let saveError = $state('');

// Get species-specific attributes
const getAvailableAttributes = (species) => {
  const coreAttributes = ['intelligence', 'toughness', 'friendliness', 'ruggedness', 'enthusiasm', 'virility'];

  if (species === 'BeeWasp') {
    return [...coreAttributes, 'ferocity'];
  } else if (species === 'Horse') {
    return [...coreAttributes, 'temperament'];
  } else {
    return coreAttributes;
  }
};

const availableAttributes = $derived(getAvailableAttributes(pet.species));
const filteredAttributeList = $derived(
  FALLBACK_ATTRIBUTE_LIST.filter((attr) => availableAttributes.includes(attr.key.toLowerCase())),
);

async function handleSave() {
  try {
    const updateData = {};

    // Check what changed
    if (editName.trim() !== pet.name) {
      updateData.name = editName.trim();
    }
    if (editGender !== pet.gender) {
      updateData.gender = editGender;
    }
    if (editBreed.trim() !== (pet.breed || 'Mixed')) {
      updateData.breed = editBreed.trim();
    }

    // Check if any attributes changed
    const attributeChanges = {};
    for (const [key, value] of Object.entries(editAttributes)) {
      // Compare against direct pet properties (not nested attributes)
      if (pet[key] !== value) {
        attributeChanges[key] = value;
      }
    }
    if (Object.keys(attributeChanges).length > 0) {
      updateData.attributes = attributeChanges;
    }

    // Only update if there are changes
    if (Object.keys(updateData).length > 0) {
      await appState.updatePet(pet.id, updateData);
      await appState.loadPets();
      onSave?.(pet.id);
    }

    open = false;
    onClose?.();
  } catch (err) {
    console.error('Failed to update pet:', err);
    saveError = err.message || 'Failed to save changes. Please try again.';
  }
}

function handleCancel() {
  saveError = '';
  open = false;
  onClose?.();
}

function updateAttribute(attrKey, value) {
  editAttributes[attrKey] = parseInt(value, 10) || 0;
}
</script>

<Modal bind:open size="lg" autoclose outsideclose title="Edit Pet">
    {#if saveError}
        <div class="save-error" role="alert">{saveError}</div>
    {/if}
    <div class="pet-editor-content">
        <div class="form-section">
            <h3>Basic Information</h3>
            <!-- Pet Name - Full Width -->
            <div class="form-group single-column">
                <Label for="petName" class="mb-2">Pet Name</Label>
                <Input
                    id="petName"
                    bind:value={editName}
                    placeholder="Enter pet name"
                />
            </div>

            <!-- Other Basic Info - Two Columns -->
            <div class="basic-info-grid">
                <div class="form-group">
                    <Label for="petSpecies" class="mb-2">Species</Label>
                    <Input
                        id="petSpecies"
                        value={pet.species || "Unknown"}
                        disabled
                        title="Species cannot be edited (loaded from genome)"
                    />
                </div>

                <div class="form-group">
                    <Label for="petBreeder" class="mb-2">Breeder</Label>
                    <Input
                        id="petBreeder"
                        value={pet.breeder || "Unknown"}
                        disabled
                        title="Breeder cannot be edited (loaded from genome)"
                    />
                </div>

                <div class="form-group">
                    <Label for="petGender" class="mb-2">Gender</Label>
                    <Select
                        id="petGender"
                        bind:value={editGender}
                        items={[
                            { value: "Male", name: "Male" },
                            { value: "Female", name: "Female" },
                        ]}
                    />
                </div>

                <div class="form-group">
                    <Label for="petBreed" class="mb-2">Breed</Label>
                    <Select
                        id="petBreed"
                        bind:value={editBreed}
                        items={breedOptions.map((breed) => ({
                            value: breed,
                            name: breed,
                        }))}
                    />
                </div>
            </div>
        </div>

        <div class="form-section">
            <h3>Attributes ({pet.species})</h3>
            <div class="attributes-grid">
                {#each filteredAttributeList as attr (attr.key)}
                    <div class="attribute-group">
                        <Label for="attr-{attr.key}" class="mb-2"
                            >{attr.name}</Label
                        >
                        <Input
                            type="number"
                            id="attr-{attr.key}"
                            min="0"
                            max="100"
                            value={editAttributes[attr.key.toLowerCase()] ?? 50}
                            oninput={(e) =>
                                updateAttribute(
                                    attr.key.toLowerCase(),
                                    e.target.value,
                                )}
                        />
                    </div>
                {/each}
            </div>
        </div>
    </div>
    <svelte:fragment slot="footer">
        <Button color="alternative" onclick={handleCancel}>Cancel</Button>
        <Button onclick={handleSave}>Save Changes</Button>
    </svelte:fragment>
</Modal>

<style>
    .pet-editor-content {
        display: flex;
        flex-direction: column;
        gap: 1rem;
        max-height: 75vh;
        overflow-y: auto;
    }

    .form-section {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
    }

    .form-section h3 {
        margin: 0;
        font-size: 1.125rem;
        font-weight: 600;
        color: #111827;
        border-bottom: 2px solid #e5e7eb;
        padding-bottom: 0.5rem;
    }

    .basic-info-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: 0.75rem;
    }

    .form-group {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
    }

    .single-column {
        grid-column: 1 / -1;
    }

    .attributes-grid {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 0.5rem;
    }

    .attribute-group {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
    }

    .save-error {
        background-color: #fef2f2;
        border: 1px solid #fecaca;
        border-radius: 6px;
        color: #dc2626;
        font-size: 0.875rem;
        margin-bottom: 1rem;
        padding: 0.75rem 1rem;
    }

    /* Responsive adjustments */
    @media (max-width: 640px) {
        .basic-info-grid {
            grid-template-columns: 1fr;
        }
    }
</style>
