import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import PetEditor from '$lib/components/pet/PetEditor.svelte';
import type { Pet } from '$lib/types/index.js';

const pet = (over: Partial<Pet> = {}): Pet =>
  ({
    id: 1,
    name: 'Dusty',
    species: 'Horse',
    breed: 'Standardbred',
    gender: 'Male',
    tags: [],
    ...over,
  }) as unknown as Pet;

const breedSelect = (c: HTMLElement) => c.querySelector('#petBreed') as HTMLSelectElement;

afterEach(cleanup);

describe('PetEditor — breed select', () => {
  it('offers an explicit empty "Not set" option', () => {
    const { container } = render(PetEditor, { pet: pet() });
    const first = breedSelect(container).options[0];
    expect(first.value).toBe('');
    expect(first.textContent).toBe('Not set');
  });

  it('selects the stored breed when it is a known option', () => {
    const { container } = render(PetEditor, { pet: pet() });
    expect(breedSelect(container).value).toBe('Standardbred');
  });

  it("binds an unset breed ('') to the empty option, not the first breed", () => {
    const { container } = render(PetEditor, { pet: pet({ breed: '' }) });
    expect(breedSelect(container).value).toBe('');
  });

  it('binds an unknown breed to the empty option rather than misassigning one', () => {
    const { container } = render(PetEditor, { pet: pet({ breed: 'NotARealBreed' }) });
    expect(breedSelect(container).value).toBe('');
  });
});
