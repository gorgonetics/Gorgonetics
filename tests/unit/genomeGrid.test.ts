import { describe, expect, it } from 'vitest';
import { genomeTextToGrid } from '$lib/utils/genomeGrid.js';

// genomeTextToGrid must produce the same ParsedChromosome shape and ordering
// contract as petService.loadPetGridFromDb, but straight from raw genome
// text (the community-preview path, which never touches the local DB).

const SAMPLE = `[Overview]
Format=1
Character=Player
Entity=Buzz
Genome=BeeWasp

[Genes]
1=DR xD
2=RxD
`;

describe('genomeTextToGrid', () => {
  it('parses chromosomes, blocks, and positions into the grid shape', () => {
    const grid = genomeTextToGrid(SAMPLE);

    // Chromosomes are zero-padded and sorted numerically.
    expect(Object.keys(grid)).toEqual(['01', '02']);

    const chr1 = grid['01'];
    // "DR xD" → block A = [D,R], block B = [x,D]
    expect(chr1.blocks.map((b) => b.letter)).toEqual(['A', 'B']);
    expect(chr1.blocks[0].genes.map((g) => g.type)).toEqual(['D', 'R']);
    expect(chr1.blocks[1].genes.map((g) => g.type)).toEqual(['x', 'D']);

    // allGenes carries every gene with ascending globalPosition and canonical ids.
    expect(chr1.allGenes.map((g) => g.id)).toEqual(['01A1', '01A2', '01B1', '01B2']);
    expect(chr1.allGenes.map((g) => g.globalPosition)).toEqual([1, 2, 3, 4]);
  });

  it('handles a single-block chromosome', () => {
    const grid = genomeTextToGrid(SAMPLE);
    // "RxD" is one block of three genes.
    expect(grid['02'].blocks.map((b) => b.letter)).toEqual(['A']);
    expect(grid['02'].allGenes.map((g) => g.type)).toEqual(['R', 'x', 'D']);
    expect(grid['02'].allGenes.map((g) => g.id)).toEqual(['02A1', '02A2', '02A3']);
  });

  it('returns an empty grid for text with no genes section', () => {
    expect(genomeTextToGrid('[Overview]\nEntity=X\n')).toEqual({});
  });
});
