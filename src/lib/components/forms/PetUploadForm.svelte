<script>
import { Button, Input, Label, Select } from 'flowbite-svelte';
import { createEventDispatcher } from 'svelte';
import { pickGenomeFile, readFileContent } from '$lib/services/fileService.js';
import { appState, error } from '$lib/stores/pets.js';

const dispatch = createEventDispatcher();

let petName = $state('');
let petGender = $state('Male');
let uploading = $state(false);
let selectedFileName = $state('');

async function handlePickFile() {
  try {
    const filePath = await pickGenomeFile();
    if (!filePath) return;

    // Show the selected filename
    const parts = filePath.split(/[/\\]/);
    selectedFileName = parts[parts.length - 1];

    uploading = true;
    const content = await readFileContent(filePath);
    await appState.uploadPet(content, petName, petGender);
    petName = '';
    petGender = 'Male';
    selectedFileName = '';
    dispatch('upload-success');
  } catch (err) {
    console.error('Upload failed:', err);
    error.set(`Upload failed: ${err.message}`);
  } finally {
    uploading = false;
  }
}
</script>

<div class="form-group">
    <Label class="mb-2">Add Pet to Collection</Label>
    <Button
        color="blue"
        outline
        class="w-full py-6"
        onclick={handlePickFile}
        disabled={uploading}
    >
        <svg
            aria-hidden="true"
            class="w-8 h-8 mr-2 text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            xmlns="http://www.w3.org/2000/svg"
        >
            <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
            ></path>
        </svg>
        {#if uploading}
            Uploading...
        {:else if selectedFileName}
            {selectedFileName}
        {:else}
            Click to select genome file
        {/if}
    </Button>
    <p class="mt-1 text-xs text-gray-500 text-center">TXT genome files only</p>
    <div class="form-group mt-4">
        <Label for="pet-name" class="mb-2">Pet Name (optional)</Label>
        <Input
            id="pet-name"
            bind:value={petName}
            placeholder="Enter pet name"
            disabled={uploading}
        />
    </div>
    <div class="form-group mt-4">
        <Label for="pet-gender" class="mb-2">Gender</Label>
        <Select
            id="pet-gender"
            bind:value={petGender}
            disabled={uploading}
            items={[
                { value: "Male", name: "Male" },
                { value: "Female", name: "Female" },
            ]}
        />
    </div>
</div>

<style>
    .form-group {
        display: flex;
        flex-direction: column;
    }
</style>
