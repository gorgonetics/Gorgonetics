import { describe, expect, it } from 'vitest';
import {
  countBlocksInChromosome,
  generateBlockLetters,
  isValidGenomeFile,
  parseChromosomeGenes,
  parseGenome,
  parseGenomeFileGenes,
  parseGenomeFileHeader,
} from '$lib/services/genomeParser.js';

const SAMPLE_GENOME = `[Overview]
Format=v1.0
Character=TestBreeder
Entity=TestPet
Genome=BeeWasp

[Genes]
01=RDRD RDRR ?D?? x?xR
02=DDDD RRRR`;

describe('parseGenomeFileHeader', () => {
  it('extracts format version', () => {
    const header = parseGenomeFileHeader(SAMPLE_GENOME);
    expect(header.format_version).toBe('v1.0');
  });

  it('extracts breeder (Character)', () => {
    const header = parseGenomeFileHeader(SAMPLE_GENOME);
    expect(header.breeder).toBe('TestBreeder');
  });

  it('extracts name (Entity)', () => {
    const header = parseGenomeFileHeader(SAMPLE_GENOME);
    expect(header.name).toBe('TestPet');
  });

  it('extracts genome type', () => {
    const header = parseGenomeFileHeader(SAMPLE_GENOME);
    expect(header.genome_type).toBe('BeeWasp');
  });

  it('returns empty strings for missing fields', () => {
    const header = parseGenomeFileHeader('[Overview]\n[Genes]\n01=RDRD');
    expect(header.format_version).toBe('');
    expect(header.breeder).toBe('');
  });
});

describe('parseGenomeFileGenes', () => {
  it('extracts chromosome data', () => {
    const genes = parseGenomeFileGenes(SAMPLE_GENOME);
    expect(genes['01']).toBe('RDRD RDRR ?D?? x?xR');
    expect(genes['02']).toBe('DDDD RRRR');
  });

  it('returns empty object for content without [Genes] section', () => {
    const genes = parseGenomeFileGenes('[Overview]\nFormat=v1.0');
    expect(Object.keys(genes)).toHaveLength(0);
  });
});

describe('generateBlockLetters', () => {
  it('generates A-Z for up to 26 blocks', () => {
    const letters = generateBlockLetters(3);
    expect(letters).toEqual(['A', 'B', 'C']);
  });

  it('generates single letters for 26 blocks', () => {
    const letters = generateBlockLetters(26);
    expect(letters[0]).toBe('A');
    expect(letters[25]).toBe('Z');
    expect(letters).toHaveLength(26);
  });

  it('generates double letters beyond 26', () => {
    const letters = generateBlockLetters(28);
    expect(letters[26]).toBe('AA');
    expect(letters[27]).toBe('AB');
  });

  it('handles zero blocks', () => {
    expect(generateBlockLetters(0)).toEqual([]);
  });
});

describe('countBlocksInChromosome', () => {
  it('counts space-separated blocks', () => {
    expect(countBlocksInChromosome('RDRD RDRR ?D??')).toBe(3);
  });

  it('filters out short blocks', () => {
    expect(countBlocksInChromosome('RD R RDRR')).toBe(2); // 'R' is too short
  });
});

describe('parseChromosomeGenes', () => {
  it('parses genes with correct block/position', () => {
    const genes = parseChromosomeGenes('01', 'RDRD');
    expect(genes).toHaveLength(4);
    expect(genes[0]).toEqual({ chromosome: '01', block: 'A', position: 1, gene_type: 'R' });
    expect(genes[1]).toEqual({ chromosome: '01', block: 'A', position: 2, gene_type: 'D' });
  });

  it('handles multiple blocks', () => {
    const genes = parseChromosomeGenes('01', 'RD DR');
    expect(genes).toHaveLength(4);
    expect(genes[0].block).toBe('A');
    expect(genes[2].block).toBe('B');
  });

  it('handles unknown gene type ?', () => {
    const genes = parseChromosomeGenes('01', '?D');
    expect(genes[0].gene_type).toBe('?');
  });

  it('handles mixed gene type x', () => {
    const genes = parseChromosomeGenes('01', 'xR');
    expect(genes[0].gene_type).toBe('x');
  });
});

describe('parseGenome', () => {
  it('produces a complete genome object', () => {
    const genome = parseGenome(SAMPLE_GENOME);
    expect(genome.format_version).toBe('v1.0');
    expect(genome.breeder).toBe('TestBreeder');
    expect(genome.name).toBe('TestPet');
    expect(genome.genome_type).toBe('BeeWasp');
    expect(Object.keys(genome.genes)).toHaveLength(2);
  });

  it('pads chromosome numbers to 2 digits', () => {
    const genome = parseGenome(SAMPLE_GENOME);
    expect(genome.genes['01']).toBeDefined();
    expect(genome.genes['02']).toBeDefined();
  });

  it('parses all genes in each chromosome', () => {
    const genome = parseGenome(SAMPLE_GENOME);
    // chr01: "RDRD RDRR ?D?? x?xR" = 4+4+4+4 = 16 genes
    expect(genome.genes['01']).toHaveLength(16);
    // chr02: "DDDD RRRR" = 4+4 = 8 genes
    expect(genome.genes['02']).toHaveLength(8);
  });
});

describe('isValidGenomeFile', () => {
  it('returns true for valid content', () => {
    expect(isValidGenomeFile(SAMPLE_GENOME)).toBe(true);
  });

  it('returns false for content without [Overview]', () => {
    expect(isValidGenomeFile('[Genes]\n01=RD')).toBe(false);
  });

  it('returns false for content without [Genes]', () => {
    expect(isValidGenomeFile('[Overview]\nFormat=v1.0')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isValidGenomeFile('')).toBe(false);
  });
});
