import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { writable } from 'svelte/store';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Pet } from '$lib/types/index.js';

// Covers the detail header rework (#394/#395): the shared BreedSelector
// popover replaces the 11-wide abbreviation row (with the Auto follow-the-pet
// behaviour preserved), the control strip separates exclusive views from the
// Stats/Gallery toggles and the Share/Edit/Delete actions, opening the Gallery
// clears the sibling view highlight (the stale-highlight bug), and the pet
// name is no longer duplicated under the DetailOverlay title.

vi.mock('$lib/stores/settings.js', () => ({
  settings: writable<Record<string, unknown>>({}),
}));

vi.mock('$lib/stores/pets.js', () => ({
  appState: { deletePet: vi.fn(async () => {}) },
}));

// Stub the heavy/irrelevant children; the header behaviour is what's under test.
vi.mock('$lib/components/gene/GeneVisualizer.svelte', async () => ({
  default: (await import('./fixtures/ChildStub.svelte')).default,
}));
vi.mock('$lib/components/gene/GeneStatsTable.svelte', async () => ({
  default: (await import('./fixtures/ChildStub.svelte')).default,
}));
vi.mock('$lib/components/pet/PetImageGallery.svelte', async () => ({
  default: (await import('./fixtures/ChildStub.svelte')).default,
}));
vi.mock('$lib/components/community/SharePetDialog.svelte', async () => ({
  default: (await import('./fixtures/ChildStub.svelte')).default,
}));

import PetVisualization from '$lib/components/pet/PetVisualization.svelte';

function makePet(overrides: Partial<Pet> = {}): Pet {
  return {
    id: 3,
    name: 'Dobbin',
    species: 'Horse',
    gender: 'Male',
    breed: 'Kurbone',
    ...overrides,
  } as Pet;
}

const q = (c: HTMLElement, sel: string) => c.querySelector(sel) as HTMLElement | null;
const btn = (c: HTMLElement, text: string) =>
  [...c.querySelectorAll<HTMLButtonElement>('.view-btn')].find(
    (b) => b.textContent?.trim() === text,
  ) as HTMLButtonElement;

afterEach(cleanup);

