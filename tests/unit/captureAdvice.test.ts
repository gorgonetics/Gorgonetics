import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { assessWildPet } from '#lib/services/captureService.js';
import { closeDatabase, initDatabase } from '#lib/services/database.js';
import * as geneService from '#lib/services/geneService.js';
import { runMigrations } from '#lib/services/migrationService.js';
import * as petService from '#lib/services/petService.js';
import { Gender, GeneType } from '#lib/types/index.js';
import { captureAdvice, type HuntTarget, huntTargets, targetsSupplied } from '#lib/utils/captureAdvice.js';
import type { ScoredGene } from '#lib/utils/geneticQuality.js';
import type { PetLoci } from '#lib/utils/petLoci.js';

const D = GeneType.DOMINANT;
const R = GeneType.RECESSIVE;
const X = GeneType.MIXED;

const gene = (over: Partial<ScoredGene>): ScoredGene => ({
  dominantAttribute: null,
  dominantSign: null,
  recessiveAttribute: null,
  recessiveSign: null,
  breed: '',
  ...over,
});
const GENES: Record<string, ScoredGene> = {
  // D adds Toughness: one parent with D is enough.
  '01A1': gene({ dominantAttribute: 'toughness', dominantSign: '+' }),
  // R adds Ruggedness: a pair needs R from both parents.
  '01A2': gene({ recessiveAttribute: 'ruggedness', recessiveSign: '+' }),
  // Locked to one breed.
  '01A3': gene({ dominantAttribute: 'virility', dominantSign: '+', breed: 'Kurbone' }),
};
const loci = (genes: Record<string, string>): PetLoci => new Map(Object.entries(genes)) as PetLoci;

describe('huntTargets', () => {
  const stable = {
    [Gender.MALE]: [loci({ '01A1': R, '01A2': R, '01A3': R })],
    [Gender.FEMALE]: [loci({ '01A1': R, '01A2': D, '01A3': R })],
  };

  it('lists a missing dominant benefit for either sex, a recessive one for the sex lacking it', () => {
    const targets = huntTargets(stable, GENES);
    expect(targets.map((t) => [t.geneId, t.allele, t.sexes])).toEqual([
      ['01A1', D, [Gender.MALE, Gender.FEMALE]],
      ['01A2', R, [Gender.FEMALE]],
      ['01A3', D, [Gender.MALE, Gender.FEMALE]],
    ]);
  });

  it('keeps only generic loci and the focus breed', () => {
    expect(huntTargets(stable, GENES, { focusBreed: 'Satincoat' }).map((t) => t.geneId)).toEqual(['01A1', '01A2']);
    expect(huntTargets(stable, GENES, { focusBreed: 'Kurbone' }).map((t) => t.geneId)).toContain('01A3');
  });

  it('lists nothing at a locus no stabled animal reads', () => {
    const unread = { [Gender.MALE]: [loci({ '01A1': '?' })], [Gender.FEMALE]: [] };
    expect(huntTargets(unread, GENES)).toEqual([]);
  });

  it('counts a mixed animal as a carrier of both alleles', () => {
    const mixed = { [Gender.MALE]: [loci({ '01A2': X })], [Gender.FEMALE]: [loci({ '01A2': X })] };
    expect(huntTargets(mixed, GENES)).toEqual([]);
  });
});

describe('targetsSupplied', () => {
  const targets = huntTargets(
    { [Gender.MALE]: [loci({ '01A1': R, '01A2': R })], [Gender.FEMALE]: [loci({ '01A1': R, '01A2': D })] },
    GENES,
  );
  const wild = loci({ '01A1': X, '01A2': R });

  it('counts a recessive target only for the sex that lacks it', () => {
    expect(targetsSupplied(wild, Gender.FEMALE, targets).map((t) => t.geneId)).toEqual(['01A1', '01A2']);
    expect(targetsSupplied(wild, Gender.MALE, targets).map((t) => t.geneId)).toEqual(['01A1']);
  });
});

