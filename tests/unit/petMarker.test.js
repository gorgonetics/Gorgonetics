import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/services/petService.js', () => ({
  updatePet: vi.fn(),
  getAllPets: vi.fn(),
  deletePet: vi.fn(),
  reorderPets: vi.fn(),
  uploadPet: vi.fn(),
}));

import { updatePet } from '$lib/services/petService.js';
import { appState, error, loading, pets, selectedPet } from '$lib/stores/pets.js';

function makePet(id, overrides = {}) {
  return {
    id,
    name: `Pet-${id}`,
    species: 'BeeWasp',
    starred: false,
    stabled: false,
    is_pet_quality: false,
    tags: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(updatePet).mockReset().mockResolvedValue(true);
  pets.set([makePet(1), makePet(2)]);
  selectedPet.set(null);
  error.set(null);
  loading.set(false);
});

afterEach(() => {
  pets.set([]);
  selectedPet.set(null);
  error.set(null);
});

describe('appState.setPetMarker', () => {
  it('flips the field in place without reloading or touching other pets', async () => {
    await appState.setPetMarker(1, 'stabled', true);

    const list = get(pets);
    expect(list.find((p) => p.id === 1).stabled).toBe(true);
    expect(list.find((p) => p.id === 2).stabled).toBe(false);
    expect(updatePet).toHaveBeenCalledExactlyOnceWith(1, { stabled: true });
  });

  it('does not raise the global loading flag', async () => {
    let sawLoading = false;
    const unsub = loading.subscribe((v) => {
      if (v) sawLoading = true;
    });
    await appState.setPetMarker(1, 'starred', true);
    unsub();
    expect(sawLoading).toBe(false);
  });

  it('mirrors the change onto selectedPet when it is the same pet', async () => {
    selectedPet.set(makePet(1));
    await appState.setPetMarker(1, 'starred', true);
    expect(get(selectedPet).starred).toBe(true);
  });

  it('leaves selectedPet untouched when a different pet is toggled', async () => {
    selectedPet.set(makePet(2));
    await appState.setPetMarker(1, 'stabled', true);
    expect(get(selectedPet).stabled).toBe(false);
  });

  it('rolls back the optimistic change and surfaces the error when the write throws', async () => {
    selectedPet.set(makePet(1));
    vi.mocked(updatePet).mockRejectedValueOnce(new Error('db down'));

    await expect(appState.setPetMarker(1, 'stabled', true)).rejects.toThrow('db down');

    expect(get(pets).find((p) => p.id === 1).stabled).toBe(false);
    expect(get(selectedPet).stabled).toBe(false);
    expect(get(error)).toMatch(/Failed to update pet/);
  });

  it('rolls back when the write reports no rows committed', async () => {
    vi.mocked(updatePet).mockResolvedValueOnce(false);

    await expect(appState.setPetMarker(1, 'starred', true)).rejects.toThrow();

    expect(get(pets).find((p) => p.id === 1).starred).toBe(false);
  });
});
