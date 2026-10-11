/**
 * Keeps the per-species effect lists in `firestore.rules` (`effectsFor`) in
 * step with the app. The rules cannot import configService, so the lists
 * are written out by hand; a new attribute in configService, or a bundled
 * gene effect missing from the rules, would make every report for it fail
 * with a permission error.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getEffectOptionsForSpecies } from '$lib/services/configService.js';

const RULES = readFileSync(resolve('firestore.rules'), 'utf-8');
const SPECIES = ['horse', 'beewasp'] as const;

function rulesEffects(species: string): string[] {
  const fn = RULES.match(/function effectsFor\(species\) \{([\s\S]*?)\}\[species\];/);
  if (!fn) throw new Error('effectsFor() not found in firestore.rules');
  const list = fn[1].match(new RegExp(`'${species}':\\s*\\[([^\\]]*)\\]`));
  if (!list) throw new Error(`no effect list for '${species}' in effectsFor()`);
  return [...list[1].matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
}

function bundledEffects(species: string): Set<string> {
  const dir = resolve('assets', species);
  const effects = new Set<string>();
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    const genes = JSON.parse(readFileSync(resolve(dir, file), 'utf-8')) as {
      effectDominant: string;
      effectRecessive: string;
    }[];
    for (const g of genes) {
      effects.add(g.effectDominant);
      effects.add(g.effectRecessive);
    }
  }
  return effects;
}

describe('firestore.rules effectsFor()', () => {
  it.each(SPECIES)('matches configService effect options for %s', (species) => {
    expect(rulesEffects(species)).toEqual([...getEffectOptionsForSpecies(species)].sort());
  });

  it.each(SPECIES)('admits every effect in the bundled %s templates', (species) => {
    const allowed = new Set(rulesEffects(species));
    const missing = [...bundledEffects(species)].filter((e) => !allowed.has(e));
    expect(missing).toEqual([]);
  });

  it('does not admit an attribute of the other species', () => {
    expect(rulesEffects('horse')).not.toContain('Ferocity+');
    expect(rulesEffects('beewasp')).not.toContain('Temperament+');
  });
});
