import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type BridgeResult,
  eligiblePartners,
  rankBridges,
  rankPartners,
  type TargetedPlan,
} from '$lib/services/targetedBreedingService.js';
import { breedingView } from '$lib/stores/breeding.svelte.js';
import type { Pet } from '$lib/types/index.js';

vi.mock('$lib/services/targetedBreedingService.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/services/targetedBreedingService.js')>()),
  rankPartners: vi.fn(),
  rankBridges: vi.fn(),
}));

vi.mock('$lib/services/studyService.js', () => {
  const empty = { points: new Map<string, number>(), coverage: new Map() };
  return {
    attributeMagnitudesFor: vi.fn(async () => empty),
    peekAttributeMagnitudes: vi.fn(() => empty),
  };
});

import ImproveHorse from '$lib/components/breeding/ImproveHorse.svelte';

const pet = (over: Partial<Pet>): Pet =>
  ({
    id: 0,
    name: 'Pet',
    species: 'Horse',
    breed: 'Kurbone',
    gender: 'Female',
    tags: [],
    stabled: true,
    temperament: 50,
    friendliness: 50,
    ...over,
  }) as unknown as Pet;

const ant = pet({ id: 1, name: 'Ant', gender: 'Male', temperament: 23 });
const mare = pet({ id: 2, name: 'Mare' });
const paint = pet({ id: 3, name: 'Painted', breed: 'Paint' });

const attrNames = ['Temperament', 'Friendliness'];

const plan: TargetedPlan = {
  partners: [
    {
      partner: mare,
      crossBreed: false,
      outlook: {
        pSuccess: 0.25,
        pTargets: 0.5,
        pSuccessBound: 0.5,
        expected: { Temperament: 3, Friendliness: -1 },
        pDrop: { Friendliness: 0.4 },
        unmeasured: { Temperament: { better: 0, worse: 0 }, Friendliness: { better: 0, worse: 0 } },
        levers: [{ gene: '08B3', attribute: 'Temperament', anchor: 'R', partner: 'D', expected: 6, pChange: 1 }],
      },
    },
    {
      partner: paint,
      crossBreed: true,
      outlook: {
        pSuccess: 0,
        pTargets: 0.1,
        pSuccessBound: 0.1,
        expected: { Temperament: -2, Friendliness: 0 },
        pDrop: { Friendliness: 0 },
        unmeasured: { Temperament: { better: 1, worse: 0.5 }, Friendliness: { better: 0, worse: 0 } },
        levers: [],
      },
    },
  ],
  needs: [
    { gene: '08B3', anchor: 'R', best: 'D', byPartner: { D: 6, x: 3, R: 0 }, matching: 1 },
    { gene: '14A2', anchor: 'R', best: 'R', byPartner: { D: -9, x: -4.5, R: 0 }, matching: 0 },
  ],
};

beforeEach(() => {
  breedingView.anchorId = null;
  breedingView.targets = [];
  breedingView.tolerance = 0;
  vi.mocked(rankPartners).mockResolvedValue(plan);
  vi.mocked(rankBridges).mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  vi.mocked(rankPartners).mockReset();
  vi.mocked(rankBridges).mockReset();
});

const mount = () => render(ImproveHorse, { pool: [ant, mare, paint], candidates: [ant, mare, paint], attrNames });

