import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import GeneFilterSection from '$lib/components/mypets/GeneFilterSection.svelte';
import Roster from '$lib/components/mypets/Roster.svelte';
import type * as geneCriteriaService from '$lib/services/geneCriteriaService.js';
import * as petLociCache from '$lib/services/petLociCache.js';
import { clearGeneCriteria, myPetsView } from '$lib/stores/mypets.svelte.js';
import { GeneType, type Pet } from '$lib/types/index.js';
import type { GeneCriterion, GroupCriterion, LocusCriterion } from '$lib/utils/geneCriteria.js';
import { groupMatchCounts } from '$lib/utils/geneCriteria.js';
import type { PetLoci } from '$lib/utils/petLoci.js';

vi.mock('$lib/services/geneCriteriaService.js', async (importOriginal) => {
  const original = await importOriginal<typeof geneCriteriaService>();
  return {
    ...original,
    listExpandableGroups: vi.fn(async () => [
      { source: { type: 'attribute', attribute: 'Toughness' }, label: 'Toughness', lociCount: 2 },
    ]),
    expandGroupCriterion: vi.fn(
      async (): Promise<GroupCriterion> => ({
        kind: 'group',
        label: 'Toughness',
        source: { type: 'attribute', attribute: 'Toughness' },
        want: 'carries',
        loci: [
          { geneId: '01A1', allow: [GeneType.RECESSIVE, GeneType.MIXED] },
          { geneId: '01A2', allow: [GeneType.RECESSIVE, GeneType.MIXED] },
        ],
        min: 1,
      }),
    ),
  };
});

vi.mock('$lib/services/petLociCache.js', () => ({
  getAllPetLociCached: vi.fn(async () => new Map()),
  invalidatePetLociCache: vi.fn(),
}));

const pet = (over: Partial<Pet>): Pet =>
  ({ id: 0, name: 'Pet', species: 'Horse', tags: [], ...over }) as unknown as Pet;

const CANDIDATES = [pet({ id: 1, name: 'Dusty' }), pet({ id: 2, name: 'Roach' }), pet({ id: 3, name: 'Pip' })];

// Pet 1 matches ({R}); pet 2 reads ? (not revealed); pet 3 has no projection.
const LOCI = new Map<number, PetLoci>([
  [1, new Map([['01A1', GeneType.RECESSIVE]])],
  [2, new Map([['01A1', GeneType.UNKNOWN]])],
]);

const locusCriterion: LocusCriterion = { kind: 'locus', geneId: '01A1', allow: [GeneType.RECESSIVE] };

function resetView() {
  clearGeneCriteria();
  myPetsView.species = '';
  myPetsView.genesOpen = false;
  myPetsView.sortCol = 'name';
  myPetsView.sortDir = 'asc';
  myPetsView.selectedIds = new Set();
}

beforeEach(resetView);
afterEach(() => {
  cleanup();
  resetView();
});

