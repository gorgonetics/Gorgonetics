<script>
  import { createEventDispatcher } from 'svelte';
  import { appState, loading, error } from '../stores/appState.js';

  const dispatch = createEventDispatcher();

  let fileInput;
  let petName = '';
  let dragOver = false;
  let uploading = false;

  function handleFileSelect(event) {
    const file = event.target.files[0];
    if (file) {
      uploadFile(file);
    }
  }

  function handleDrop(event) {
    event.preventDefault();
    dragOver = false;

    const files = event.dataTransfer.files;
    if (files.length > 0) {
      const file = files[0];
      if (file.name.endsWith('.txt')) {
        uploadFile(file);
      } else {
        appState.error.set('Please upload a .txt genome file');
      }
    }
  }

  function handleDragOver(event) {
    event.preventDefault();
    dragOver = true;
  }

  function handleDragLeave(event) {
    event.preventDefault();
    dragOver = false;
  }

  function openFileDialog() {
    fileInput.click();
  }

  async function uploadFile(file) {
    try {
      uploading = true;
      await appState.uploadPet(file, petName);
      petName = ''; // Clear the name input after successful upload
      fileInput.value = ''; // Clear the file input
      dispatch('upload-success');
    } catch (err) {
      console.error('Upload failed:', err);
    } finally {
      uploading = false;
    }
  }

  function handleKeydown(event) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openFileDialog();
    }
  }
</script>

<div class="form-group">
  <label>Add Pet to Collection</label>
  <div
    class="drop-zone"
    class:drag-over={dragOver}
    class:uploading
    on:drop={handleDrop}
    on:dragover={handleDragOver}
    on:dragleave={handleDragLeave}
    on:click={openFileDialog}
    on:keydown={handleKeydown}
    tabindex="0"
    role="button"
    aria-label="Upload genome file"
  >
    <div class="drop-zone-content">
      {#if uploading}
        <span class="drop-icon">⏳</span>
        <span class="drop-text">
          <p>Uploading...</p>
        </span>
      {:else}
        <span class="drop-icon">📁</span>
        <span class="drop-text">
          <p>Drag & drop genome file here</p>
          <p class="drop-hint">or click to browse</p>
        </span>
      {/if}
      <input
        type="file"
        bind:this={fileInput}
        on:change={handleFileSelect}
        accept=".txt"
        style="display: none;"
        disabled={uploading}
      />
    </div>
  </div>
  <div class="form-group" style="margin-top: 8px;">
    <input
      type="text"
      bind:value={petName}
      placeholder="Pet name (optional)"
      class="pet-name-input"
      disabled={uploading}
    />
  </div>
</div>

<style>
  .form-group {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .form-group label {
    font-size: 0.875rem;
    font-weight: 500;
    color: #374151;
  }

  .drop-zone {
    border: 2px dashed #d1d5db;
    border-radius: 8px;
    padding: 1.5rem;
    text-align: center;
    cursor: pointer;
    transition: all 0.2s ease;
    background-color: #fafafa;
  }

  .drop-zone:hover {
    border-color: #3b82f6;
    background-color: #f0f9ff;
  }

  .drop-zone:focus {
    outline: 2px solid #3b82f6;
    outline-offset: 2px;
  }

  .drop-zone.drag-over {
    border-color: #3b82f6;
    background-color: #eff6ff;
    transform: scale(1.02);
  }

  .drop-zone.uploading {
    border-color: #f59e0b;
    background-color: #fef3c7;
    cursor: not-allowed;
  }

  .drop-zone-content {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
  }

  .drop-icon {
    font-size: 2rem;
    opacity: 0.7;
  }

  .drop-text {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .drop-text p {
    margin: 0;
    font-size: 0.875rem;
    color: #374151;
  }

  .drop-hint {
    color: #6b7280;
    font-size: 0.75rem !important;
  }

  .pet-name-input {
    padding: 0.5rem;
    border: 1px solid #d1d5db;
    border-radius: 6px;
    font-size: 0.875rem;
    background: white;
  }

  .pet-name-input:disabled {
    background-color: #f9fafb;
    color: #9ca3af;
  }

  .pet-name-input:focus {
    outline: 2px solid #3b82f6;
    outline-offset: 2px;
    border-color: #3b82f6;
  }
</style>
