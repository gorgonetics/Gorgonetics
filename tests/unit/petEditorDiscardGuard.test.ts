import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Backing out of the Pet Editor (Cancel / back button / Escape) with pending
// changes must ask for confirmation instead of silently discarding them (#396).

vi.mock('$lib/services/petService.js', () => ({
  updatePet: vi.fn(),
  getAllPets: vi.fn(),
  deletePet: vi.fn(),
  reorderPets: vi.fn(),
  uploadPet: vi.fn(),
}));

import PetEditor from '$lib/components/pet/PetEditor.svelte';
import { getAllAttributeDisplayInfo } from '$lib/services/configService.js';
import type { Pet } from '$lib/types/index.js';

// Give the pet a value for every editable attribute so the untouched form
// diffs clean against it (initEditState defaults missing attributes to 50).
const attributeFields = Object.fromEntries(getAllAttributeDisplayInfo().map((a) => [a.key.toLowerCase(), 50]));

function makePet(overrides: Partial<Pet> = {}): Pet {
  return {
    id: 7,
    name: 'Dobbin',
    // BeeWasp with breed 'Bee': the breed is a valid editor option, so the
    // untouched form diffs clean (a breed outside the options list would be
    // coerced to the first option and read as a pending change).
    species: 'BeeWasp',
    breed: 'Bee',
    gender: 'Male',
    tags: [],
    starred: false,
    stabled: false,
    is_pet_quality: false,
    ...attributeFields,
    ...overrides,
  } as unknown as Pet;
}

function mount(onClose = vi.fn()) {
  const pet = makePet();
  const utils = render(PetEditor, { pet, onClose } as never);
  return { ...utils, onClose };
}

const q = (c: HTMLElement, sel: string) => c.querySelector(sel) as HTMLElement | null;
const backBtn = (c: HTMLElement) => q(c, '[data-testid="pet-editor-back"]') as HTMLElement;
const confirmDialog = (c: HTMLElement) => q(c, '[data-testid="pet-editor-discard-confirm"]');

afterEach(cleanup);

describe('PetEditor discard guard', () => {
  it('closes immediately when nothing changed', async () => {
    const { container, onClose } = mount();
    await fireEvent.click(backBtn(container));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(confirmDialog(container)).toBeNull();
  });

  it('shows the discard confirm instead of closing when the form is dirty', async () => {
    const { container, onClose } = mount();
    await fireEvent.input(q(container, '#petName') as HTMLElement, { target: { value: 'Renamed' } });

    await fireEvent.click(backBtn(container));
    expect(onClose).not.toHaveBeenCalled();
    expect(confirmDialog(container)).not.toBeNull();
  });

  it('guards Escape too (via DetailOverlay onBack)', async () => {
    const { container, onClose } = mount();
    await fireEvent.input(q(container, '#petName') as HTMLElement, { target: { value: 'Renamed' } });

    await fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    expect(confirmDialog(container)).not.toBeNull();

    // With the confirm dialog (a .modal-backdrop true-modal) open, another
    // Escape closes only the dialog — the editor stays.
    await fireEvent.keyDown(confirmDialog(container) as HTMLElement, { key: 'Escape' });
    expect(confirmDialog(container)).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('"Keep editing" dismisses the dialog and preserves the form', async () => {
    const { container, onClose } = mount();
    await fireEvent.input(q(container, '#petName') as HTMLElement, { target: { value: 'Renamed' } });
    await fireEvent.click(backBtn(container));

    await fireEvent.click(q(container, '[data-testid="discard-keep-editing"]') as HTMLElement);
    expect(confirmDialog(container)).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect((q(container, '#petName') as HTMLInputElement).value).toBe('Renamed');
  });

  it('"Discard" closes the editor without saving', async () => {
    const { container, onClose } = mount();
    await fireEvent.input(q(container, '#petName') as HTMLElement, { target: { value: 'Renamed' } });
    await fireEvent.click(backBtn(container));

    await fireEvent.click(q(container, '[data-testid="discard-confirm"]') as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('reverting an edit by hand counts as clean again', async () => {
    const { container, onClose } = mount();
    const name = q(container, '#petName') as HTMLElement;
    await fireEvent.input(name, { target: { value: 'Renamed' } });
    await fireEvent.input(name, { target: { value: 'Dobbin' } });

    await fireEvent.click(backBtn(container));
    expect(confirmDialog(container)).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
