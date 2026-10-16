import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type ClearingPlan, planClearing } from '$lib/services/clearingService.js';
import type { Pet } from '$lib/types/index.js';

vi.mock('$lib/services/clearingService.js', () => ({ planClearing: vi.fn() }));

import ClearChromosome from '$lib/components/breeding/ClearChromosome.svelte';

const pet = (over: Partial<Pet>): Pet =>
  ({
    id: 0,
    name: 'Pet',
    species: 'Horse',
    breed: 'Kurbone',
    gender: 'Female',
    stabled: true,
    ...over,
  }) as unknown as Pet;

const stallion = pet({ id: 1, name: 'Stallion', gender: 'Male' });
const mare = pet({ id: 2, name: 'Mare' });

const status = (toGo: number, blocked: string[] = []) => ({
  toGo,
  onTarget: 24 - toGo,
  carrier: toGo - 2 * blocked.length,
  blocked,
  hidden: 0,
});

const plan: ClearingPlan = {
  targets: [
    ['01A1', 'R'],
    ['01A2', 'R'],
  ],
  animals: [
    { pet: mare, ...status(6, ['01E1']) },
    { pet: stallion, ...status(10, ['01F1']) },
  ],
  best: { Male: 10, Female: 6 },
  behind: 'Male',
  pairs: [
    {
      sire: stallion,
      dam: mare,
      pCloser: { Male: 0.828, Female: 0.055 },
      pClear: 0,
      toGo: [],
      expected: 17.8,
      blocked: ['01E1', '01F1'],
      foals: Number.POSITIVE_INFINITY,
    },
  ],
  routes: [
    {
      sire: stallion,
      dam: mare,
      partner: mare,
      keep: [{ gene: '01F1', allowed: ['x'], p: 0.5 }],
      pQualify: 0.5,
      pClear: 0.25,
      foals: 6,
      blocked: [],
    },
  ],
};

beforeEach(() => {
  vi.mocked(planClearing).mockResolvedValue(plan);
});

afterEach(() => {
  cleanup();
  vi.mocked(planClearing).mockReset();
});

describe('ClearChromosome', () => {
  it('states the target and how far each gender line is', async () => {
    render(ClearChromosome, { candidates: [stallion, mare], species: 'horse' });
    await waitFor(() => expect(screen.getByTestId('clear-summary')).toBeTruthy());
    expect(planClearing).toHaveBeenCalledWith(expect.objectContaining({ species: 'horse', chromosome: '01' }));
    expect(screen.getByTestId('clear-summary').textContent).toMatch(
      /R at all 2\s*generic loci of chromosome 1.*Closest male:\s*10\s*alleles to go; closest female:\s*6/s,
    );
    expect(screen.getByTestId('clear-animal-2').textContent).toMatch(/Mare \(female\)\s*6\s*18\s*4\s*01E1/);
  });

  it('ranks crosses for the line that is behind', async () => {
    render(ClearChromosome, { candidates: [stallion, mare], species: 'horse' });
    await waitFor(() => expect(screen.getByTestId('clear-pairs')).toBeTruthy());
    expect(screen.getByTestId('clear-pairs').querySelector('h3')?.textContent).toContain('the male line');
    expect(screen.getByTestId('clear-pair-1-2').textContent).toMatch(/Stallion × Mare\s*83%\s*5\.5%\s*0%\s*01E1, 01F1/);
  });

  it('spells out a two-step route, with the foal to keep', async () => {
    render(ClearChromosome, { candidates: [stallion, mare], species: 'horse' });
    await waitFor(() => expect(screen.getByTestId('clear-route-1-2-2')).toBeTruthy());
    const row = screen.getByTestId('clear-route-1-2-2').textContent ?? '';
    expect(row).toMatch(/1\. Breed Stallion × Mare/);
    expect(row).toMatch(/2\. Keep a male foal that is 01F1 x \(1 in 2 foals\)/);
    expect(row).toMatch(/3\. Breed it to Mare/);
    expect(row).toContain('≈ 6');
    expect(row).toContain('25%');
  });

  it('says so when no route can clear every locus', async () => {
    vi.mocked(planClearing).mockResolvedValue({ ...plan, routes: [] });
    render(ClearChromosome, { candidates: [stallion, mare], species: 'horse' });
    await waitFor(() => expect(screen.getByTestId('clear-routes-empty')).toBeTruthy());
  });

  it('shows the closest eight animals, and all on request', async () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ pet: pet({ id: 10 + i, name: `A${i}` }), ...status(i) }));
    vi.mocked(planClearing).mockResolvedValue({ ...plan, animals: many });
    render(ClearChromosome, { candidates: [stallion, mare], species: 'horse' });
    await waitFor(() => expect(screen.getByTestId('clear-animals-toggle')).toBeTruthy());
    expect(screen.getByTestId('clear-animals').querySelectorAll('tbody tr')).toHaveLength(8);
    await fireEvent.click(screen.getByTestId('clear-animals-toggle'));
    expect(screen.getByTestId('clear-animals').querySelectorAll('tbody tr')).toHaveLength(10);
  });
});
