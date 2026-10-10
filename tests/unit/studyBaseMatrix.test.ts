import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import StudyBaseMatrix from '$lib/components/study/StudyBaseMatrix.svelte';
import type { AttributeStudy, BaselineReading } from '$lib/utils/attributeStudy.js';

const reading = (over: Partial<BaselineReading> = {}): BaselineReading => ({
  breed: 'Kurbone',
  value: 10,
  unresolved: [],
  min: 10,
  max: 10,
  support: 243,
  dissent: 0,
  dissenters: [],
  witnesses: ['1'],
  ...over,
});

const studies = [
  {
    attribute: 'temperament',
    baselines: {
      readings: [reading({ value: -35, unresolved: ['05F2:recessive'], min: null, max: -36, dissent: 2 })],
      offsets: [{ breed: 'Paint', relativeTo: 'Kurbone', offset: 50, support: 3, dissent: 0, animals: 4 }],
    },
  },
  {
    attribute: 'intelligence',
    baselines: { readings: [reading(), reading({ breed: 'Paint', value: 25, min: 25, max: 25 })], offsets: [] },
  },
] as unknown as AttributeStudy[];

afterEach(cleanup);

describe('StudyBaseMatrix', () => {
  it('shows every breed against every attribute', () => {
    render(StudyBaseMatrix, { studies });
    expect(screen.getByTestId('base-matrix-Kurbone-temperament').textContent).toContain('≤ −36');
    expect(screen.getByTestId('base-matrix-Kurbone-intelligence').textContent?.trim()).toBe('10');
    expect(screen.getByTestId('base-matrix-Paint-temperament').textContent).toContain('Kurbone + 50');
    expect(screen.getByTestId('base-matrix-Paint-intelligence').textContent?.trim()).toBe('25');
  });

  it('marks exact, bounded and disputed cells apart', () => {
    render(StudyBaseMatrix, { studies });
    expect(screen.getByTestId('base-matrix-Kurbone-intelligence').classList.contains('exact')).toBe(true);
    const bound = screen.getByTestId('base-matrix-Kurbone-temperament');
    expect(bound.classList.contains('bound')).toBe(true);
    expect(bound.classList.contains('dissent')).toBe(true);
    expect(bound.getAttribute('title')).toContain('05F2 recessive');
  });

  it('gives the reference breed of a gap the inverse gap', () => {
    render(StudyBaseMatrix, { studies });
    expect(screen.getByTestId('base-matrix-Kurbone-temperament').textContent).toContain('Paint − 50');
  });

  it('shows a dash, explained in the lead, where nothing has settled', () => {
    render(StudyBaseMatrix, {
      studies: [
        { attribute: 'temperament', baselines: { readings: [reading()], offsets: [] } },
        { attribute: 'intelligence', baselines: { readings: [reading({ breed: 'Calico' })], offsets: [] } },
      ] as unknown as AttributeStudy[],
    });
    const cell = screen.getByTestId('base-matrix-Calico-temperament');
    expect(cell.textContent?.trim()).toBe('—');
    expect(cell.getAttribute('title')).toBe('Not settled yet');
    expect(screen.getByTestId('study-base-matrix').textContent).toContain('— is a breed with nothing settled');
  });

  it('opens an attribute from its column', async () => {
    const onselect = vi.fn();
    render(StudyBaseMatrix, { studies, onselect });
    await fireEvent.click(screen.getByTestId('base-matrix-col-intelligence'));
    expect(onselect).toHaveBeenCalledWith('intelligence');
  });

  it('says so when no base has settled', () => {
    render(StudyBaseMatrix, {
      studies: [{ attribute: 'temperament', baselines: { readings: [], offsets: [] } }] as unknown as AttributeStudy[],
    });
    expect(screen.getByTestId('study-base-matrix-empty')).toBeTruthy();
  });
});
