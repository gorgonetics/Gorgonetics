import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { closeDatabase, getDb, initDatabase } from '$lib/services/database.js';
import { allowForWant, expandAttributeCriterion, listExpandableAttributes } from '$lib/services/geneCriteriaService.js';
import { backfillParsedGeneEffectsIfNeeded, clearGeneEffectsCache } from '$lib/services/geneService.js';
import { runMigrations } from '$lib/services/migrationService.js';
import { GeneType } from '$lib/types/index.js';

interface AssetGene {
  gene: string;
  effectDominant: string;
  effectRecessive: string;
  breed?: string;
}

function loadHorseAssets(): AssetGene[] {
  const dir = resolve('assets/horse');
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .flatMap((f) => JSON.parse(readFileSync(resolve(dir, f), 'utf-8')) as AssetGene[]);
}

/**
 * Seed the real bundled horse genes and run the production parse backfill,
 * so the expansion is measured against the same data the app ships —
 * the §10 parity requirement, not a synthetic fixture.
 */
beforeAll(async () => {
  await closeDatabase();
  await initDatabase();
  await runMigrations();
  clearGeneEffectsCache();
  const db = getDb();
  const genes = loadHorseAssets();
  // The in-memory adapter binds one param per listed column — no SQL
  // literals or functions in VALUES.
  for (const g of genes) {
    await db.execute(
      `INSERT INTO genes (animal_type, chromosome, gene, effectDominant, effectRecessive, breed, created_at, updated_at)
       VALUES ($animal_type, $chromosome, $gene, $ed, $er, $breed, $created, $updated)`,
      {
        animal_type: 'horse',
        chromosome: g.gene.slice(0, 2),
        gene: g.gene,
        ed: g.effectDominant,
        er: g.effectRecessive,
        breed: g.breed ?? '',
        created: '2024-01-01',
        updated: '2024-01-01',
      },
    );
  }
  await backfillParsedGeneEffectsIfNeeded();
}, 60_000);

// The measured clean-positive counts from the design doc's §4 table.
// A regression that halves an expansion is invisible without these.
const MEASURED: Record<string, number> = {
  Intelligence: 112,
  Toughness: 86,
  Ruggedness: 88,
  Virility: 91,
  Enthusiasm: 87,
  Friendliness: 86,
  Temperament: 77,
};

describe('listExpandableAttributes — horse (§5a/§8)', () => {
  it('offers exactly the attributes with clean-positive loci, with pinned counts', async () => {
    const offered = await listExpandableAttributes('horse');
    const byName = Object.fromEntries(offered.map((a) => [a.attribute, a.lociCount]));
    expect(byName).toEqual(MEASURED);
  });

  it('does not offer Ferocity for horses — 0 loci is a real case, not hypothetical', async () => {
    const offered = await listExpandableAttributes('horse');
    expect(offered.some((a) => a.attribute === 'Ferocity')).toBe(false);
  });
});

describe('expandAttributeCriterion — parity and translation (§5a/§10)', () => {
  it('expansion size matches the offered count for every attribute', async () => {
    for (const [attribute, count] of Object.entries(MEASURED)) {
      const c = await expandAttributeCriterion('horse', attribute, 'carries');
      expect(c, attribute).not.toBeNull();
      expect(c?.loci.length, attribute).toBe(count);
    }
  });

  it('snapshots are sorted by gene id and independent between calls', async () => {
    const a = await expandAttributeCriterion('horse', 'Toughness', 'carries');
    const b = await expandAttributeCriterion('horse', 'Toughness', 'carries');
    expect(a).not.toBe(b);
    const ids = (a?.loci ?? []).map((l) => l.geneId);
    expect(ids).toEqual([...ids].sort((x, y) => x.localeCompare(y)));
  });

  it('translates the want per locus arm — carries always includes x', async () => {
    const c = await expandAttributeCriterion('horse', 'Toughness', 'carries');
    for (const locus of c?.loci ?? []) {
      expect(locus.allow).toContain(GeneType.MIXED);
      expect(locus.allow.length).toBe(2);
    }
  });

  it('expansions mix arms, so the three wants differ per expansion (§11)', async () => {
    const pure = await expandAttributeCriterion('horse', 'Toughness', 'pure');
    const dArm = (pure?.loci ?? []).filter((l) => l.allow.includes(GeneType.DOMINANT)).length;
    const rArm = (pure?.loci ?? []).filter((l) => l.allow.includes(GeneType.RECESSIVE)).length;
    // Measured 37 D-arm / 49 R-arm in the shipped data.
    expect(dArm).toBe(37);
    expect(rArm).toBe(49);
  });

  it('returns null for an attribute with no scoring loci', async () => {
    expect(await expandAttributeCriterion('horse', 'Ferocity', 'carries')).toBeNull();
  });
});

