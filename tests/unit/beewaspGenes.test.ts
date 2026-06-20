import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const beewaspDir = resolve('assets/beewasp');
const files = readdirSync(beewaspDir)
  .filter((f) => f.endsWith('.json'))
  .sort();

function loadAllBeewaspGenes() {
  const allGenes = [];
  for (const file of files) {
    const genes = JSON.parse(readFileSync(resolve(beewaspDir, file), 'utf-8'));
    for (const g of genes) allGenes.push({ ...g, _file: file });
  }
  return allGenes;
}

const allGenes = loadAllBeewaspGenes();

describe('Beewasp gene effect sign invariant', () => {
  // The bee/wasp genome is asymmetric by design: dominant alleles only
  // ever carry negative effects, recessive alleles only ever carry
  // positive effects. Anything else is a data-entry mistake.
  it('all dominant effects are "None" or negative', () => {
    const offenders = allGenes
      .filter((g) => g.effectDominant !== 'None' && !g.effectDominant.endsWith('-'))
      .map((g) => `${g._file}:${g.gene} → ${g.effectDominant}`);
    expect(offenders, `unexpected positive/non-None dominant effect:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('all recessive effects are "None" or positive', () => {
    const offenders = allGenes
      .filter((g) => g.effectRecessive !== 'None' && !g.effectRecessive.endsWith('+'))
      .map((g) => `${g._file}:${g.gene} → ${g.effectRecessive}`);
    expect(offenders, `unexpected negative/non-None recessive effect:\n${offenders.join('\n')}`).toEqual([]);
  });
});
