import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import BreedingPairTable from '$lib/components/breeding/BreedingPairTable.svelte';
import { breedingView } from '$lib/stores/breeding.svelte.js';
import type { BreedingPairResult, Pet } from '$lib/types/index.js';

const pet = (over: Partial<Pet>): Pet =>
  ({
    id: 0,
    name: 'Pet',
    species: 'Horse',
    breed: 'Standardbred',
    gender: 'Female',
    tags: [],
    stabled: true,
    positive_genes: 0,
    ...over,
  }) as unknown as Pet;

const result = (male: Pet, female: Pet): BreedingPairResult => ({
  male,
  female,
  evMixed: 1,
  evPositiveByAttribute: {},
  evPositiveTotal: 2,
  evPositiveWeighted: 2,
  evCapabilityGain: 1,
  evPositiveImprovement: 0.5,
  evPairUpgrade: 1.5,
  betterParentPositives: 2,
  weakerParentPositives: 1,
  evAttributeImprovement: {},
  evNegativeTotal: 0,
  evLiabilityReduction: 0,
  cleanerParentNegatives: 0,
  evUnknown: 0,
  totalLoci: 10,
});

const RESULTS = [result(pet({ id: 1, name: 'Dusty', gender: 'Male' }), pet({ id: 2, name: 'Roach' }))];

function resetView() {
  breedingView.species = '';
  breedingView.offspringBreed = '';
  breedingView.sortCol = 'evPositiveTotal';
  breedingView.sortDir = 'desc';
  breedingView.selectedPair = null;
  breedingView.scrollTop = 0;
  breedingView.scrollLeft = 0;
}

beforeEach(resetView);

afterEach(() => {
  cleanup();
  resetView();
});

const wrapper = (c: HTMLElement) => c.querySelector('[data-testid="breeding-pair-table"]') as HTMLDivElement;

describe('BreedingPairTable — scroll persistence', () => {
  it('restores the persisted offsets once rows are rendered', async () => {
    breedingView.scrollTop = 120;
    breedingView.scrollLeft = 40;
    const { container, rerender } = render(BreedingPairTable, { results: RESULTS, attrNames: [] });
    await rerender({});
    expect(wrapper(container).scrollTop).toBe(120);
    expect(wrapper(container).scrollLeft).toBe(40);
  });

  it('persists the wrapper offsets into the store on scroll', async () => {
    const { container, rerender } = render(BreedingPairTable, { results: RESULTS, attrNames: [] });
    await rerender({});
    const el = wrapper(container);
    el.scrollTop = 80;
    el.scrollLeft = 15;
    await fireEvent.scroll(el);
    expect(breedingView.scrollTop).toBe(80);
    expect(breedingView.scrollLeft).toBe(15);
  });

  it('re-syncs the DOM when the store offsets are reset externally (species change)', async () => {
    const { container, rerender } = render(BreedingPairTable, { results: RESULTS, attrNames: [] });
    await rerender({});
    const el = wrapper(container);

    // User scrolls; the store follows.
    el.scrollTop = 200;
    el.scrollLeft = 30;
    await fireEvent.scroll(el);
    expect(breedingView.scrollTop).toBe(200);

    // A species change resets the store while the table stays mounted — the
    // DOM must follow, or the next scroll event would re-persist the stale
    // offsets over the reset.
    breedingView.scrollTop = 0;
    breedingView.scrollLeft = 0;
    await rerender({});
    expect(el.scrollTop).toBe(0);
    expect(el.scrollLeft).toBe(0);
  });

  it('a store write echoing the element position does not loop or move the DOM', async () => {
    const { container, rerender } = render(BreedingPairTable, { results: RESULTS, attrNames: [] });
    await rerender({});
    const el = wrapper(container);

    el.scrollTop = 60;
    await fireEvent.scroll(el);
    await rerender({});
    // The sync effect saw store === element and left the DOM alone.
    expect(el.scrollTop).toBe(60);
    expect(breedingView.scrollTop).toBe(60);
  });
});

describe('BreedingPairTable — row bench', () => {
  const m = (id: number, name: string) => pet({ id, name, gender: 'Male' });
  const f = (id: number, name: string) => pet({ id, name });
  const MULTI = [result(m(1, 'A'), f(2, 'X')), result(m(3, 'B'), f(4, 'Y'))];

  it('invokes onBench with the animal id from a row bench button', async () => {
    const benched: number[] = [];
    const { container, rerender } = render(BreedingPairTable, {
      results: MULTI,
      attrNames: [],
      onBench: (id: number) => benched.push(id),
    });
    await rerender({});
    const btn = container.querySelector('[data-testid="bench-animal"]') as HTMLButtonElement;
    await fireEvent.click(btn);
    expect(benched).toEqual([Number(btn.getAttribute('data-pet-id'))]);
  });

  it('omits row bench buttons when onBench is not provided', async () => {
    const { container, rerender } = render(BreedingPairTable, { results: MULTI, attrNames: [] });
    await rerender({});
    expect(container.querySelectorAll('[data-testid="bench-animal"]').length).toBe(0);
  });
});

