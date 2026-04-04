<script>
import { deleteImage, getImagesForPet, pickImageFiles, uploadImage } from '$lib/services/imageService.js';

const { pet } = $props();

let images = $state([]);
let uploading = $state(false);
let lightboxIndex = $state(-1);
let deleteTarget = $state(null);
let statusMessage = $state(null);

const lightboxImage = $derived(lightboxIndex >= 0 ? images[lightboxIndex] : null);

async function loadImages() {
  if (!pet?.id) return;
  images = await getImagesForPet(pet.id);
}

async function handleUpload() {
  const paths = await pickImageFiles();
  if (!paths || paths.length === 0) return;

  uploading = true;
  let count = 0;
  let lastError = null;
  for (const path of paths) {
    try {
      await uploadImage(pet.id, path);
      count++;
    } catch (err) {
      console.error('Failed to upload image:', err);
      lastError = err;
    }
  }
  uploading = false;
  await loadImages();

  if (count > 0) {
    statusMessage = `Uploaded ${count} image${count > 1 ? 's' : ''}`;
  } else if (lastError) {
    statusMessage = `Upload failed: ${lastError.message}`;
  }
  if (statusMessage) {
    setTimeout(() => {
      statusMessage = null;
    }, 5000);
  }
}

function openLightbox(index) {
  lightboxIndex = index;
}

function closeLightbox() {
  lightboxIndex = -1;
}

function prevImage() {
  if (lightboxIndex > 0) lightboxIndex--;
}

function nextImage() {
  if (lightboxIndex < images.length - 1) lightboxIndex++;
}

function handleLightboxKey(e) {
  if (e.key === 'Escape') closeLightbox();
  else if (e.key === 'ArrowLeft') prevImage();
  else if (e.key === 'ArrowRight') nextImage();
}

function confirmDelete(img) {
  deleteTarget = img;
}

function cancelDelete() {
  deleteTarget = null;
}

async function executeDelete() {
  if (!deleteTarget) return;
  try {
    await deleteImage(deleteTarget.id, deleteTarget.pet_id, deleteTarget.filename);
    if (lightboxIndex >= 0) {
      if (images.length <= 1) closeLightbox();
      else if (lightboxIndex >= images.length - 1) lightboxIndex--;
    }
    await loadImages();
  } catch (err) {
    console.error('Failed to delete image:', err);
  }
  deleteTarget = null;
}

$effect(() => {
  const _id = pet?.id;
  loadImages();
});
</script>

