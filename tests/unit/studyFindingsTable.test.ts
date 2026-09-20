import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import StudyFindingsTable from '$lib/components/study/StudyFindingsTable.svelte';
import type { StudyFinding } from '$lib/utils/attributeStudy.js';

const finding = (over: Partial<StudyFinding> = {}): StudyFinding => ({
  gene: '14B4',
  expression: 'dominant',
  attribute: 'temperament',
  magnitude: 5,
  tier: 'direct',
  depth: 0,
  support: 12,
  dissent: 0,
  witnesses: [['1', '2']],
  ...over,
});

const names = new Map([
  ['1', 'Kb F 23 77 96 88 56 25 45'],
  ['2', 'Kb F 18 76 96 88 56 25 45'],
]);

afterEach(cleanup);

describe('StudyFindingsTable', () => {
  it('shows a positive magnitude with an explicit plus', () => {
    render(StudyFindingsTable, { findings: [finding()], names, slots: 112 });
    expect(screen.getByText('+5')).toBeTruthy();
  });

  it('shows a negative magnitude with a minus sign, not a hyphen', () => {
    render(StudyFindingsTable, { findings: [finding({ magnitude: -3 })], names, slots: 112 });
    expect(screen.getByText('−3')).toBeTruthy();
  });

  it('distinguishes a derived finding from an observed one', () => {
    // Conflating the two would present a chain of substitutions as though it
    // carried the same weight as a value a dozen pairs agree on.
    render(StudyFindingsTable, {
      findings: [finding(), finding({ gene: '01A3', tier: 'derived', depth: 2 })],
      names,
      slots: 112,
    });
    expect(screen.getByText('observed')).toBeTruthy();
    expect(screen.getByText(/derived · 2/)).toBeTruthy();
  });

  it('reports dissent alongside support', () => {
    render(StudyFindingsTable, { findings: [finding({ support: 18, dissent: 1 })], names, slots: 112 });
    expect(screen.getByText('18')).toBeTruthy();
    expect(screen.getByText(/\/\s*1/)).toBeTruthy();
  });

  it('says how much is still unknown when there is nothing to show', () => {
    // The count moved to the attribute tab above the table, which already
    // reads "Enthusiasm 59/124" — repeating it over the table cost a row.
    // It survives here, where the table has nothing else to say.
    render(StudyFindingsTable, { findings: [], names, slots: 112 });
    expect(screen.getByText(/112 effects/)).toBeTruthy();
  });

  it('reveals the witness pair by name on demand', async () => {
    render(StudyFindingsTable, { findings: [finding()], names, slots: 112 });
    expect(screen.queryByText('Kb F 23 77 96 88 56 25 45')).toBeNull();
    await fireEvent.click(screen.getByText('Show work'));
    expect(screen.getByText('Kb F 23 77 96 88 56 25 45')).toBeTruthy();
    expect(screen.getByText('Kb F 18 76 96 88 56 25 45')).toBeTruthy();
  });

  it('falls back to the id when a name is missing', async () => {
    render(StudyFindingsTable, { findings: [finding()], names: new Map(), slots: 112 });
    await fireEvent.click(screen.getByText('Show work'));
    expect(screen.getByText('#1')).toBeTruthy();
  });

  it('explains an empty attribute rather than showing a bare table', () => {
    render(StudyFindingsTable, { findings: [], names, slots: 112 });
    expect(screen.getByText(/None of this attribute's 112 effects is pinned yet/)).toBeTruthy();
  });
});

/**
 * Column sorting.
 *
 * A component test rather than end-to-end because the interesting part is the
 * comparator, and a corpus that yields findings ordered usefully on every one
 * of five columns is far harder to seed than it is to state as props.
 */
/** Deliberately not in any column's sorted order, so a sort has to do work. */
const FINDINGS: StudyFinding[] = [
  finding({ gene: '03C2', expression: 'recessive', magnitude: -6, tier: 'system', support: 4 }),
  finding({ gene: '01A1', expression: 'dominant', magnitude: 9, tier: 'derived', support: 11 }),
  finding({ gene: '02B7', expression: 'recessive', magnitude: 2, tier: 'direct', support: 7 }),
];

function mount() {
  const { container } = render(StudyFindingsTable, {
    props: { findings: FINDINGS, names: new Map<string, string>(), slots: 9 },
  });
  const genes = () => [...container.querySelectorAll('tbody tr td.gene')].map((td) => td.textContent?.trim() ?? '');
  const click = async (id: string) => {
    const th = container.querySelector(`[data-testid="study-sort-${id}"]`);
    if (!th) throw new Error(`no header button for ${id}`);
    await fireEvent.click(th);
  };
  return { container, genes, click };
}

afterEach(cleanup);

describe('StudyFindingsTable sorting', () => {
  it('leaves the engine order alone until a header is clicked', () => {
    const { genes } = mount();
    // Most certain first, then best supported — not arbitrary, so it is the
    // right thing to show before anyone asks for something else.
    expect(genes()).toEqual(['03C2', '01A1', '02B7']);
  });

  it('sorts by every column', async () => {
    const { genes, click } = mount();

    await click('gene');
    expect(genes()).toEqual(['01A1', '02B7', '03C2']);

    await click('expression');
    expect(genes()).toEqual(['01A1', '03C2', '02B7']);

    // Numeric columns open descending: the largest magnitude and the
    // best-supported finding are what the table is opened to see.
    await click('magnitude');
    expect(genes()).toEqual(['01A1', '02B7', '03C2']);

    await click('support');
    expect(genes()).toEqual(['01A1', '02B7', '03C2']);

    // `tier` ranks by certainty, not spelling — observed, derived, solved.
    await click('tier');
    expect(genes()).toEqual(['03C2', '01A1', '02B7']);
  });

  it('reverses on a second click and restores the engine order on a third', async () => {
    const { genes, click } = mount();

    await click('gene');
    expect(genes()).toEqual(['01A1', '02B7', '03C2']);
    await click('gene');
    expect(genes()).toEqual(['03C2', '02B7', '01A1']);
    // Rather than cycling between two sorts the player may not have wanted.
    await click('gene');
    expect(genes()).toEqual(['03C2', '01A1', '02B7']);
  });

  it('marks the sorted column for assistive technology', async () => {
    const { container, click } = mount();
    expect(container.querySelectorAll('th[aria-sort="none"]').length).toBe(5);

    await click('magnitude');
    // Not `:not([aria-sort="none"])` — the evidence column carries no
    // `aria-sort` at all, being unsortable, and would match that.
    const sorted = container.querySelectorAll('th[aria-sort="ascending"], th[aria-sort="descending"]');
    expect(sorted.length).toBe(1);
    expect(sorted[0].getAttribute('aria-sort')).toBe('descending');
  });
});
