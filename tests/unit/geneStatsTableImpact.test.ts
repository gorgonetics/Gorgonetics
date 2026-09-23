import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import GeneStatsTable from '$lib/components/gene/GeneStatsTable.svelte';
import type { Pet } from '$lib/types/index.js';

const pet = (over: Partial<Pet> = {}) =>
  ({ id: 1, species: 'Horse', attributes_measured: true, toughness: 72, temperament: 40, ...over }) as unknown as Pet;

const rows = [
  { attribute: 'Toughness', points: 14, known: 3, unknownPositive: 2, unknownNegative: 1 },
  { attribute: 'Temperament', points: -4, known: 1, unknownPositive: 0, unknownNegative: 0 },
];

const cells = (c: HTMLElement, attribute: string) =>
  [...(c.querySelector(`tr[data-attribute="${attribute}"]`)?.querySelectorAll('td') ?? [])].map((td) =>
    td.textContent?.trim(),
  );

describe('GeneStatsTable — impact mode', () => {
  afterEach(cleanup);

  it('shows value, measured points, the rest, and unmeasured genes per attribute', () => {
    const { container } = render(GeneStatsTable, {
      currentView: 'impact',
      petSpecies: 'Horse',
      pet: pet(),
      impactRows: rows,
    });
    expect(cells(container, 'Toughness').slice(1)).toEqual(['72', '+14', '58', '2', '1']);
    expect(cells(container, 'Temperament').slice(1)).toEqual(['40', '-4', '44', '0', '0']);
    // An attribute with no expressed effect reads as nothing measured.
    expect(cells(container, 'Virility')[2]).toBe('—');
  });

  it('does not subtract from an attribute value that was never recorded', () => {
    const { container, getByTestId } = render(GeneStatsTable, {
      currentView: 'impact',
      petSpecies: 'Horse',
      pet: pet({ attributes_measured: false }),
      impactRows: rows,
    });
    expect(cells(container, 'Toughness')[3]).toBe('—');
    expect(getByTestId('stats-impact-note').textContent).toContain('never recorded');
  });
});
