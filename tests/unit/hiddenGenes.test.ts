import { describe, expect, it } from 'vitest';
import { hiddenGeneCount, petsWithHiddenGenes } from '$lib/utils/hiddenGenes.js';

describe('hidden genes', () => {
  it('counts hidden loci, falling back to the flag when no count is stored', () => {
    expect(hiddenGeneCount({ unknown_genes: 12 })).toBe(12);
    expect(hiddenGeneCount({ unknown_genes: 0, has_unknown_genes: true })).toBe(0);
    expect(hiddenGeneCount({ has_unknown_genes: true })).toBe(1);
    expect(hiddenGeneCount({})).toBe(0);
  });

  it('keeps only the pets with something hidden, in order', () => {
    const pets = [
      { id: 1, unknown_genes: 0 },
      { id: 2, unknown_genes: 3 },
      { id: 3, has_unknown_genes: true },
    ];
    expect(petsWithHiddenGenes(pets).map((p) => p.id)).toEqual([2, 3]);
  });
});