describe('ImproveHorse', () => {
  it('asks for an animal, then a target, before ranking anything', async () => {
    mount();
    expect(screen.getByText(/Choose the animal to improve/)).toBeTruthy();
    await fireEvent.change(screen.getByTestId('improve-anchor'), { target: { value: '1' } });
    expect(screen.getByText(/Choose at least one attribute/)).toBeTruthy();
    expect(rankPartners).not.toHaveBeenCalled();
  });

  it('ranks partners for the chosen animal and targets', async () => {
    breedingView.anchorId = 1;
    mount();
    await fireEvent.click(screen.getByTestId('improve-target-Temperament'));
    await waitFor(() => expect(screen.getByTestId('improve-partners')).toBeTruthy());
    expect(rankPartners).toHaveBeenLastCalledWith(
      expect.objectContaining({ anchor: ant, targets: ['Temperament'], tolerance: 0 }),
    );
    const row = screen.getByTestId('improve-partner-2').textContent ?? '';
    expect(row).toContain('25%');
    expect(row).toContain('+3');
    expect(row).toContain('Friendliness falls 40%');
    expect(row).toContain('08B3 +6');
    expect(screen.getByTestId('improve-anchor-values').textContent).toContain('Temperament 23');
  });

  it('re-ranks as the drop allowance is typed, without waiting for blur', async () => {
    breedingView.anchorId = 1;
    breedingView.targets = ['Temperament'];
    mount();
    await waitFor(() => expect(screen.getByTestId('improve-partners')).toBeTruthy());
    await fireEvent.input(screen.getByTestId('improve-tolerance'), { target: { value: '50' } });
    await waitFor(() => expect(rankPartners).toHaveBeenLastCalledWith(expect.objectContaining({ tolerance: 50 })));
  });

  it('leads with the best partner and its odds', async () => {
    breedingView.anchorId = 1;
    breedingView.targets = ['Temperament'];
    mount();
    await waitFor(() => expect(screen.getByTestId('improve-best')).toBeTruthy());
    expect(screen.getByTestId('improve-best').textContent).toMatch(
      /Best partner:\s*Mare\.\s*50% of foals beat\s*Ant on Temperament, and 25% also\s*lose no more than 0/,
    );
  });

  it('flags a partner of another breed and unmeasured changes', async () => {
    breedingView.anchorId = 1;
    breedingView.targets = ['Temperament'];
    mount();
    await waitFor(() => expect(screen.getByTestId('improve-partner-3')).toBeTruthy());
    const row = screen.getByTestId('improve-partner-3');
    expect(row.querySelector('.cross')?.textContent).toBe('Paint');
    expect(row.querySelector('.blind')?.textContent).toMatch(/unmeasured\s*↑1\.0\s*↓0\.5/);
  });

  it('lists what a partner would need, gains before keeps', async () => {
    breedingView.anchorId = 1;
    breedingView.targets = ['Temperament'];
    mount();
    await waitFor(() => expect(screen.getByTestId('improve-needs')).toBeTruthy());
    expect(screen.getByTestId('improve-need-08B3').textContent).toMatch(/gain\s*D\s*1 of 2/);
    expect(screen.getByTestId('improve-need-14A2').textContent).toMatch(/keep\s*R\s*0 of 2/);
  });

  it('still names the best partner when none is likely to succeed', async () => {
    vi.mocked(rankPartners).mockResolvedValue({ ...plan, partners: [plan.partners[1]] });
    breedingView.anchorId = 1;
    breedingView.targets = ['Temperament'];
    mount();
    await waitFor(() => expect(screen.getByTestId('improve-best').textContent).toContain('Best partner: Painted'));
    expect(screen.getByTestId('improve-summary').textContent).toContain('what a better partner would need');
  });
});

