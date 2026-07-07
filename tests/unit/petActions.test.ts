import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { get } from 'svelte/store';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Pet } from '$lib/types/index.js';

// PetActions is the redesign's edit/delete affordance (icon variant for library
// rows, button variant for the workspace header). Editing is a top-level
// in-space view, so Edit sets the `editingPet` UI store (the +page overlay
// renders the editor); PetActions itself only owns the delete-confirm dialog,
// deleting via appState.deletePet (spied on here).

const deletePet = vi.fn(async (_id: number) => {});
vi.mock('$lib/stores/pets.js', () => ({
  appState: { deletePet: (id: number) => deletePet(id) },
}));

import PetActions from '$lib/components/shared/PetActions.svelte';
import { editingPet } from '$lib/stores/ui.js';

const pet = { id: 7, name: 'Dobbin' } as Pet;

const q = (c: HTMLElement, sel: string) => c.querySelector(sel) as HTMLElement | null;

afterEach(() => {
  cleanup();
  deletePet.mockClear();
  editingPet.set(null);
});

describe('PetActions', () => {
  it('renders glyph buttons in the icon variant', () => {
    const { container } = render(PetActions, { pet, variant: 'icon' } as never);
    expect(q(container, '[data-testid="pet-edit-btn"]')?.textContent).toBe('✎');
    expect(q(container, '[data-testid="pet-delete-btn"]')?.textContent).toBe('✕');
  });

  it('renders labelled buttons in the button variant', () => {
    const { container } = render(PetActions, { pet, variant: 'button' } as never);
    expect(q(container, '[data-testid="pet-edit-btn"]')?.textContent).toBe('Edit');
    expect(q(container, '[data-testid="pet-delete-btn"]')?.textContent).toBe('Delete');
  });

  it('opens the editor (sets editingPet) when edit is clicked', async () => {
    const { container } = render(PetActions, { pet } as never);
    expect(get(editingPet)).toBeNull();
    await fireEvent.click(q(container, '[data-testid="pet-edit-btn"]') as HTMLElement);
    await waitFor(() => expect(get(editingPet)).toBe(pet));
  });

  it('shows a confirm dialog on delete and calls deletePet on confirm', async () => {
    const { container } = render(PetActions, { pet } as never);
    expect(q(container, '[role="alertdialog"]')).toBeNull();

    await fireEvent.click(q(container, '[data-testid="pet-delete-btn"]') as HTMLElement);
    const dialog = await waitFor(() => {
      const d = q(container, '[role="alertdialog"]');
      expect(d).not.toBeNull();
      return d as HTMLElement;
    });
    expect(dialog.textContent).toContain('Dobbin');

    const confirm = q(dialog, '.btn-danger') as HTMLElement;
    await fireEvent.click(confirm);
    expect(deletePet).toHaveBeenCalledWith(7);
  });

  it('clicking inside the dialog does not dismiss it (only the backdrop does)', async () => {
    const { container } = render(PetActions, { pet } as never);
    await fireEvent.click(q(container, '[data-testid="pet-delete-btn"]') as HTMLElement);
    await waitFor(() => expect(q(container, '[role="alertdialog"]')).not.toBeNull());

    // A click that bubbles up from the dialog body must not close it.
    await fireEvent.click(q(container, '.confirm-message') as HTMLElement);
    expect(q(container, '[role="alertdialog"]')).not.toBeNull();
    expect(deletePet).not.toHaveBeenCalled();

    // The backdrop itself does close it.
    await fireEvent.click(q(container, '.modal-backdrop') as HTMLElement);
    await waitFor(() => expect(q(container, '[role="alertdialog"]')).toBeNull());
  });

  it('cancel dismisses the confirm dialog without deleting', async () => {
    const { container } = render(PetActions, { pet } as never);
    await fireEvent.click(q(container, '[data-testid="pet-delete-btn"]') as HTMLElement);
    await waitFor(() => expect(q(container, '[role="alertdialog"]')).not.toBeNull());

    await fireEvent.click(q(container, '.btn-secondary') as HTMLElement);
    await waitFor(() => expect(q(container, '[role="alertdialog"]')).toBeNull());
    expect(deletePet).not.toHaveBeenCalled();
  });
});