describe('GeneFilterSection', () => {
  it('collapsed by default, shows the active criteria count', () => {
    myPetsView.geneCriteria = [locusCriterion];
    myPetsView.geneSpecies = 'horse';
    const { container, queryByTestId } = render(GeneFilterSection, { candidates: CANDIDATES, lociMap: LOCI });
    expect(container.querySelector('[data-testid="gene-filter-toggle"]')?.textContent).toContain('Genes (1)');
    expect(queryByTestId('gene-filter-chips')).toBeNull();
  });

  it('reports match and exclusion counts, distinguishing their causes (§3)', () => {
    myPetsView.geneCriteria = [locusCriterion];
    myPetsView.geneSpecies = 'horse';
    const { getByTestId } = render(GeneFilterSection, { candidates: CANDIDATES, lociMap: LOCI });
    const counts = getByTestId('gene-filter-counts').textContent?.replace(/\s+/g, ' ');
    expect(counts).toContain('1 of 3 match');
    expect(counts).toContain('1 not revealed');
    expect(counts).toContain('1 not imported');
  });

  it('shows a loading line instead of counts while the loci map is absent (§7)', () => {
    myPetsView.geneCriteria = [locusCriterion];
    myPetsView.geneSpecies = 'horse';
    const { getByTestId, queryByTestId } = render(GeneFilterSection, { candidates: CANDIDATES, lociMap: undefined });
    expect(getByTestId('gene-filter-loading')).toBeTruthy();
    expect(queryByTestId('gene-filter-counts')).toBeNull();
  });

  it('renders the not-revealed empty state with its own copy (§3)', () => {
    // Every candidate reads ? at the filtered locus — zero matches, all not-revealed.
    const allUnknown = new Map<number, PetLoci>(
      CANDIDATES.map((p) => [p.id, new Map([['01A1', GeneType.UNKNOWN]]) as PetLoci]),
    );
    myPetsView.geneCriteria = [locusCriterion];
    myPetsView.geneSpecies = 'horse';
    myPetsView.genesOpen = true;
    const { getByTestId } = render(GeneFilterSection, { candidates: CANDIDATES, lociMap: allUnknown });
    const copy = getByTestId('gene-filter-not-revealed').textContent;
    expect(copy).toContain('3 of 3');
    expect(copy).toContain("isn't revealed");
  });

  it('adding an attribute expands to a single chip with the median threshold', async () => {
    vi.mocked(petLociCache.getAllPetLociCached).mockResolvedValue(
      new Map<number, PetLoci>([
        [
          1,
          new Map([
            ['01A1', GeneType.RECESSIVE],
            ['01A2', GeneType.RECESSIVE],
          ]),
        ],
        [
          2,
          new Map([
            ['01A1', GeneType.RECESSIVE],
            ['01A2', GeneType.DOMINANT],
          ]),
        ],
        [
          3,
          new Map([
            ['01A1', GeneType.DOMINANT],
            ['01A2', GeneType.DOMINANT],
          ]),
        ],
      ]),
    );
    myPetsView.species = 'horse';
    myPetsView.genesOpen = true;
    const { getByTestId, findByTestId } = render(GeneFilterSection, { candidates: CANDIDATES, lociMap: undefined });
    const select = (await findByTestId('gene-filter-group')) as HTMLSelectElement;
    await fireEvent.change(select, { target: { value: 'Toughness' } });
    await fireEvent.click(getByTestId('gene-filter-add'));
    await vi.waitFor(() => {
      expect(myPetsView.geneCriteria.length).toBe(1);
    });
    const c = myPetsView.geneCriteria[0] as GroupCriterion;
    expect(c.kind).toBe('group');
    // Matched counts are [0, 1, 2] → median 1.
    expect(c.min).toBe(1);
    // One chip per criterion, not per locus (§6).
    const chips = (await findByTestId('gene-filter-chips')).querySelectorAll('[data-testid="gene-chip-group"]');
    expect(chips.length).toBe(1);
    expect(chips[0].textContent).toContain('Toughness · carries ≥1 of 2');
    // The species filter is forced and recorded (§5c).
    expect(myPetsView.geneSpecies).toBe('horse');
    expect(myPetsView.species).toBe('horse');
  });

  it('locus chip toggles: last state cannot be removed; allowing all three drops the chip (§2/§8)', async () => {
    myPetsView.geneCriteria = [locusCriterion];
    myPetsView.geneSpecies = 'horse';
    myPetsView.genesOpen = true;
    const { container } = render(GeneFilterSection, { candidates: CANDIDATES, lociMap: LOCI });
    const stateBtn = (label: string) =>
      container.querySelector(`[data-testid="gene-chip-locus"] [data-state="${label}"]`) as HTMLButtonElement;

    // R is the only active state — clicking it must not empty the set.
    await fireEvent.click(stateBtn('R'));
    expect((myPetsView.geneCriteria[0] as LocusCriterion).allow).toEqual([GeneType.RECESSIVE]);

    // Enable D, then x — all three allowed is "any", so the criterion drops.
    await fireEvent.click(stateBtn('D'));
    await fireEvent.click(stateBtn('x'));
    expect(myPetsView.geneCriteria.length).toBe(0);
  });

  it('removing the last criterion clears the species lock', async () => {
    myPetsView.geneCriteria = [locusCriterion];
    myPetsView.geneSpecies = 'horse';
    myPetsView.genesOpen = true;
    const { getByTestId } = render(GeneFilterSection, { candidates: CANDIDATES, lociMap: LOCI });
    await fireEvent.click(getByTestId('gene-chip-remove'));
    expect(myPetsView.geneCriteria.length).toBe(0);
    expect(myPetsView.geneSpecies).toBe('');
  });
});

describe('Roster gene count columns (§5a)', () => {
  it('adds a sortable matched/total column per active attribute criterion', () => {
    const criterion: GroupCriterion = {
      kind: 'group',
      label: 'Toughness',
      source: { type: 'attribute', attribute: 'Toughness' },
      want: 'carries',
      loci: [
        { geneId: '01A1', allow: [GeneType.RECESSIVE, GeneType.MIXED] },
        { geneId: '01A2', allow: [GeneType.RECESSIVE, GeneType.MIXED] },
      ],
      min: 1,
    };
    myPetsView.geneCriteria = [criterion as GeneCriterion];
    myPetsView.geneSpecies = 'horse';
    const lociMap = new Map<number, PetLoci>([
      [
        1,
        new Map([
          ['01A1', GeneType.RECESSIVE],
          ['01A2', GeneType.MIXED],
        ]),
      ],
      [2, new Map([['01A1', GeneType.UNKNOWN]])],
    ]);
    const geneCounts = new Map([1, 2].map((id) => [id, groupMatchCounts(myPetsView.geneCriteria, lociMap.get(id))]));
    const pets = [pet({ id: 1, name: 'Dusty' }), pet({ id: 2, name: 'Roach' })];
    const { container } = render(Roster, { pets, geneCounts });
    const labels = [...container.querySelectorAll('thead .sort-btn')].map((b) => b.textContent?.trim());
    expect(labels?.some((l) => l?.includes('Toughness'))).toBe(true);
    const cells = [...container.querySelectorAll('tbody td')].map((td) => td.textContent?.trim());
    expect(cells).toContain('2/2');
    expect(cells).toContain('0/2');
  });
});
