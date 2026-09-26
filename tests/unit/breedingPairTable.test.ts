import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import BreedingPairTable from '$lib/components/breeding/BreedingPairTable.svelte';
import { breedingView } from '$lib/stores/breeding.svelte.js';
import type { BreedingPairResult, Pet } from '$lib/types/index.js';
import { buildAttributeMagnitudes } from '$lib/utils/attributePoints.js';
import type { AttributeStudy, StudyFinding } from '$lib/utils/attributeStudy.js';

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
  evCapabilityGain: 1,
  evPositiveImprovement: 0.5,
  evPairUpgrade: 1.5,
  betterParentPositives: 2,
  weakerParentPositives: 1,
  evAttributeImprovement: {},
  evNegativeTotal: 0,
  evLiabilityReduction: 0,
  cleanerParentNegatives: 0,
  maleProfile: { positives: 2, negatives: 0, positivesByAttribute: {} },
  femaleProfile: { positives: 1, negatives: 0, positivesByAttribute: {} },
  positiveSd: 0,
  negativeSd: 0,
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
    expect(at('+ genes')).toBe('2.0');
  });
});

/**
 * The absolute columns (+ genes, the per-attribute ones) are expected counts
 * with no baseline of their own. Read alone they cannot answer the question
 * breeding is actually asking — is this foal better than its parents — so the
 * table carries the parents' own counts and the signed gap.
 */
