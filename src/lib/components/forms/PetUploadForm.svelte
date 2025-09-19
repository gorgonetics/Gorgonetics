<script>
    import { createEventDispatcher } from "svelte";
    import { appState } from "$lib/stores/pets.js";
    import { Dropzone, Input, Label, Select } from "flowbite-svelte";

    const dispatch = createEventDispatcher();

    let fileInput = $state();
    let petName = $state("");
    let petGender = $state("Male");
    let dragOver = $state(false);
    let uploading = $state(false);

    function handleFileSelect(files) {
        if (files && files.length > 0) {
            const file = files[0];
            if (file.name.endsWith(".txt")) {
                uploadFile(file);
            } else {
                appState.error.set("Please upload a .txt genome file");
            }
        }
    }

    async function uploadFile(file) {
        try {
            uploading = true;
            await appState.uploadPet(file, petName, petGender);
            petName = ""; // Clear the name input after successful upload
            petGender = "Male"; // Reset gender to default
            fileInput.value = ""; // Clear the file input
            dispatch("upload-success");
        } catch (err) {
            console.error("Upload failed:", err);
        } finally {
            uploading = false;
        }
    }
</script>

<div class="form-group">
    <Label class="mb-2">Add Pet to Collection</Label>
    <Dropzone
        id="dropzone"
        onchange={handleFileSelect}
        accept=".txt"
        disabled={uploading}
    >
        <svg
            aria-hidden="true"
            class="w-10 h-10 mb-3 text-gray-400"
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
        <p class="mb-2 text-sm text-gray-500">
            {#if uploading}
                <span class="font-semibold">Uploading...</span>
            {:else}
                <span class="font-semibold">Click to upload</span> or drag and drop
            {/if}
        </p>
        <p class="text-xs text-gray-500">TXT genome files only</p>
    </Dropzone>
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