describe('BreedingPairTable — suggested plan groups', () => {
  const m = (id: number, name: string) => pet({ id, name, gender: 'Male' });
  const f = (id: number, name: string) => pet({ id, name });
  const plans = [
    { pairs: [result(m(1, 'A'), f(2, 'X')), result(m(3, 'B'), f(4, 'Y'))], total: 20 },
    { pairs: [result(m(1, 'A'), f(4, 'Y')), result(m(3, 'B'), f(2, 'X'))], total: 18 },
  ];

  it('renders one colour-coded group per plan, best first', async () => {
    const { container, rerender } = render(BreedingPairTable, { results: [], attrNames: [], plans });
    await rerender({});
    const groups = container.querySelectorAll('[data-testid="plan-option"]');
    expect(groups.length).toBe(2);
    expect(groups[0].textContent).toContain('Option 1');
    expect(groups[0].textContent).toContain('best');
    expect(groups[0].querySelectorAll('[data-testid="inspect-pair"]').length).toBe(2);
    // Distinct colour per option.
    const c0 = (groups[0] as HTMLElement).style.getPropertyValue('--option-color').trim();
    const c1 = (groups[1] as HTMLElement).style.getPropertyValue('--option-color').trim();
    expect(c0).not.toBe('');
    expect(c0).not.toBe(c1);
  });

  it('renders the flat ranking (no groups) when plans is absent', async () => {
    const { container, rerender } = render(BreedingPairTable, {
      results: [result(m(1, 'A'), f(2, 'X'))],
      attrNames: [],
    });
    await rerender({});
    expect(container.querySelectorAll('[data-testid="plan-option"]').length).toBe(0);
    expect(container.querySelectorAll('[data-testid="inspect-pair"]').length).toBe(1);
  });
});

describe('BreedingPairTable — column integrity', () => {
  /**
   * The header row is generated from `columns`; the body cells are written
   * out by hand. Adding a column to one and not the other shifts every value
   * silently — each cell still renders a plausible number, just under the
   * wrong heading. That shipped once. This is the guard.
   */
  it('renders exactly one body cell per header', async () => {
    const { container, rerender } = render(BreedingPairTable, { results: RESULTS, attrNames: ['Toughness'] });
    await rerender({});
    const headers = container.querySelectorAll('thead th').length;
    const cells = container.querySelectorAll('tbody tr td').length;
    expect(cells).toBe(headers);
  });

  /**
   * `sortCol` persists across species. A `attribute:<Name>` column left over
   * from another species must not render a Δ column whose accessor reads an
   * attribute this species does not have — every row would show 0.0.
   */
  it('drops a Δ column for an attribute the species lacks', async () => {
    breedingView.sortCol = 'attribute:Endurance';
    const { container, rerender } = render(BreedingPairTable, { results: RESULTS, attrNames: ['Toughness'] });
    await rerender({});
    const headers = [...container.querySelectorAll('thead th')].map((h) => h.textContent?.replace(/[▲▼]/g, '').trim());
    expect(headers).not.toContain('Δ Endurance');
    // The known attribute still gets its Δ column.
    breedingView.sortCol = 'attribute:Toughness';
    await rerender({});
    const after = [...container.querySelectorAll('thead th')].map((h) => h.textContent?.replace(/[▲▼]/g, '').trim());
    expect(after).toContain('Δ Toughness');
  });

  it('puts each metric under its own heading', async () => {
    const { container, rerender } = render(BreedingPairTable, { results: RESULTS, attrNames: [] });
    await rerender({});
    const headers = [...container.querySelectorAll('thead th')].map((h) => h.textContent?.replace(/[▲▼]/g, '').trim());
    const cells = [...container.querySelectorAll('tbody tr td')].map((c) => c.textContent?.trim());
    const at = (label: string) => cells[headers.indexOf(label)];
    // Values come from the RESULTS fixture; each must land under its label.
    expect(at('Quality')).toBe('1.0');
    expect(at('Ceiling')).toBe('0.5');
    expect(at('Floor')).toBe('1.5');
    expect(at('Total +')).toBe('2.0');
  });
});