describe('BreedingPairTable — reading the absolute columns against the parents', () => {
  const cellsByHeader = (container: HTMLElement) => {
    const headers = [...container.querySelectorAll('thead th')].map((h) => h.textContent?.replace(/[▲▼]/g, '').trim());
    const cells = [...container.querySelectorAll('tbody tr td')];
    return (label: string) => cells[headers.indexOf(label)];
  };

  it("shows each parent's own positive count beside its name", async () => {
    const { container, rerender } = render(BreedingPairTable, { results: RESULTS, attrNames: [] });
    await rerender({});
    const counts = [...container.querySelectorAll('[data-testid="parent-positives"]')].map((e) => e.textContent);
    expect(counts).toEqual(['2', '1']);
  });

  /**
   * The case the improvement columns cannot express: `Ceiling` is
   * `E[max(0, ...)]`, so a foal far below the better parent and one barely
   * below it both read 0.00. The gap has to come from somewhere else.
   */
  it('shows an unclamped signed gap under + genes, including when the foal is worse', async () => {
    const male = pet({ id: 1, name: 'Dusty', gender: 'Male' });
    const female = pet({ id: 2, name: 'Roach' });
    const worse: BreedingPairResult = {
      ...result(male, female),
      evPositiveTotal: 241.75,
      betterParentPositives: 336,
      weakerParentPositives: 236,
      evPositiveImprovement: 0,
      maleProfile: { positives: 336, negatives: 0, positivesByAttribute: {} },
      femaleProfile: { positives: 236, negatives: 0, positivesByAttribute: {} },
    };
    const { container, rerender } = render(BreedingPairTable, { results: [worse], attrNames: [] });
    await rerender({});
    const at = cellsByHeader(container);

    // Ceiling bottoms out at zero and says nothing about the size of the gap...
    expect(at('Ceiling').textContent?.trim()).toBe('0.0');
    // ...so the gap is stated outright, with its sign.
    expect(at('+ genes').querySelector('[data-testid="pair-delta"]')?.textContent).toBe('−94.3');
    expect(at('+ genes').querySelector('[data-testid="pair-delta"]')?.className).toContain('down');
  });

  it('marks a foal expected to beat the better parent as up', async () => {
    const male = pet({ id: 1, name: 'Dusty', gender: 'Male' });
    const female = pet({ id: 2, name: 'Roach' });
    const better: BreedingPairResult = {
      ...result(male, female),
      evPositiveTotal: 12,
      betterParentPositives: 8,
      maleProfile: { positives: 8, negatives: 0, positivesByAttribute: {} },
      femaleProfile: { positives: 3, negatives: 0, positivesByAttribute: {} },
    };
    const { container, rerender } = render(BreedingPairTable, { results: [better], attrNames: [] });
    await rerender({});
    const tag = cellsByHeader(container)('+ genes').querySelector('[data-testid="pair-delta"]');
    expect(tag?.textContent).toBe('+4.0');
    expect(tag?.className).toContain('up');
  });

  /**
   * Each attribute has its own baseline. A pair can lead the field on
   * Intelligence while beating neither parent's Intelligence, so the aggregate
   * baseline would misreport it.
   */
  it("measures an attribute against that attribute's own better parent", async () => {
    const male = pet({ id: 1, name: 'Dusty', gender: 'Male' });
    const female = pet({ id: 2, name: 'Roach' });
    const pair: BreedingPairResult = {
      ...result(male, female),
      evPositiveTotal: 40,
      betterParentPositives: 40,
      evPositiveByAttribute: { Intelligence: 6 },
      // Aggregate counts are equal, so the + genes gap is nil — but the male
      // leads on Intelligence, and the foal falls four short of him there.
      maleProfile: { positives: 40, negatives: 0, positivesByAttribute: { Intelligence: 10 } },
      femaleProfile: { positives: 40, negatives: 0, positivesByAttribute: { Intelligence: 4 } },
    };
    const { container, rerender } = render(BreedingPairTable, { results: [pair], attrNames: ['Intelligence'] });
    await rerender({});
    const at = cellsByHeader(container);

    expect(at('+ genes').querySelector('[data-testid="pair-delta"]')).toBeNull();
    expect(at('Intelligence').querySelector('[data-testid="pair-delta"]')?.textContent).toBe('−4.0');
  });

  it('stays quiet when the gap rounds to nothing', async () => {
    const { container, rerender } = render(BreedingPairTable, { results: RESULTS, attrNames: [] });
    await rerender({});
    // The fixture's foal matches the better parent exactly.
    expect(container.querySelector('[data-testid="pair-delta"]')).toBeNull();
  });

  /**
   * With measured points beside it, "Total +" read as a quality figure. It is
   * a count, and the pool-weighted variant of it is gone.
   */
  it('labels the positive count as a count and drops the pool-weighted column', async () => {
    const { container, rerender } = render(BreedingPairTable, { results: RESULTS, attrNames: [] });
    await rerender({});
    const headers = [...container.querySelectorAll('thead th')].map((h) => h.textContent?.replace(/[▲▼]/g, '').trim());
    expect(headers).toContain('+ genes');
    expect(headers).not.toContain('Total +');
    expect(headers).not.toContain('Pool-weighted +');
  });
});