describe('captureAdvice', () => {
  const target: HuntTarget = {
    geneId: '01A1',
    allele: D,
    kind: 'add',
    attribute: 'toughness',
    generic: true,
    sexes: [Gender.MALE, Gender.FEMALE],
  };
  const weakest = { id: 7, name: 'Roach', share: 2 };

  it('captures for a needed allele and lists it once, not also as never seen', () => {
    const advice = captureAdvice({
      supplied: [target],
      neverSeen: [
        { geneId: '01A1', allele: D },
        { geneId: '05B2', allele: R },
      ],
      quality: { share: 1, weakest },
    });
    expect(advice.capture).toBe(true);
    expect(advice.reasons.map((r) => r.kind)).toEqual(['needed', 'never-seen']);
    expect(advice.reasons[1]).toMatchObject({ alleles: [{ geneId: '05B2', allele: R }] });
  });

  it('captures an animal that beats the weakest stabled one', () => {
    const advice = captureAdvice({ supplied: [], neverSeen: [], quality: { share: 5, weakest } });
    expect(advice).toEqual({ capture: true, reasons: [{ kind: 'beats-weakest', share: 5, weakest }] });
  });

  it('lets go otherwise, and says how far below the weakest it is', () => {
    const advice = captureAdvice({ supplied: [], neverSeen: [], quality: { share: 2, weakest } });
    expect(advice).toEqual({ capture: false, reasons: [{ kind: 'below-weakest', share: 2, weakest }] });
  });

  it('lets go with no reason when the stable is too small to compare', () => {
    expect(captureAdvice({ supplied: [], neverSeen: [], quality: null })).toEqual({ capture: false, reasons: [] });
  });
});

describe('assessWildPet', () => {
  const SAMPLE = readFileSync(resolve('data/Genes_SampleHorse.txt'), 'utf-8');

  /** The sample with the named genes set, under a new Entity. */
  function genome(entity: string, genes: Record<string, string>): string {
    let text = SAMPLE.replace(/^Entity=.*$/m, `Entity=${entity}`);
    for (const [geneId, type] of Object.entries(genes)) {
      const chr = geneId.slice(0, 2);
      const block = geneId.charCodeAt(2) - 65;
      const pos = Number(geneId.slice(3)) - 1;
      text = text.replace(new RegExp(`^(${chr}=\\s*)(.*)$`, 'm'), (_, head: string, body: string) => {
        const blocks = body.split(' ');
        blocks[block] = blocks[block].slice(0, pos) + type + blocks[block].slice(pos + 1);
        return head + blocks.join(' ');
      });
    }
    return text;
  }

  beforeEach(async () => {
    await closeDatabase();
    await initDatabase();
    await runMigrations();
    await geneService.upsertGene('horse', '01', '01A1', { effectDominant: 'Toughness+', effectRecessive: 'None' });
    await geneService.upsertGene('horse', '01', '01A2', { effectDominant: 'None', effectRecessive: 'Ruggedness+' });
  });

  it('advises per sex against the stabled horses of the species', async () => {
    // No stabled horse carries 01A1 D; only the males carry 01A2 R.
    await petService.uploadPet(genome('Kb M 50 50 50 50 50 50 50', { '01A1': 'R', '01A2': 'R' }));
    await petService.uploadPet(genome('Kb M 51 50 50 50 50 50 50', { '01A1': 'R', '01A2': 'R' }));
    await petService.uploadPet(genome('Kb F 50 50 50 50 50 50 50', { '01A1': 'R', '01A2': 'D' }));
    const { pet_id } = await petService.uploadPet(genome('Wild Horse', { '01A1': 'D', '01A2': 'R' }));
    const { items } = await petService.getAllPets();
    const wild = items.find((p) => p.id === pet_id)!;

    const result = await assessWildPet({ wild, pets: items });
    expect(result.stableSize).toBe(3);
    expect(result.targets.map((t) => [t.geneId, t.allele, t.sexes])).toEqual([
      ['01A1', D, [Gender.MALE, Gender.FEMALE]],
      ['01A2', R, [Gender.FEMALE]],
    ]);
    const needed = (sex: Gender) => {
      const reason = result.advice[sex].reasons.find((r) => r.kind === 'needed');
      return reason?.kind === 'needed' ? reason.targets.map((t) => t.geneId) : [];
    };
    expect(result.advice[Gender.FEMALE].capture).toBe(true);
    expect(needed(Gender.FEMALE)).toEqual(['01A1', '01A2']);
    expect(needed(Gender.MALE)).toEqual(['01A1']);
  });

  it('lets go a wild horse that brings nothing the stable lacks', async () => {
    const same = { '01A1': 'D', '01A2': 'R' };
    await petService.uploadPet(genome('Kb M 50 50 50 50 50 50 50', same));
    await petService.uploadPet(genome('Kb M 51 50 50 50 50 50 50', same));
    await petService.uploadPet(genome('Kb F 50 50 50 50 50 50 50', same));
    const { pet_id } = await petService.uploadPet(genome('Wild Horse', { ...same, '02A1': 'R' }));
    const { items } = await petService.getAllPets();

    const result = await assessWildPet({ wild: items.find((p) => p.id === pet_id)!, pets: items });
    expect(result.targets).toEqual([]);
    expect(result.advice[Gender.MALE].capture).toBe(false);
    expect(result.advice[Gender.MALE].reasons.map((r) => r.kind)).toEqual(['below-weakest']);
  });
});
