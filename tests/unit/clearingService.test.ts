import { describe, expect, it, vi } from 'vitest';
import { GeneType, type Pet } from '$lib/types/index.js';

const { DOMINANT: D, MIXED: x, RECESSIVE: R } = GeneType;

vi.mock('$lib/utils/petLoci.js', () => ({
  loadAllPetLoci: vi.fn(async () => {
    const l = (a: GeneType, b: GeneType) =>
      new Map([
        ['01A1', a],
        ['01A2', b],
      ]);
    return new Map([
      [1, l(R, x)], // stallion, 1 to go
      [2, l(D, R)], // stallion, 2 to go, blocks 01A1
      [3, l(R, R)], // mare, clear
      [4, l(x, x)], // mare, 2 to go
    ]);
  }),
}));

vi.mock('$lib/services/geneService.js', () => ({
  getParsedGenesCached: vi.fn(async () => ({
    '01A1': { dominantSign: '-', recessiveSign: '+', breed: '' },
    '01A2': { dominantSign: '-', recessiveSign: '+', breed: '' },
  })),
}));

import { planClearing } from '$lib/services/clearingService.js';

const pet = (id: number, gender: 'Male' | 'Female'): Pet =>
  ({ id, name: `P${id}`, species: 'Horse', breed: 'Kurbone', gender, stabled: true }) as unknown as Pet;

describe('planClearing', () => {
  it('measures each gender line and ranks crosses for the one behind', async () => {
    const plan = await planClearing({
      pets: [pet(1, 'Male'), pet(2, 'Male'), pet(3, 'Female'), pet(4, 'Female')],
      species: 'horse',
      chromosome: '01',
    });
    expect(plan.animals.map((a) => [a.pet.id, a.toGo])).toEqual([
      [3, 0],
      [1, 1],
      // Equal distance: the one blocking nothing first.
      [4, 2],
      [2, 2],
    ]);
    expect(plan.best).toEqual({ Male: 1, Female: 0 });
    expect(plan.behind).toBe('Male');
    // P1 × P3 gives a clear foal half the time, which beats the best male.
    expect(plan.pairs[0]).toMatchObject({ sire: { id: 1 }, dam: { id: 3 }, pClear: 0.5 });
    expect(plan.pairs[0].pCloser.Male).toBe(0.5);
    expect(plan.pairs[0].pCloser.Female).toBe(0);
    // P2 blocks 01A1 in any cross; a route through a kept foal gets past it.
    expect(plan.pairs.find((p) => p.sire.id === 2)?.blocked).toEqual(['01A1']);
    expect(plan.routes.length).toBeGreaterThan(0);
    expect(plan.routes[0].foals).toBeLessThanOrEqual(plan.routes.at(-1)?.foals ?? 0);
  });
});
