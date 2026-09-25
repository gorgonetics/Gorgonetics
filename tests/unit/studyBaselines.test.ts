import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import StudyBaselines from '$lib/components/study/StudyBaselines.svelte';
import type { BaselineReading } from '$lib/utils/attributeStudy.js';

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

afterEach(cleanup);

describe('StudyBaselines', () => {
  it('renders nothing when no breed has a reading', () => {
    render(StudyBaselines, { baselines: { readings: [], offsets: [] } });
    expect(screen.queryByTestId('study-baselines')).toBeNull();
  });

  it('shows an exact base as a plain number', () => {
    render(StudyBaselines, { baselines: { readings: [reading()], offsets: [] } });
    expect(screen.getByTestId('baseline-Kurbone').textContent).toContain('exact');
    expect(screen.getByTestId('baseline-Kurbone').textContent).toContain('10');
  });

  it('shows a negative bound with a minus sign and the lump it comes from', () => {
    render(StudyBaselines, {
      baselines: {
        readings: [reading({ value: -35, unresolved: ['05F2:recessive'], min: null, max: -36, support: 221 })],
        offsets: [],
      },
    });
    const row = screen.getByTestId('baseline-Kurbone').textContent ?? '';
    expect(row).toContain('≤ −36');
    expect(row).toContain('base + 05F2 recessive = −35');
  });

  it('shows an unbounded base as unknown', () => {
    render(StudyBaselines, {
      baselines: {
        readings: [reading({ value: 43, unresolved: ['01A4:dominant', '03C2:dominant'], min: null, max: null })],
        offsets: [],
      },
    });
    expect(screen.getByTestId('baseline-Kurbone').textContent).toContain('?');
  });

  it('states a gap between breeds', () => {
    render(StudyBaselines, {
      baselines: {
        readings: [reading()],
        offsets: [{ breed: 'Paint', relativeTo: 'Kurbone', offset: 50, support: 1, dissent: 0, animals: 286 }],
      },
    });
    expect(screen.getByTestId('baseline-offset-Paint').textContent).toMatch(/Paint = Kurbone\s+\+ 50/);
  });
});
