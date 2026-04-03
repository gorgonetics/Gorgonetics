import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HORSE_BREEDS } from '$lib/types/index.js';

const horseDir = resolve('assets/horse');
const files = readdirSync(horseDir)
  .filter((f) => f.endsWith('.json'))
  .sort();

function loadAllHorseGenes() {
  const allGenes = [];
  for (const file of files) {
    const genes = JSON.parse(readFileSync(resolve(horseDir, file), 'utf-8'));
    allGenes.push(...genes);
  }
  return allGenes;
}

const allGenes = loadAllHorseGenes();
const breedNames = Object.keys(HORSE_BREEDS);

describe('Horse breed data consistency', () => {
  it('all 10 breeds are present in the data', () => {
    const breedsFound = new Set(allGenes.map((g) => g.breed).filter(Boolean));
    for (const abbrev of breedNames) {
      expect(breedsFound.has(abbrev), `breed ${abbrev} not found in data`).toBe(true);
    }
  });

  it('each chromosome is either all-generic or all-same-breed (no mixing)', () => {
    for (const file of files) {
      const genes = JSON.parse(readFileSync(resolve(horseDir, file), 'utf-8'));
      const breeds = [...new Set(genes.map((g) => g.breed))];
      // Should be either [''] (all generic) or ['Xx'] (all one breed)
      expect(breeds.length, `${file}: has mixed breeds ${JSON.stringify(breeds)}`).toBe(1);
    }
  });

  it('all breeds have the same number of breed-specific genes', () => {
    const counts = {};
    for (const abbrev of breedNames) {
      counts[abbrev] = allGenes.filter((g) => g.breed === abbrev).length;
    }
    const expected = counts[breedNames[0]];
    for (const [breed, count] of Object.entries(counts)) {
      expect(count, `breed ${breed} has ${count} genes, expected ${expected}`).toBe(expected);
    }
  });

  it('all breeds have the same number of breed-specific chromosomes', () => {
    const counts = {};
    for (const abbrev of breedNames) {
      const chroms = new Set(allGenes.filter((g) => g.breed === abbrev).map((g) => g.gene.slice(0, 2)));
      counts[abbrev] = chroms.size;
    }
    const expected = counts[breedNames[0]];
    for (const [breed, count] of Object.entries(counts)) {
      expect(count, `breed ${breed} has ${count} chromosomes, expected ${expected}`).toBe(expected);
    }
  });

  it('no breed abbreviation appears in the appearance field', () => {
    for (const gene of allGenes) {
      expect(gene.appearance, `gene ${gene.gene} still has breed in appearance`).not.toMatch(/\([A-Z][a-z]\)/);
    }
  });

  it('breed field is always a known abbreviation or empty', () => {
    for (const gene of allGenes) {
      if (gene.breed) {
        expect(breedNames, `unknown breed ${gene.breed} on gene ${gene.gene}`).toContain(gene.breed);
      }
    }
  });
});