describe('ImproveHorse — two-step routes', () => {
  const route: BridgeResult = {
    sire: ant,
    dam: paint,
    crossBreed: true,
    outlook: {
      ...plan.partners[0].outlook,
      pSuccess: 0.04,
      levers: [{ ...plan.partners[0].outlook.levers[0], partner: null }],
    },
    keep: [
      { gene: '08B3', allowed: ['D', 'x'], p: 0.5 },
      { gene: '14A2', allowed: ['R'], p: 0.5 },
    ],
    pQualify: 0.25,
    foals: 29,
  };

  beforeEach(() => {
    breedingView.anchorId = 1;
    breedingView.targets = ['Temperament'];
  });

  it('spells each route out as steps, with the foal to keep and how many qualify', async () => {
    vi.mocked(rankBridges).mockResolvedValue([route]);
    mount();
    await waitFor(() => expect(screen.getByTestId('improve-route-1-3')).toBeTruthy());
    expect(rankBridges).toHaveBeenLastCalledWith(
      expect.objectContaining({ anchor: ant, targets: ['Temperament'], tolerance: 0, focus: undefined }),
    );
    const row = screen.getByTestId('improve-route-1-3');
    expect(row.textContent).toMatch(/1\. Breed\s*Ant × Painted/);
    expect(row.querySelector('[data-testid="improve-route-keep"]')?.textContent).toMatch(
      /2\. Keep a female foal that is 08B3 D or x, 14A2 R \(1 in 4 foals\)/,
    );
    expect(row.textContent).toContain('3. Breed it to Ant');
    expect(row.textContent).toContain('≈ 29');
    expect(row.textContent).toContain('08B3 +6');
    expect(row.querySelector('.cross')).toBeTruthy();
    // 29 foals is worse than the best direct partner's 4, so no headline.
    expect(screen.queryByTestId('improve-best-route')).toBeNull();
  });

  it('names the best route in the headline when it needs fewer foals than any direct partner', async () => {
    vi.mocked(rankBridges).mockResolvedValue([{ ...route, foals: 3 }]);
    mount();
    await waitFor(() => expect(screen.getByTestId('improve-best-route')).toBeTruthy());
    expect(screen.getByTestId('improve-best-route').textContent).toMatch(
      /Better in two steps: about 3 foals in all\. Breed\s*Ant × Painted, keep a female foal that is 08B3 D or x, 14A2 R, then breed it to Ant\./,
    );
  });

  it('shows routes for one gain gene on request, and back', async () => {
    mount();
    await waitFor(() => expect(screen.getByTestId('improve-focus-08B3')).toBeTruthy());
    expect(screen.queryByTestId('improve-focus-14A2')).toBeNull();
    await fireEvent.click(screen.getByTestId('improve-focus-08B3'));
    await waitFor(() => expect(rankBridges).toHaveBeenLastCalledWith(expect.objectContaining({ focus: '08B3' })));
    expect(screen.getByTestId('improve-routes').querySelector('h3')?.textContent).toContain('Ant — bringing in 08B3');
    await waitFor(() => expect(screen.getByTestId('improve-routes-empty').textContent).toContain('at 08B3'));
    await fireEvent.click(screen.getByTestId('improve-focus-clear'));
    await waitFor(() => expect(rankBridges).toHaveBeenLastCalledWith(expect.objectContaining({ focus: undefined })));
    // The same view is one click away at the top of the section.
    expect(screen.getByTestId('improve-focus-chip-08B3').textContent).toContain('Bring in 08B3 (+6)');
    expect(screen.queryByTestId('improve-focus-chip-14A2')).toBeNull();
    await fireEvent.click(screen.getByTestId('improve-focus-chip-08B3'));
    await waitFor(() => expect(rankBridges).toHaveBeenLastCalledWith(expect.objectContaining({ focus: '08B3' })));
    await fireEvent.click(screen.getByTestId('improve-focus-clear'));
    await waitFor(() => expect(rankBridges).toHaveBeenLastCalledWith(expect.objectContaining({ focus: undefined })));
  });

  it('keeps the direct ranking when the route search fails', async () => {
    vi.mocked(rankBridges).mockRejectedValue(new Error('boom'));
    mount();
    await waitFor(() => expect(screen.getByTestId('improve-partners')).toBeTruthy());
    await waitFor(() => expect(screen.getByTestId('improve-routes-empty')).toBeTruthy());
  });
});

describe('eligiblePartners', () => {
  it('keeps stabled animals of the same species and the other gender', () => {
    const pool = [
      ant,
      mare,
      pet({ id: 4, name: 'Stallion', gender: 'Male' }),
      pet({ id: 5, name: 'Unstabled', stabled: false }),
      pet({ id: 6, name: 'Bee', species: 'BeeWasp' }),
    ];
    expect(eligiblePartners(ant, pool).map((p) => p.name)).toEqual(['Mare']);
  });
});
