<script lang="ts">
import { House, PawPrint, Star } from '@lucide/svelte';
import { untrack } from 'svelte';
import DetailOverlay from '$lib/components/shared/DetailOverlay.svelte';
import { getAllAttributeDisplayInfo, getAllAttributeNames } from '$lib/services/configService.js';
import { allTags as allTagsStore, appState } from '$lib/stores/pets.js';
import type { AttributeInfo, Gender, Pet } from '$lib/types/index.js';
import { HORSE_BREEDS } from '$lib/types/index.js';
import { computePetChanges } from '$lib/utils/petChanges.js';
import TagInput from './TagInput.svelte';

interface Props {
  pet: Pet;
  onClose?: () => void;
  onSave?: (petId: number) => void;
}

const ALL_ATTRIBUTES: AttributeInfo[] = getAllAttributeDisplayInfo();

let { pet, onClose, onSave }: Props = $props();

const BREED_OPTIONS: Record<string, string[]> = {
  BeeWasp: ['Bee', 'Wasp'],
  Horse: Object.keys(HORSE_BREEDS),
  default: ['Mixed'],
};

const getBreedOptions = (species: string): string[] => BREED_OPTIONS[species] ?? BREED_OPTIONS.default;
const breedOptions: string[] = $derived(getBreedOptions(pet.species));

function initEditState(p: Pet): { name: string; gender: Gender; breed: string; attributes: Record<string, number> } {
  const opts = getBreedOptions(p.species);
  return {
    name: p.name || '',
    gender: (p.gender || 'Male') as Gender,
    // An unknown/unset breed maps to '' (the explicit "Not set" option) so
    // opening and saving the editor can't silently assign the first option.
    breed: opts.includes(p.breed) ? p.breed : '',
    attributes: Object.fromEntries(
      ALL_ATTRIBUTES.map((attr) => [
        attr.key.toLowerCase(),
        ((p as unknown as Record<string, unknown>)[attr.key.toLowerCase()] as number) ?? 50,
      ]),
    ),
  };
}

const initial = untrack(() => initEditState(pet));
let editName: string = $state(initial.name);
let editGender: Gender = $state(initial.gender);
let editBreed: string = $state(initial.breed);
const editAttributes: Record<string, number> = $state(initial.attributes);
let editTags: string[] = $state(untrack(() => [...(pet.tags ?? [])]));
let editStarred: boolean = $state(untrack(() => !!pet.starred));
let editStabled: boolean = $state(untrack(() => !!pet.stabled));
let editIsPetQuality: boolean = $state(untrack(() => !!pet.is_pet_quality));
let saveError: string = $state('');

const allTags: string[] = $derived($allTagsStore);

const availableAttributes: string[] = $derived(getAllAttributeNames(pet.species));
const filteredAttributeList: AttributeInfo[] = $derived(
  ALL_ATTRIBUTES.filter((attr) => availableAttributes.includes(attr.key.toLowerCase())),
);

async function handleSave(): Promise<void> {
  try {
    const updateData = computePetChanges(pet, {
      name: editName,
      gender: editGender,
      breed: editBreed,
      attributes: editAttributes,
      tags: editTags,
      starred: editStarred,
      stabled: editStabled,
      isPetQuality: editIsPetQuality,
    });

    if (Object.keys(updateData).length > 0) {
      await appState.updatePet(pet.id, updateData);
      onSave?.(pet.id);
    }
    onClose?.();
  } catch (err) {
    saveError = (err as Error).message || 'Failed to save changes.';
  }
}

function handleCancel(): void {
  saveError = '';
  onClose?.();
}

function updateAttribute(attrKey: string, value: string): void {
  editAttributes[attrKey] = Number.parseInt(value, 10) || 0;
}
</script>

