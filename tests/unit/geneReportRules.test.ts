/**
 * Keeps the hand-written `/geneReports` invariants in `firestore.rules` in
 * step with the app: the species list, the gene-ID pattern and the
 * per-species effect lists (`effectsFor`). The rules cannot import app
 * code, so any drift — a new species, gene-ID format or attribute — would
 * make every report for it fail with a permission error.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getEffectOptionsForSpecies } from '$lib/services/configService.js';
import { EFFECT_ATTRIBUTES, TEMPLATE_SPECIES } from '$lib/types/index.js';

const RULES = readFileSync(resolve('firestore.rules'), 'utf-8');
const ASSETS = resolve('assets');
const ASSET_SPECIES = readdirSync(ASSETS)
  .filter((d) => statSync(resolve(ASSETS, d)).isDirectory())
  .sort();

function quoted(text: string): string[] {
  return [...text.matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

function rulesSpecies(): string[] {
  const m = RULES.match(/d\.species in \[([^\]]*)\]/);
  if (!m) throw new Error('species check not found in isValidGeneReport()');
  return quoted(m[1]).sort();
}

function rulesGenePattern(): RegExp {
  const m = RULES.match(/d\.gene\.matches\('([^']+)'\)/);
  if (!m) throw new Error('gene-ID check not found in isValidGeneReport()');
  return new RegExp(m[1]);
}

function rulesEffects(species: string): string[] {
  const fn = RULES.match(/function effectsFor\(species\) \{([\s\S]*?)\}\[species\];/);
  if (!fn) throw new Error('effectsFor() not found in firestore.rules');
  const list = fn[1].match(new RegExp(`'${species}':\\s*\\[([^\\]]*)\\]`));
  if (!list) throw new Error(`no effect list for '${species}' in effectsFor()`);
  return quoted(list[1]).sort();
}

function bundledGenes(species: string) {
  const dir = resolve(ASSETS, species);
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .flatMap(
      (file) =>
        JSON.parse(readFileSync(resolve(dir, file), 'utf-8')) as {
          gene: string;
          effectDominant: string;
          effectRecessive: string;
        }[],
    );
}

describe('firestore.rules /geneReports invariants', () => {
  it('lists exactly the species that have bundled templates', () => {
    expect(ASSET_SPECIES).toEqual([...TEMPLATE_SPECIES].sort());
    expect(rulesSpecies()).toEqual(ASSET_SPECIES);
  });

  it.each(ASSET_SPECIES)('matches configService effect options for %s', (species) => {
    expect(rulesEffects(species)).toEqual([...getEffectOptionsForSpecies(species)].sort());
  });

  it.each(ASSET_SPECIES)('admits every effect in the bundled %s templates', (species) => {
    const allowed = new Set(rulesEffects(species));
    const missing = new Set<string>();
    for (const g of bundledGenes(species)) {
      for (const e of [g.effectDominant, g.effectRecessive]) if (!allowed.has(e)) missing.add(e);
    }
    expect([...missing]).toEqual([]);
  });

  it.each(ASSET_SPECIES)('admits every gene ID in the bundled %s templates', (species) => {
    const pattern = rulesGenePattern();
    const rejected = bundledGenes(species)
      .map((g) => g.gene)
      .filter((id) => !pattern.test(id));
    expect(rejected).toEqual([]);
  });

  it('EFFECT_ATTRIBUTES (the GeneEffect type) covers exactly the attributes of every species', () => {
    const names = new Set(
      ASSET_SPECIES.flatMap((s) => getEffectOptionsForSpecies(s))
        .filter((e) => e !== 'None')
        .map((e) => e.slice(0, -1)),
    );
    expect([...EFFECT_ATTRIBUTES].sort()).toEqual([...names].sort());
  });
});
