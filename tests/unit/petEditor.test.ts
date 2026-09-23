import { cleanup, fireEvent, render } from '@testing-library/svelte';
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

describe('PetEditor — attributes from a structured name', () => {
  const nameInput = (c: HTMLElement) => c.querySelector('#petName') as HTMLInputElement;
  // Field ids use the capitalised display key (`attr-Temperament`).
  const attr = (c: HTMLElement, key: string) =>
    (c.querySelector(`#attr-${key[0].toUpperCase()}${key.slice(1)}`) as HTMLInputElement).value;

  it('fills the attribute fields, gender and an unset breed as a structured name is typed', async () => {
    const { container, getByTestId } = render(PetEditor, { pet: pet({ breed: '', gender: 'Male' as never }) });
    await fireEvent.input(nameInput(container), { target: { value: 'Kb F 60 70 65 80 90 100 55' } });

    expect(attr(container, 'temperament')).toBe('60');
    expect(attr(container, 'virility')).toBe('55');
    expect((container.querySelector('#petGender') as HTMLSelectElement).value).toBe('Female');
    expect(breedSelect(container).value).toBe('Kurbone');
    expect(getByTestId('pet-editor-name-fill')).toBeTruthy();
  });

  it('leaves the fields alone for a name that does not parse', async () => {
    const { container, queryByTestId } = render(PetEditor, { pet: pet({ temperament: 42 } as never) });
    await fireEvent.input(nameInput(container), { target: { value: 'Dusty Two' } });
    expect(attr(container, 'temperament')).toBe('42');
    expect(queryByTestId('pet-editor-name-fill')).toBeNull();
  });

  it('keeps a set breed rather than replacing it from the name', async () => {
    const { container } = render(PetEditor, { pet: pet({ breed: 'Standardbred' }) });
    await fireEvent.input(nameInput(container), { target: { value: 'Kb F 60 70 65 80 90 100 55' } });
    expect(breedSelect(container).value).toBe('Standardbred');
  });

  it('keeps hand corrections on a measured pet when only a label is added', async () => {
    const measured = pet({
      name: 'Kb F 60 70 65 80 90 100 55',
      attributes_measured: true,
      temperament: 61,
      gender: 'Female',
    } as never);
    const { container, queryByTestId } = render(PetEditor, { pet: measured });
    await fireEvent.input(nameInput(container), { target: { value: 'Kb F 60 70 65 80 90 100 55 Keeper' } });
    expect(attr(container, 'temperament')).toBe('61');
    expect(queryByTestId('pet-editor-name-fill')).toBeNull();

    // Changing a number is a new claim, and fills.
    await fireEvent.input(nameInput(container), { target: { value: 'Kb F 62 70 65 80 90 100 55 Keeper' } });
    expect(attr(container, 'temperament')).toBe('62');
  });
});
