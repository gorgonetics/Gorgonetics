import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/services/imageService.js', () => ({
  getImagesForPet: vi.fn(),
  deleteImage: vi.fn(),
  pickImageFiles: vi.fn().mockResolvedValue([]),
  reorderImages: vi.fn(),
  uploadImage: vi.fn(),
}));

import PetImageGallery from '$lib/components/pet/PetImageGallery.svelte';
import { getImagesForPet } from '$lib/services/imageService.js';
import type { Pet, PetImage } from '$lib/types/index.js';

const IMAGES = [
  { id: 1, pet_id: 1, url: 'blob:a', original_name: 'a.png', sort_order: 0 },
  { id: 2, pet_id: 1, url: 'blob:b', original_name: 'b.png', sort_order: 1 },
] as unknown as PetImage[];

const PET = { id: 1, name: 'Dusty' } as unknown as Pet;

beforeEach(() => {
  vi.mocked(getImagesForPet).mockResolvedValue(IMAGES);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('PetImageGallery lightbox', () => {
  it('closes the lightbox on Escape without the event reaching document-level handlers', async () => {
    const { container } = render(PetImageGallery, { pet: PET });

    const thumb = await waitFor(() => {
      const b = container.querySelector<HTMLButtonElement>('.thumbnail-btn');
      if (!b) throw new Error('thumbnails not loaded yet');
      return b;
    });

    await fireEvent.click(thumb);
    const lightbox = container.querySelector('.lightbox');
    expect(lightbox).not.toBeNull();

    // A DetailOverlay-style document listener must NOT see the lightbox's Escape;
    // otherwise closing the lightbox also tears down the pet-detail overlay.
    const docSpy = vi.fn();
    document.addEventListener('keydown', docSpy);
    let notCancelled = true;
    try {
      // fireEvent returns false when the handler called preventDefault.
      notCancelled = await fireEvent.keyDown(lightbox as Element, { key: 'Escape' });
    } finally {
      document.removeEventListener('keydown', docSpy);
    }

    expect(container.querySelector('.lightbox')).toBeNull();
    expect(docSpy).not.toHaveBeenCalled();
    expect(notCancelled).toBe(false);
  });

  it('control: an Escape outside the lightbox does reach document listeners', async () => {
    const docSpy = vi.fn();
    document.addEventListener('keydown', docSpy);
    try {
      await fireEvent.keyDown(document.body, { key: 'Escape' });
    } finally {
      document.removeEventListener('keydown', docSpy);
    }
    expect(docSpy).toHaveBeenCalled();
  });
});
