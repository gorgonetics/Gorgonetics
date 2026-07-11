import { describe, expect, it } from 'vitest';
import type { GeneTrioEntry, OffspringOutcomeBuckets, OffspringTrioResult } from '$lib/types/index.js';
import { createGeneCellBuilder } from '$lib/utils/geneGridCells.js';
import { buildTrioGrid, outcomeBoxBackground } from '$lib/utils/trioGrid.js';

const effectsDB = {
  // carrier gene: harmful dominant, beneficial recessive
  '01A1': { effectDominant: 'Speed-', effectRecessive: 'Speed+', breed: '', appearance: '', notes: '' },
  '01A2': { effectDominant: 'Toughness+', effectRecessive: 'None', breed: '', appearance: '', notes: '' },
};

const cellBuilder = createGeneCellBuilder({
  effectsDB,
  attributeNames: ['Speed', 'Toughness'],
  appearanceLookup: new Map(),
  speciesKey: 'beewasp',
});

const buckets = (over: Partial<OffspringOutcomeBuckets> = {}): OffspringOutcomeBuckets => ({
  newPositive: 0,
  clarifiedPositive: 0,
  keepPositive: 0,
  neutral: 0,
  keepNegative: 0,
  loss: 0,
  unknown: 0,
  ...over,
});

const entry = (over: Partial<GeneTrioEntry>): GeneTrioEntry => ({
  geneId: '01A1',
  block: 'A',
  position: 1,
  fatherType: 'x',
  motherType: 'x',
  dist: { D: 0.25, x: 0.5, R: 0.25, unknown: 0 },
  buckets: buckets({ keepPositive: 0.25, loss: 0.75 }),
  verdict: 'gain',
  source: 'both',
  lockedIn: false,
  attribute: 'Speed',
  pPositive: 0.25,
  pNegative: 0.75,
  fatherEffect: 'Speed-',
  motherEffect: 'Speed-',
  ...over,
});

const result = {
  chromosomes: [
    {
      chromosome: '01',
      totalGenes: 2,
      gains: 1,
      risks: 0,
      genes: [
        entry({}),
        entry({
          geneId: '01A2',
          position: 2,
          fatherType: 'D',
          motherType: null,
          dist: { D: 0, x: 0, R: 0, unknown: 1 },
          buckets: buckets({ unknown: 1 }),
          verdict: 'neutral',
          source: null,
          attribute: 'Toughness',
          pPositive: 0,
          pNegative: 0,
          motherEffect: undefined,
        }),
      ],
    },
    {
      chromosome: '02',
      totalGenes: 1,
      gains: 0,
      risks: 0,
      genes: [
        entry({
          geneId: '02B1',
          block: 'B',
          position: 1,
          dist: { D: 1, x: 0, R: 0, unknown: 0 },
          buckets: buckets({ keepPositive: 1 }),
          verdict: 'neutral',
        }),
      ],
    },
  ],
  summary: { totalGenes: 3, gains: 1, risks: 0, lockedIn: 0, unknownLoci: 1 },
};

describe('buildTrioGrid', () => {
  const grid = buildTrioGrid(result, cellBuilder);

  it('builds the block/position column layout as the union across chromosomes', () => {
    expect(grid.blocks).toEqual(['A', 'B']);
    expect(grid.positionsByBlock.A).toEqual([1, 2]);
    expect(grid.positionsByBlock.B).toEqual([1]);
  });

  it('keys each chromosome row by block+position', () => {
    expect(grid.rows.map((r) => r.chromosome)).toEqual(['01', '02']);
    expect(Object.keys(grid.rows[0].cells).sort()).toEqual(['A1', 'A2']);
    expect(grid.rows[1].cells.B1).toBeDefined();
  });

  it('builds parent cells with the shared gene-cell classes, null when a parent lacks the locus', () => {
    const a1 = grid.rows[0].cells.A1;
    expect(a1.fatherCell?.attributeCls).toBe('gene-cell gene-negative gene-mixed');
    expect(a1.motherCell?.attributeCls).toBe('gene-cell gene-negative gene-mixed');

    const a2 = grid.rows[0].cells.A2;
    expect(a2.fatherCell).not.toBeNull();
    expect(a2.motherCell).toBeNull(); // motherType null → no cell
  });

  it('carries a per-locus both-allele attribute set (potential responsibility, not just the expressed allele)', () => {
    expect(grid.rows[0].cells.A1.attrs).toBe('·Speed·');
    expect(grid.rows[0].cells.A2.attrs).toBe('·Toughness·');
  });

  it('carries the offspring outcome buckets through to the cell', () => {
    expect(grid.rows[0].cells.A1.buckets).toEqual(buckets({ keepPositive: 0.25, loss: 0.75 }));
    expect(grid.rows[0].cells.A2.buckets).toEqual(buckets({ unknown: 1 }));
  });

  it('carries the verdict metadata through to the cell', () => {
    const a1 = grid.rows[0].cells.A1;
    expect(a1.verdict).toBe('gain');
    expect(a1.source).toBe('both');
    expect(a1.attribute).toBe('Speed');
  });

  it('returns an empty layout for an empty result', () => {
    const empty = buildTrioGrid({ chromosomes: [], summary: {} } as unknown as OffspringTrioResult, cellBuilder);
    expect(empty.blocks).toEqual([]);
    expect(empty.rows).toEqual([]);
  });
});

describe('outcomeBoxBackground', () => {
  it('stacks the buckets top→bottom as a hard-stop vertical gradient', () => {
    const b = buckets({ newPositive: 0.5, keepPositive: 0.25, loss: 0.25 });
    expect(outcomeBoxBackground(b, 'attributes')).toBe(
      'linear-gradient(180deg, var(--trio-gain) 0.00% 50.00%, var(--trio-keep-pos) 50.00% 75.00%, var(--trio-loss) 75.00% 100.00%)',
    );
  });

  it('swaps which positive bucket is the vivid gain when the mode changes', () => {
    const b = buckets({ newPositive: 0.25, clarifiedPositive: 0.5, loss: 0.25 });
    // attributes: newPositive is the gain (0–25); clarified folds into keep (25–75)
    expect(outcomeBoxBackground(b, 'attributes')).toBe(
      'linear-gradient(180deg, var(--trio-gain) 0.00% 25.00%, var(--trio-keep-pos) 25.00% 75.00%, var(--trio-loss) 75.00% 100.00%)',
    );
    // clarification: clarified is the gain (0–50); newPositive folds into keep (50–75)
    expect(outcomeBoxBackground(b, 'clarification')).toBe(
      'linear-gradient(180deg, var(--trio-gain) 0.00% 50.00%, var(--trio-keep-pos) 50.00% 75.00%, var(--trio-loss) 75.00% 100.00%)',
    );
  });

  it('renders a fully-unknown locus as the diagonal hatch, regardless of mode', () => {
    const hatch =
      'repeating-linear-gradient(45deg, color-mix(in srgb, var(--gene-neutral) 60%, transparent) 0 2px, transparent 2px 4px)';
    expect(outcomeBoxBackground(buckets({ unknown: 1 }), 'attributes')).toBe(hatch);
    expect(outcomeBoxBackground(buckets({ unknown: 1 }), 'clarification')).toBe(hatch);
  });

  it('renders a settled all-neutral locus as a solid neutral fill', () => {
    expect(outcomeBoxBackground(buckets({ neutral: 1 }), 'attributes')).toBe(
      'linear-gradient(180deg, var(--trio-neutral) 0.00% 100.00%)',
    );
  });
});
