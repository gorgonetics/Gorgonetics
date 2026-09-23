import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import NameBackfillDialog from '$lib/components/mypets/NameBackfillDialog.svelte';
import { appState, pets } from '$lib/stores/pets.js';
import type { Pet } from '$lib/types/index.js';

const VALUES = {
  temperament: 60,
  toughness: 70,
  ruggedness: 65,
  enthusiasm: 80,
  friendliness: 90,
  intelligence: 100,
  virility: 55,
};

const pet = (over: Partial<Pet>): Pet =>
  ({
    species: 'Horse',
    breed: 'Kurbone',
    gender: 'Female',
    attributes_measured: false,
    ...Object.fromEntries(Object.keys(VALUES).map((k) => [k, 50])),
    ...over,
  }) as unknown as Pet;

describe('NameBackfillDialog', () => {
  beforeEach(() => {
    pets.set([
      pet({ id: 1, name: 'Kb F 60 70 65 80 90 100 55' }),
      pet({ id: 2, name: 'Kb F 60 70 65 80 90 100 55 Edited', attributes_measured: true, ...VALUES, toughness: 72 }),
      pet({ id: 3, name: 'Dusty' }),
    ]);
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('fills the unmeasured pets in one step', async () => {
    const update = vi.spyOn(appState, 'updatePets').mockResolvedValue(undefined);
    const { getByTestId } = render(NameBackfillDialog, { onClose: () => {} });
    expect(getByTestId('name-backfill-fill-count').textContent).toContain('1 pet has');

    await fireEvent.click(getByTestId('name-backfill-fill'));
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][0]).toEqual([{ petId: 1, data: { attributes: VALUES, gender: 'Female' } }]);
  });

  it('lists a disagreement and changes it only on request', async () => {
    const update = vi.spyOn(appState, 'updatePets').mockResolvedValue(undefined);
    const { getAllByTestId, getByText } = render(NameBackfillDialog, { onClose: () => {} });
    const conflicts = getAllByTestId('name-backfill-conflict');
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].textContent).toContain('Toughness 72 → 70');
    expect(update).not.toHaveBeenCalled();

    await fireEvent.click(getByText('Use name values'));
    expect(update.mock.calls[0][0][0].petId).toBe(2);
  });
});
