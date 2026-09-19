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

  it('says how much is still unknown', () => {
    render(StudyFindingsTable, { findings: [finding()], names, slots: 112 });
    expect(screen.getByText(/of 112 known/)).toBeTruthy();
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
    expect(screen.getByText(/Nothing is pinned for this attribute yet/)).toBeTruthy();
  });
});