describe('PetVisualization detail header', () => {
  it('does not repeat the pet name (DetailOverlay owns the title); only the meta line renders', () => {
    const { container } = render(PetVisualization, { pet: makePet() });
    expect(q(container, '.detail-title')).toBeNull();
    expect(q(container, '.detail-meta')?.textContent).toContain('Horse');
  });

  describe('breed control (#394)', () => {
    it('renders the shared BreedSelector popover instead of the abbreviation button row', () => {
      const { container } = render(PetVisualization, { pet: makePet() });
      expect(q(container, '[data-testid="breed-selector-trigger"]')).not.toBeNull();
      expect(container.querySelectorAll('.breed-btn')).toHaveLength(0);
    });

    it('omits the breed control for non-horse pets', () => {
      const { container } = render(PetVisualization, { pet: makePet({ species: 'Cat', breed: '' }) });
      expect(q(container, '[data-testid="breed-selector"]')).toBeNull();
      expect(q(container, '.auto-btn')).toBeNull();
    });

    it('picking a breed from the popover updates the trigger', async () => {
      const { container } = render(PetVisualization, { pet: makePet() });
      await fireEvent.click(q(container, '[data-testid="breed-selector-trigger"]') as HTMLElement);
      await fireEvent.click(q(container, '.bs-opt[data-breed="Ilmarian"]') as HTMLElement);
      expect(q(container, '[data-testid="breed-selector-trigger"] .bs-value')?.textContent).toBe('Ilmarian');
    });

    it("Auto follows the pet's breed and locks the selector; toggling off releases it", async () => {
      const { container } = render(PetVisualization, { pet: makePet({ breed: 'Kurbone' }) });
      const auto = q(container, '.auto-btn') as HTMLButtonElement;
      expect(auto).not.toBeNull();
      expect(auto.getAttribute('aria-pressed')).toBe('false');

      await fireEvent.click(auto);
      const trigger = q(container, '[data-testid="breed-selector-trigger"]') as HTMLButtonElement;
      expect(auto.getAttribute('aria-pressed')).toBe('true');
      expect(trigger.disabled).toBe(true);
      expect(trigger.querySelector('.bs-value')?.textContent).toBe('Kurbone');

      await fireEvent.click(auto);
      expect(trigger.disabled).toBe(false);
      expect(trigger.querySelector('.bs-value')?.textContent).toBe('All');
    });

    it('hides the Auto button when the breed is unknown', () => {
      const { container } = render(PetVisualization, { pet: makePet({ breed: 'Mixed' }) });
      expect(q(container, '.auto-btn')).toBeNull();
      expect(q(container, '[data-testid="breed-selector-trigger"]')).not.toBeNull();
    });
  });

  describe('control strip separation (#395)', () => {
    it('keeps Attributes/Appearance as the exclusive segmented pair, with Stats/Gallery and actions in their own clusters', () => {
      const { container } = render(PetVisualization, { pet: makePet() });
      const segment = q(container, '.view-controls') as HTMLElement;
      expect([...segment.querySelectorAll('button')].map((b) => b.textContent?.trim())).toEqual([
        'Attributes',
        'Appearance',
      ]);
      expect(q(container, '.toggle-controls [data-testid="detail-stats-toggle"]')).not.toBeNull();
      expect(q(container, '.toggle-controls [data-testid="detail-gallery-toggle"]')).not.toBeNull();
      expect(q(container, '.header-actions [data-testid="share-pet-btn"]')).not.toBeNull();
      expect(q(container, '.header-actions [data-testid="pet-edit-btn"]')).not.toBeNull();
      expect(q(container, '.header-actions [data-testid="pet-delete-btn"]')).not.toBeNull();
    });

    it('Stats is a pressed toggle, not a sibling view highlight', async () => {
      const { container, getByTestId } = render(PetVisualization, { pet: makePet() });
      const stats = getByTestId('detail-stats-toggle');
      expect(stats.getAttribute('aria-pressed')).toBe('false');
      await fireEvent.click(stats);
      expect(stats.getAttribute('aria-pressed')).toBe('true');
      // Attributes stays highlighted — the grid is still the content.
      expect(btn(container, 'Attributes').classList.contains('active')).toBe(true);
      expect(q(container, '.stats-drawer')).not.toBeNull();
    });

    it('opening the Gallery clears the view highlights (stale-highlight fix)', async () => {
      const { container, getByTestId } = render(PetVisualization, { pet: makePet() });
      expect(btn(container, 'Attributes').classList.contains('active')).toBe(true);

      const gallery = getByTestId('detail-gallery-toggle');
      await fireEvent.click(gallery);
      expect(gallery.getAttribute('aria-pressed')).toBe('true');
      expect(btn(container, 'Attributes').classList.contains('active')).toBe(false);
      expect(btn(container, 'Appearance').classList.contains('active')).toBe(false);

      // Closing the gallery restores the previous view highlight.
      await fireEvent.click(gallery);
      expect(gallery.getAttribute('aria-pressed')).toBe('false');
      expect(btn(container, 'Attributes').classList.contains('active')).toBe(true);
    });

    it('opening the Gallery closes the Stats drawer so its pressed state never points at a hidden panel', async () => {
      const { container, getByTestId } = render(PetVisualization, { pet: makePet() });
      const stats = getByTestId('detail-stats-toggle');
      const gallery = getByTestId('detail-gallery-toggle');

      await fireEvent.click(stats);
      expect(stats.getAttribute('aria-pressed')).toBe('true');

      await fireEvent.click(gallery);
      expect(gallery.getAttribute('aria-pressed')).toBe('true');
      expect(stats.getAttribute('aria-pressed')).toBe('false');
      expect(q(container, '.stats-drawer')).toBeNull();

      // Pressing Stats while the gallery is open swaps back to the grid + drawer.
      await fireEvent.click(stats);
      expect(gallery.getAttribute('aria-pressed')).toBe('false');
      expect(stats.getAttribute('aria-pressed')).toBe('true');
      expect(q(container, '.stats-drawer')).not.toBeNull();
    });

    it('picking a view while the Gallery is open closes it and re-highlights the view', async () => {
      const { container, getByTestId } = render(PetVisualization, { pet: makePet() });
      const gallery = getByTestId('detail-gallery-toggle');
      await fireEvent.click(gallery);
      expect(gallery.getAttribute('aria-pressed')).toBe('true');

      await fireEvent.click(btn(container, 'Appearance'));
      expect(gallery.getAttribute('aria-pressed')).toBe('false');
      expect(btn(container, 'Appearance').classList.contains('active')).toBe(true);
      expect(btn(container, 'Attributes').classList.contains('active')).toBe(false);
    });
  });
});
