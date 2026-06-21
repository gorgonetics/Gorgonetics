import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Pet } from '$lib/types/index.js';

// PetActions is the redesign's edit/delete affordance (icon variant for library
// rows, button variant for the workspace header). It owns the PetEditor modal
// and the delete-confirm dialog, deleting via appState.deletePet. The real
// editor is stubbed so this stays a focused unit; deletePet is spied on.

const deletePet = vi.fn(async (_id: number) => {});
vi.mock('$lib/stores/pets.js', () => ({
  appState: { deletePet: (id: number) => deletePet(id) },
}));

vi.mock('$lib/components/pet/PetEditor.svelte', async () => ({
  default: (await import('../fixtures/PetEditorStub.svelte')).default,
}));

import PetActions from '$lib/components/shared/PetActions.svelte';

const pet = { id: 7, name: 'Dobbin' } as Pet;

const q = (c: HTMLElement, sel: string) => c.querySelector(sel) as HTMLElement | null;

afterEach(() => {
  cleanup();
  deletePet.mockClear();
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

  it('opens the editor when edit is clicked', async () => {
    const { container } = render(PetActions, { pet } as never);
    expect(q(container, '[data-testid="pet-editor-stub"]')).toBeNull();
    await fireEvent.click(q(container, '[data-testid="pet-edit-btn"]') as HTMLElement);
    await waitFor(() => expect(q(container, '[data-testid="pet-editor-stub"]')).not.toBeNull());
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

  it('cancel dismisses the confirm dialog without deleting', async () => {
    const { container } = render(PetActions, { pet } as never);
    await fireEvent.click(q(container, '[data-testid="pet-delete-btn"]') as HTMLElement);
    await waitFor(() => expect(q(container, '[role="alertdialog"]')).not.toBeNull());

    await fireEvent.click(q(container, '.btn-secondary') as HTMLElement);
    await waitFor(() => expect(q(container, '[role="alertdialog"]')).toBeNull());
    expect(deletePet).not.toHaveBeenCalled();
  });
});
