import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const horseDir = resolve('assets/horse');
const files = readdirSync(horseDir)
  .filter((f) => f.endsWith('.json'))
  .sort();

interface HorseGene {
  gene: string;
  effectDominant: string;
  effectRecessive: string;
  _file: string;
}

function loadHorseChromosome(file: string): HorseGene[] {
  return (JSON.parse(readFileSync(resolve(horseDir, file), 'utf-8')) as Omit<HorseGene, '_file'>[]).map((g) => ({
    ...g,
    _file: file,
  }));
}

const chr01Genes = loadHorseChromosome(files.find((f) => f.includes('chr01'))!);
const otherGenes = files.filter((f) => !f.includes('chr01')).flatMap(loadHorseChromosome);

describe('Horse gene effect slot invariant', () => {
  // Chromosome 1 is the only horse chromosome with dual-effect genes.
  // Each chr01 gene must carry a negative dominant AND a positive
  // recessive effect; the two effects may target the same or different
  // attributes.
  it('every chr01 gene has a negative dominant and a positive recessive effect', () => {
    const offenders = chr01Genes
      .filter(
        (g) =>
          g.effectDominant === 'None' ||
          !g.effectDominant.endsWith('-') ||
          g.effectRecessive === 'None' ||
          !g.effectRecessive.endsWith('+'),
      )
      .map((g) => `${g._file}:${g.gene} d=${g.effectDominant} r=${g.effectRecessive}`);
    expect(offenders, `chr01 dual-effect rule violated:\n${offenders.join('\n')}`).toEqual([]);
  });

  // Every other chromosome's genes only ever fire on one allele —
  // either dominant OR recessive carries an effect, never both.
  it('genes on chr02..chr48 carry an effect on at most one allele', () => {
    const offenders = otherGenes
      .filter((g) => g.effectDominant !== 'None' && g.effectRecessive !== 'None')
      .map((g) => `${g._file}:${g.gene} d=${g.effectDominant} r=${g.effectRecessive}`);
    expect(offenders, `non-chr01 single-effect rule violated:\n${offenders.join('\n')}`).toEqual([]);
  });
});
