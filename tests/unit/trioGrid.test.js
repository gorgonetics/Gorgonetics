import { describe, expect, it } from 'vitest';
import { createGeneCellBuilder } from '$lib/utils/geneGridCells.js';
import { buildTrioGrid } from '$lib/utils/trioGrid.js';

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

const entry = (over) => ({
  geneId: '01A1',
  block: 'A',
  position: 1,
  fatherType: 'x',
  motherType: 'x',
  dist: { D: 0.25, x: 0.5, R: 0.25, unknown: 0 },
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
        entry({ geneId: '02B1', block: 'B', position: 1, dist: { D: 1, x: 0, R: 0, unknown: 0 }, verdict: 'neutral' }),
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
    // father x → expresses the harmful dominant (Speed-) as mixed zygosity
    expect(a1.fatherCell.attributeCls).toBe('gene-cell gene-negative gene-mixed');
    expect(a1.motherCell.attributeCls).toBe('gene-cell gene-negative gene-mixed');

    const a2 = grid.rows[0].cells.A2;
    expect(a2.fatherCell).not.toBeNull();
    expect(a2.motherCell).toBeNull(); // motherType null → no cell
  });

  it('builds offspring segments, omitting zero-mass alleles and toning by expressed effect', () => {
    const segs = grid.rows[0].cells.A1.segments;
    expect(segs).toEqual([
      { allele: 'D', pct: 25, tone: 'negative' }, // D expresses the dominant Speed-
      { allele: 'x', pct: 50, tone: 'negative' }, // x also expresses dominant
      { allele: 'R', pct: 25, tone: 'positive' }, // R expresses the recessive Speed+
    ]);
  });

  it('represents an all-unknown offspring as a single unknown segment', () => {
    expect(grid.rows[0].cells.A2.segments).toEqual([{ allele: 'unknown', pct: 100, tone: 'unknown' }]);
  });

  it('carries the verdict metadata through to the cell', () => {
    const a1 = grid.rows[0].cells.A1;
    expect(a1.verdict).toBe('gain');
    expect(a1.source).toBe('both');
    expect(a1.pPositive).toBe(0.25);
    expect(a1.attribute).toBe('Speed');
  });

  it('normalises an unexpected effectType to a neutral tone (no undefined tone-* class)', () => {
    const stubBuilder = {
      makeCell: () => ({
        id: '01A1',
        type: 'D',
        attributeCls: '',
        appearanceCls: '',
        attribute: '',
        appearance: '',
        breed: '',
        effect: '',
      }),
      analyzeGene: () => ({ effectType: 'totally-made-up' }),
    };
    const stubResult = {
      chromosomes: [
        {
          chromosome: '01',
          totalGenes: 1,
          gains: 0,
          risks: 0,
          genes: [entry({ dist: { D: 1, x: 0, R: 0, unknown: 0 } })],
        },
      ],
      summary: {},
    };
    const g = buildTrioGrid(stubResult, stubBuilder);
    expect(g.rows[0].cells.A1.segments).toEqual([{ allele: 'D', pct: 100, tone: 'neutral' }]);
  });

  it('returns an empty layout for an empty result', () => {
    const empty = buildTrioGrid({ chromosomes: [], summary: {} }, cellBuilder);
    expect(empty.blocks).toEqual([]);
    expect(empty.rows).toEqual([]);
  });
});