describe('allowForWant — per-arm state sets (§2/§5a)', () => {
  it('dominant arm: carries and expresses coincide, pure is strict', () => {
    expect([...allowForWant(GeneType.DOMINANT, 'carries')].sort()).toEqual(['D', 'x']);
    expect([...allowForWant(GeneType.DOMINANT, 'expresses')].sort()).toEqual(['D', 'x']);
    expect([...allowForWant(GeneType.DOMINANT, 'pure')]).toEqual(['D']);
  });

  it('recessive arm: expresses and pure coincide, carries includes x', () => {
    expect([...allowForWant(GeneType.RECESSIVE, 'carries')].sort()).toEqual(['R', 'x']);
    expect([...allowForWant(GeneType.RECESSIVE, 'expresses')]).toEqual(['R']);
    expect([...allowForWant(GeneType.RECESSIVE, 'pure')]).toEqual(['R']);
  });
});

describe('strict-parse exclusions (§5a)', () => {
  it('an unparseable effect string contributes no expansion locus', async () => {
    const db = getDb();
    await db.execute(
      `INSERT INTO genes (animal_type, chromosome, gene, effectDominant, effectRecessive, breed, created_at, updated_at)
       VALUES ($animal_type, $chromosome, $gene, $ed, $er, $breed, $created, $updated)`,
      {
        animal_type: 'horse',
        chromosome: '99',
        gene: '99Z1',
        ed: 'Toughness+?',
        er: 'None',
        breed: '',
        created: '2024-01-01',
        updated: '2024-01-01',
      },
    );
    clearGeneEffectsCache('horse');
    await backfillParsedGeneEffectsIfNeeded();
    const c = await expandAttributeCriterion('horse', 'Toughness', 'carries');
    expect(c?.loci.some((l) => l.geneId === '99Z1')).toBe(false);
    expect(c?.loci.length).toBe(MEASURED.Toughness);
  });

  it('a both-alleles-positive locus is skipped as ambiguous, not misassigned', async () => {
    const db = getDb();
    await db.execute(
      `INSERT INTO genes (animal_type, chromosome, gene, effectDominant, effectRecessive, breed,
                          dominant_attribute, dominant_sign, recessive_attribute, recessive_sign, created_at, updated_at)
       VALUES ($animal_type, $chromosome, $gene, $ed, $er, $breed, $da, $ds, $ra, $rs, $created, $updated)`,
      {
        animal_type: 'horse',
        chromosome: '99',
        gene: '99Z2',
        ed: 'Toughness+',
        er: 'Toughness+',
        breed: '',
        da: 'toughness',
        ds: '+',
        ra: 'toughness',
        rs: '+',
        created: '2024-01-01',
        updated: '2024-01-01',
      },
    );
    clearGeneEffectsCache('horse');
    const c = await expandAttributeCriterion('horse', 'Toughness', 'carries');
    expect(c?.loci.some((l) => l.geneId === '99Z2')).toBe(false);
    const offered = await listExpandableAttributes('horse');
    expect(offered.find((a) => a.attribute === 'Toughness')?.lociCount).toBe(MEASURED.Toughness);
  });
});
