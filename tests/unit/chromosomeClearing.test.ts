import { describe, expect, it } from 'vitest';
import { GeneType } from '$lib/types/index.js';
import {
  allelesToGo,
  animalStatus,
  bridgeClearing,
  chromosomeTargets,
  closerThan,
  pairClearing,
  type SlotSigns,
} from '$lib/utils/chromosomeClearing.js';
import type { PetLoci } from '$lib/utils/petLoci.js';

const { DOMINANT: D, MIXED: x, RECESSIVE: R, UNKNOWN: U } = GeneType;
const loci = (entries: Record<string, GeneType>): PetLoci => new Map(Object.entries(entries));

const sign = (dominantSign: SlotSigns['dominantSign'], recessiveSign: SlotSigns['recessiveSign'], breed = '') => ({
  dominantSign,
  recessiveSign,
  breed,
});

describe('chromosomeTargets', () => {
  it('targets the homozygote expressing the better slot, generic loci of one chromosome only', () => {
    const targets = chromosomeTargets(
      {
        '01A2': sign('-', '+'),
        '01A1': sign('+', null),
        '01A3': sign(null, null),
        '01A4': sign('+', '+'),
        '01B1': sign('-', '+', 'Kurbone'),
        '02A1': sign('-', '+'),
      },
      '01',
    );
    expect([...targets]).toEqual([
      ['01A1', 'D'],
      ['01A2', 'R'],
    ]);
  });
});

const targets = new Map([
  ['01A1', 'R'],
  ['01A2', 'R'],
  ['01A3', 'R'],
] as Array<[string, 'R']>);

describe('animalStatus', () => {
  it('counts loci on target, carried, blocked and hidden', () => {
    expect(animalStatus(loci({ '01A1': R, '01A2': x, '01A3': D }), targets)).toEqual({
      onTarget: 1,
      carrier: 1,
      blocked: ['01A3'],
      hidden: 0,
    });
    expect(animalStatus(loci({ '01A1': U }), targets).hidden).toBe(3);
    expect(allelesToGo(animalStatus(loci({ '01A1': R, '01A2': x, '01A3': D }), targets))).toBe(3);
  });
});

describe('pairClearing', () => {
  it('multiplies per-locus odds of reaching the target', () => {
    const result = pairClearing(
      loci({ '01A1': R, '01A2': x, '01A3': x }),
      loci({ '01A1': R, '01A2': R, '01A3': x }),
      targets,
    );
    expect(result.pClear).toBe(1 * 0.5 * 0.25);
    expect(result.expected).toBe(1.75);
    expect(result.foals).toBe(8);
    expect(result.blocked).toEqual([]);
    // 01A2 R×x: 0 or 1 to go, each 1/2. 01A3 x×x: 0, 1, 2 with 1/4, 1/2, 1/4.
    expect(result.toGo).toEqual([0.125, 0.375, 0.375, 0.125, 0, 0, 0]);
    expect(closerThan(result.toGo, 2)).toBe(0.5);
    expect(closerThan(result.toGo, 0)).toBe(0);
  });

  it('names the loci a homozygous parent blocks', () => {
    const result = pairClearing(
      loci({ '01A1': D, '01A2': R, '01A3': R }),
      loci({ '01A1': R, '01A2': R, '01A3': R }),
      targets,
    );
    expect(result.pClear).toBe(0);
    expect(result.blocked).toEqual(['01A1']);
    expect(result.foals).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('bridgeClearing', () => {
  it('routes around a blocked locus through a kept middle foal', () => {
    // The sire blocks 01A1 directly; his foal by the dam is x there, and
    // that foal back to the dam is clear half the time at 01A1.
    const sire = loci({ '01A1': D, '01A2': R, '01A3': R });
    const dam = loci({ '01A1': R, '01A2': R, '01A3': R });
    expect(pairClearing(sire, dam, targets).pClear).toBe(0);
    const route = bridgeClearing(sire, dam, dam, targets);
    expect(route.keep).toEqual([]);
    expect(route.pQualify).toBe(1);
    expect(route.pClear).toBe(0.5);
    expect(route.foals).toBe(1 + 2);
    expect(route.blocked).toEqual([]);
  });

  it('keeps the middle foal for the genotype that clears most', () => {
    // x × x middle foals: keeping one that is R at 01A1 makes the next step
    // certain there, at the price of 1 in 4 foals qualifying.
    const sire = loci({ '01A1': x, '01A2': R, '01A3': R });
    const partner = loci({ '01A1': x, '01A2': R, '01A3': R });
    const route = bridgeClearing(sire, sire, partner, targets);
    // Any foal: 1/4·1/2 + 1/2·1/4 + 1/4·0 = 1/4 → 1 + 4 = 5 foals.
    // R only: 1/4 qualify, then 1/2 clear → 4 + 2 = 6. No D: 3/4 qualify,
    // then (1/4·1/2 + 1/2·1/4)/(3/4) = 1/3 clear → 4/3 + 3 ≈ 4.33. Best.
    expect(route.keep).toEqual([{ gene: '01A1', allowed: ['x', 'R'], p: 0.75 }]);
    expect(route.pClear).toBeCloseTo(1 / 3, 10);
    expect(route.foals).toBeCloseTo(4 / 3 + 3, 10);
  });

  it('reports loci the partner blocks', () => {
    const route = bridgeClearing(loci({ '01A1': R }), loci({ '01A1': R }), loci({ '01A1': D }), targets);
    expect(route.blocked).toEqual(['01A1']);
    expect(route.foals).toBe(Number.POSITIVE_INFINITY);
  });
});