describe('BreedingPairTable — attribute columns', () => {
  const study = (attribute: string, slots: number, findings: StudyFinding[]): AttributeStudy => ({
    attribute,
    slots,
    findings,
    contradictions: [],
    geneDoubts: [],
    validation: { tested: 0, exact: 0, stabledTested: 0, stabledExact: 0, suspects: [] },
    contributors: 2,
    baselines: { readings: [], offsets: [] },
  });

  const magnitudes = buildAttributeMagnitudes([
    study('toughness', 9, [
      {
        gene: '01A1',
        expression: 'dominant',
        attribute: 'toughness',
        magnitude: 4,
        tier: 'direct',
        depth: 0,
        support: 5,
        dissent: 0,
        witnesses: [],
      },
    ]),
    study('friendliness', 4, []),
  ]);

  const scored = (): BreedingPairResult[] => [
    {
      ...RESULTS[0],
      evPositiveByAttribute: { Toughness: 1.5, Friendliness: 0.5 },
      evPointsByAttribute: { Toughness: 6 },
      evAttributePointImprovement: { Toughness: 2 },
    },
  ];

  const headers = (container: HTMLElement) => [...container.querySelectorAll('th')].map((th) => th.textContent?.trim());

  it('counts effects when no study has run', async () => {
    const { container, rerender } = render(BreedingPairTable, {
      results: scored(),
      attrNames: ['Toughness', 'Friendliness'],
    });
    await rerender({});
    expect(headers(container)).toContain('Toughness');
    expect(headers(container)).not.toContain('Toughness pts');
  });

  it('switches a measured attribute to points and says how much is known', async () => {
    const { container, rerender } = render(BreedingPairTable, {
      results: scored(),
      attrNames: ['Toughness', 'Friendliness'],
      magnitudes,
    });
    await rerender({});
    expect(headers(container)).toContain('Toughness pts');
    // Friendliness was studied and nothing was found, so it keeps the count
    // rather than showing a column of zeroes.
    expect(headers(container)).toContain('Friendliness');

    const measured = [...container.querySelectorAll('th')].find((th) => th.textContent?.includes('Toughness'));
    expect(measured?.getAttribute('title')).toContain('1 of 9');

    // The cell follows the header: points for the measured attribute, the
    // count for the one the study could not reach.
    const cells = [...container.querySelectorAll('tbody td.numeric')].map((td) => td.textContent?.trim());
    expect(cells.some((text) => text?.startsWith('6'))).toBe(true);
    expect(cells.some((text) => text?.startsWith('0.5'))).toBe(true);
  });

  it('has no Net pts column until the study has measured something', async () => {
    const { container, rerender } = render(BreedingPairTable, {
      results: scored(),
      attrNames: ['Toughness', 'Friendliness'],
    });
    await rerender({});
    expect(headers(container)).not.toContain('Net pts');
    expect(container.querySelector('[data-testid="pair-net-points"]')).toBeNull();
  });

  it('sums the measured attributes into Net pts, with coverage over every attribute', async () => {
    const finding = (gene: string, attribute: string, magnitude: number): StudyFinding => ({
      gene,
      expression: 'dominant',
      attribute,
      magnitude,
      tier: 'direct',
      depth: 0,
      support: 5,
      dissent: 0,
      witnesses: [],
    });
    const two = buildAttributeMagnitudes([
      study('toughness', 9, [finding('01A1', 'toughness', 4)]),
      study('friendliness', 4, [finding('01A2', 'friendliness', -2)]),
    ]);
    // Parent nets: male 4 + 0 = 4, female 2 − 3 = −1. The better parent is 4.
    const profile = (toughness: number, friendliness: number) => ({
      positives: 0,
      negatives: 0,
      positivesByAttribute: {},
      pointsByAttribute: { Toughness: toughness, Friendliness: friendliness },
      lockedPositives: 0,
    });
    const render_ = (foalFriendliness: number) =>
      render(BreedingPairTable, {
        results: [
          {
            ...scored()[0],
            evPointsByAttribute: { Toughness: 6, Friendliness: foalFriendliness },
            maleProfile: profile(4, 0),
            femaleProfile: profile(2, -3),
          },
        ],
        attrNames: ['Toughness', 'Friendliness'],
        magnitudes: two,
      });

    const { container, rerender, unmount } = render_(-1.5);
    await rerender({});
    const header = [...container.querySelectorAll('th')].find((th) => th.textContent?.trim() === 'Net pts');
    expect(header?.getAttribute('title')).toContain('2 of 13');
    const cell = container.querySelector('[data-testid="pair-net-points"]');
    expect(cell?.textContent?.trim()).toMatch(/^4\.5/);
    // 4.5 against the better parent's 4.
    const up = cell?.querySelector('[data-testid="pair-delta"]');
    expect(up?.textContent).toBe('+0.5');
    expect(up?.className).toContain('up');
    unmount();

    // A foal below the better parent gets a signed gap the other way: 6 − 4 = 2 < 4.
    const below = render_(-4);
    await below.rerender({});
    const down = below.container.querySelector('[data-testid="pair-net-points"] [data-testid="pair-delta"]');
    expect(down?.textContent).toBe('−2.0');
    expect(down?.className).toContain('down');
  });
});