<div class="gallery">
  <div class="gallery-header">
    <span class="gallery-count">{images.length} image{images.length !== 1 ? 's' : ''}</span>
    <button class="btn btn-primary" onclick={handleUpload} disabled={uploading}>
      {uploading ? 'Uploading...' : '+ Upload Images'}
    </button>
  </div>

  {#if images.length === 0}
    <div class="gallery-empty">
      <div class="empty-icon">📷</div>
      <p>No images yet</p>
      <p class="empty-hint">Upload screenshots of your pet to build a gallery</p>
    </div>
  {:else}
    <div class="thumbnail-grid">
      {#each images as img, i}
        <div class="thumbnail-card">
          <button class="thumbnail-btn" onclick={() => openLightbox(i)}>
            <img src={img.url} alt={img.original_name} loading="lazy" />
          </button>
          <div class="thumbnail-info">
            <span class="thumbnail-name" title={img.original_name}>{img.original_name}</span>
            {#if img.caption}
              <span class="thumbnail-caption">{img.caption}</span>
            {/if}
          </div>
          <button class="thumbnail-delete" onclick={() => confirmDelete(img)} title="Delete image">×</button>
        </div>
      {/each}
    </div>
  {/if}
</div>

{#if lightboxImage}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="lightbox" onclick={closeLightbox} onkeydown={handleLightboxKey}>
    <div class="lightbox-content" onclick={(e) => e.stopPropagation()}>
      <img src={lightboxImage.url} alt={lightboxImage.original_name} />
      <div class="lightbox-info">
        <span>{lightboxImage.original_name}</span>
        {#if lightboxImage.caption}
          <span class="lightbox-caption">{lightboxImage.caption}</span>
        {/if}
      </div>
    </div>
    <button class="lightbox-close" onclick={closeLightbox}>×</button>
    {#if lightboxIndex > 0}
      <button class="lightbox-nav lightbox-prev" onclick={(e) => { e.stopPropagation(); prevImage(); }}>‹</button>
    {/if}
    {#if lightboxIndex < images.length - 1}
      <button class="lightbox-nav lightbox-next" onclick={(e) => { e.stopPropagation(); nextImage(); }}>›</button>
    {/if}
    <div class="lightbox-counter">{lightboxIndex + 1} / {images.length}</div>
  </div>
{/if}

{#if deleteTarget}
  <div class="modal-backdrop" onclick={cancelDelete}>
    <div class="confirm-dialog" onclick={(e) => e.stopPropagation()}>
      <h3>Delete image?</h3>
      <p>Delete <strong>{deleteTarget.original_name}</strong>? This cannot be undone.</p>
      <div class="confirm-actions">
        <button class="btn btn-secondary" onclick={cancelDelete}>Cancel</button>
        <button class="btn btn-danger" onclick={executeDelete}>Delete</button>
      </div>
    </div>
  </div>
{/if}

{#if statusMessage}
  <div class="toast">{statusMessage}</div>
{/if}

<style>
  .gallery {
    height: 100%;
    display: flex;
    flex-direction: column;
    padding: 16px;
    overflow-y: auto;
  }

  .gallery-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 16px;
    flex-shrink: 0;
  }

  .gallery-count {
    font-size: 13px;
    color: #6b7280;
    font-weight: 500;
  }

  .gallery-empty {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    color: #9ca3af;
  }

  .empty-icon {
    font-size: 48px;
    margin-bottom: 12px;
    opacity: 0.5;
  }

  .gallery-empty p {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
    color: #6b7280;
  }

  .gallery-empty p.empty-hint {
    font-size: 13px;
    font-weight: 400;
    color: #9ca3af;
    margin-top: 4px;
  }

  .thumbnail-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 12px;
  }

  .thumbnail-card {
    position: relative;
    background: #f9fafb;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    overflow: hidden;
  }

  .thumbnail-btn {
    display: block;
    width: 100%;
    border: none;
    background: none;
    padding: 0;
    cursor: pointer;
  }

  .thumbnail-btn img {
    width: 100%;
    height: 140px;
    object-fit: cover;
    display: block;
  }

  .thumbnail-info {
    padding: 8px 10px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .thumbnail-name {
    font-size: 11px;
    color: #374151;
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .thumbnail-caption {
    font-size: 10px;
    color: #9ca3af;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .thumbnail-delete {
    position: absolute;
    top: 6px;
    right: 6px;
    width: 24px;
    height: 24px;
    border: none;
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.5);
    color: #ffffff;
    font-size: 14px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    transition: opacity 0.15s;
  }

  .thumbnail-card:hover .thumbnail-delete {
    opacity: 1;
  }

  /* Lightbox */
  .lightbox {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.9);
    z-index: 2000;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: zoom-out;
  }

  .lightbox-content {
    max-width: 90vw;
    max-height: 90vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    cursor: default;
  }

  .lightbox-content img {
    max-width: 90vw;
    max-height: 80vh;
    object-fit: contain;
    border-radius: 4px;
  }

  .lightbox-info {
    margin-top: 12px;
    text-align: center;
    color: #d1d5db;
    font-size: 13px;
  }

  .lightbox-caption {
    display: block;
    color: #9ca3af;
    font-size: 12px;
    margin-top: 4px;
  }

  .lightbox-close {
    position: fixed;
    top: 16px;
    right: 16px;
    width: 36px;
    height: 36px;
    border: none;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.1);
    color: #ffffff;
    font-size: 20px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .lightbox-close:hover {
    background: rgba(255, 255, 255, 0.2);
  }

  .lightbox-nav {
    position: fixed;
    top: 50%;
    transform: translateY(-50%);
    width: 44px;
    height: 44px;
    border: none;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.1);
    color: #ffffff;
    font-size: 24px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .lightbox-nav:hover {
    background: rgba(255, 255, 255, 0.2);
  }

  .lightbox-prev { left: 16px; }
  .lightbox-next { right: 16px; }

  .lightbox-counter {
    position: fixed;
    bottom: 16px;
    left: 50%;
    transform: translateX(-50%);
    color: #9ca3af;
    font-size: 13px;
  }

  /* Confirm dialog */
  .confirm-dialog {
    background: #ffffff;
    border-radius: 12px;
    padding: 24px;
    max-width: 380px;
    width: 90%;
    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.15);
  }

  .confirm-dialog h3 {
    font-size: 16px;
    font-weight: 700;
    color: #111827;
    margin-bottom: 8px;
  }

  .confirm-dialog p {
    font-size: 14px;
    color: #6b7280;
    line-height: 1.5;
    margin-bottom: 20px;
  }

  .confirm-actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
  }

  .toast {
    position: fixed;
    bottom: 20px;
    right: 20px;
    padding: 12px 20px;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 500;
    background: #f0fdf4;
    color: #166534;
    border: 1px solid #bbf7d0;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    z-index: 300;
  }
</style>