<DetailOverlay onBack={handleCancel} backLabel="← Back" ariaLabel="Edit pet" testid="pet-editor" backTestid="pet-editor-back">
  {#snippet title()}Edit Pet{/snippet}
  {#snippet children()}
    <div class="editor">
      <div class="editor-scroll">
        <div class="editor-inner">
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
                <label for="petGender">Gender</label>
                <select id="petGender" bind:value={editGender}>
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                </select>
              </div>
              <div class="field">
                <label for="petBreed">Breed</label>
                <select id="petBreed" bind:value={editBreed}>
                  <option value="">Not set</option>
                  {#each breedOptions as breed}
                    <option value={breed}>{breed}</option>
                  {/each}
                </select>
              </div>
            </div>
            <p class="meta-line">
              <span><span class="meta-label">Species</span> {pet.species || 'Unknown'}</span>
              <span><span class="meta-label">Breeder</span> {pet.breeder || 'Unknown'}</span>
            </p>
          </section>

          <section class="form-section">
            <h3>Tags</h3>
            <TagInput tags={editTags} {allTags} onchange={(t) => { editTags = t; }} />
          </section>

          <section class="form-section">
            <h3>Markers</h3>
            <div class="markers">
              <button
                type="button"
                class="marker star"
                class:active={editStarred}
                aria-pressed={editStarred}
                onclick={() => { editStarred = !editStarred; }}
              >
                <Star size={15} fill={editStarred ? 'currentColor' : 'none'} />
                <span>Starred</span>
                <span class="marker-hint">favourites</span>
              </button>
              <button
                type="button"
                class="marker stable"
                class:active={editStabled}
                aria-pressed={editStabled}
                onclick={() => { editStabled = !editStabled; }}
              >
                <House size={15} fill={editStabled ? 'currentColor' : 'none'} />
                <span>Stabled</span>
                <span class="marker-hint">available in your stables</span>
              </button>
              <button
                type="button"
                class="marker pet-quality"
                class:active={editIsPetQuality}
                aria-pressed={editIsPetQuality}
                onclick={() => { editIsPetQuality = !editIsPetQuality; }}
              >
                <PawPrint size={15} fill={editIsPetQuality ? 'currentColor' : 'none'} />
                <span>Pet quality</span>
                <span class="marker-hint">not used for breeding</span>
              </button>
            </div>
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
                    oninput={(e) => updateAttribute(attr.key.toLowerCase(), (e.currentTarget as HTMLInputElement).value)}
                  />
                </div>
              {/each}
            </div>
          </section>
        </div>
      </div>

      <div class="editor-footer">
        <button class="btn btn-secondary" onclick={handleCancel}>Cancel</button>
        <button class="btn btn-primary" onclick={handleSave}>Save Changes</button>
      </div>
    </div>
  {/snippet}
</DetailOverlay>

<style>
  .editor {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  .editor-scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
  }

  .editor-inner {
    max-width: 640px;
    margin: 0 auto;
    padding: 20px;
  }

  .editor-footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 14px 20px;
    border-top: 1px solid var(--border-primary);
    background: var(--bg-secondary);
    flex-shrink: 0;
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

  .field-row {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 12px;
  }

  /* Read-only provenance shown as plain text, not fake-editable inputs. */
  .meta-line {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 20px;
    margin: 4px 0 0 0;
    font-size: 13px;
    color: var(--text-secondary);
  }

  .meta-label {
    color: var(--text-muted);
    margin-right: 4px;
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

  .markers {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .marker {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    border: 1px solid var(--border-primary);
    background: var(--bg-primary);
    color: var(--text-muted);
    border-radius: 6px;
    font-size: 13px;
    cursor: pointer;
    transition: color 0.15s, border-color 0.15s, background 0.15s;
    text-align: left;
  }

  .marker:hover {
    border-color: var(--border-secondary);
    color: var(--text-primary);
  }

  .marker.star.active {
    color: #f59e0b;
    border-color: #f59e0b;
  }

  .marker.stable.active {
    color: var(--accent);
    border-color: var(--accent);
  }

  .marker.pet-quality.active {
    color: var(--text-primary);
    border-color: var(--text-primary);
  }

  .marker-hint {
    color: var(--text-muted);
    font-size: 12px;
    margin-left: auto;
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
