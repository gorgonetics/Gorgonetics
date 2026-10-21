import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type StudyRun, setUseForStudies, studyRunFor } from '#lib/services/studyService.js';
import { pets } from '#lib/stores/pets.js';
import type { Pet } from '#lib/types/index.js';

// The study hits the DB; only the calls StudyView makes on mount are stubbed,
// so `isCommunitySubject` and the constants stay real.
vi.mock('#lib/services/studyService.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#lib/services/studyService.js')>()),
  studyRunFor: vi.fn(),
  namesForSubjects: vi.fn(
    async () =>
      new Map([
        ['1', 'Mine stabled'],
        ['2', 'Mine unstabled'],
        ['shared:abc', 'Theirs'],
      ]),
  ),
  studyCorpusStatus: vi.fn(async () => ({ cached: 1, fetchedAt: null })),
  setUseForStudies: vi.fn(async () => {}),
  listExcludedSubjects: vi.fn(async () => []),
}));

vi.mock('#lib/components/study/StudyFindingsTable.svelte', async () => ({
  default: (await import('./fixtures/ChildStub.svelte')).default,
}));
vi.mock('#lib/components/study/StudyBaselines.svelte', async () => ({
  default: (await import('./fixtures/ChildStub.svelte')).default,
}));

import StudyView from '#lib/components/study/StudyView.svelte';

/** Rendered text with markup line breaks collapsed, so a wrapped sentence still matches. */
const textOf = (el: HTMLElement) => (el.textContent ?? '').replace(/\s+/g, ' ');

type Contradiction = { subjectId: string; count: number; stabled: boolean };

const studyOf = (attribute: string, contradictions: Contradiction[]) => ({
  attribute,
  slots: 1,
  findings: [],
  geneDoubts: [],
  contradictions,
  validation: { tested: 0, exact: 0, stabledTested: 0, stabledExact: 0, suspects: [] },
  contributors: 3,
  baselines: [],
});

const runWith = (contradictions: Contradiction[], more: Record<string, Contradiction[]> = {}): StudyRun =>
  ({
    corpus: { subjects: [{ id: '1' }, { id: '2' }], considered: 3, excluded: [] },
    studies: [
      studyOf('enthusiasm', contradictions),
      ...Object.entries(more).map(([attribute, list]) => studyOf(attribute, list)),
    ],
    totals: { slots: 1, found: 0, direct: 0, derived: 0, system: 0 },
    validation: { tested: 0, exact: 0, stabledTested: 0, stabledExact: 0 },
    suspects: [],
    sharedBase: null,
  }) as unknown as StudyRun;

async function openSuspects(
  contradictions: Contradiction[],
  more: Record<string, Contradiction[]> = {},
): Promise<HTMLElement> {
  vi.mocked(studyRunFor).mockResolvedValue(runWith(contradictions, more));
  render(StudyView);
  const tab = await screen.findByTestId('study-evidence-suspects');
  await fireEvent.click(tab);
  return waitFor(() => {
    const panel = document.querySelector<HTMLElement>('.panel.suspects');
    if (!panel) throw new Error('Suspect readings panel not rendered');
    return panel;
  });
}

describe('Suspect readings', () => {
  beforeEach(() => {
    pets.set([{ id: 1, name: 'Mine stabled', species: 'Horse', stabled: true, tags: [] } as unknown as Pet]);
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('tags each suspect by where it came from', async () => {
    const panel = await openSuspects([
      { subjectId: '1', count: 3, stabled: true },
      { subjectId: '2', count: 2, stabled: false },
      { subjectId: 'shared:abc', count: 1, stabled: false },
    ]);
    const tagOf = (id: string) =>
      panel.querySelector(`[data-testid="suspect-${id}"] .checkable, [data-testid="suspect-${id}"] .origin`)
        ?.textContent;
    expect(tagOf('1')).toBe('checkable');
    expect(tagOf('2')).toBe('unstabled');
    expect(tagOf('shared:abc')).toBe('community');
    expect(textOf(panel)).toContain('Stabled animals come first');
  });

  it('drops the stabled-first note when no suspect is stabled', async () => {
    // With only unstabled rows the note read as a claim about them.
    const panel = await openSuspects([
      { subjectId: '2', count: 2, stabled: false },
      { subjectId: 'shared:abc', count: 1, stabled: false },
    ]);
    expect(textOf(panel)).not.toContain('Stabled animals come first');
    expect(panel.querySelector('.checkable')).toBeNull();
  });

  it('names the attributes each suspect disagrees on, worst first', async () => {
    // The pooled count alone does not say which reading to re-check.
    const panel = await openSuspects([{ subjectId: 'shared:abc', count: 1, stabled: false }], {
      toughness: [{ subjectId: 'shared:abc', count: 4, stabled: false }],
    });
    const row = panel.querySelector<HTMLElement>('[data-testid="suspect-attributes-shared:abc"]');
    expect(row && textOf(row).trim()).toBe('toughness 4 · enthusiasm 1');
    expect(panel.querySelector('[data-testid="suspect-shared:abc"] .suspect-count')?.textContent).toBe('5');
  });

  it('can stop using a suspect without it being listed as mis-recorded', async () => {
    // A bad row caught by the solver's tally need not fail a held-out
    // prediction, so the Mis-recorded panel may never offer it.
    const panel = await openSuspects([{ subjectId: '2', count: 16, stabled: false }]);
    const button = panel.querySelector<HTMLButtonElement>('[data-testid="exclude-suspect-2"]');
    expect(button).not.toBeNull();
    await fireEvent.click(button as HTMLButtonElement);
    await waitFor(() => expect(setUseForStudies).toHaveBeenCalledWith(expect.any(String), '2', false));
    expect(studyRunFor).toHaveBeenCalledTimes(2);
  });

  it('shows a failed exclusion in the panel it was made from', async () => {
    vi.mocked(setUseForStudies).mockRejectedValueOnce(new Error('disk full'));
    const panel = await openSuspects([{ subjectId: '2', count: 16, stabled: false }]);
    await fireEvent.click(panel.querySelector('[data-testid="exclude-suspect-2"]') as HTMLButtonElement);
    const error = await screen.findByTestId('study-action-error');
    expect(textOf(error)).toContain('disk full');
  });
});
