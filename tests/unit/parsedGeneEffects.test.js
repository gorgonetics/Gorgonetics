import { beforeEach, describe, expect, it } from 'vitest';
import { closeDatabase, getDb, initDatabase } from '$lib/services/database.js';
import * as geneService from '$lib/services/geneService.js';
import { runMigrations } from '$lib/services/migrationService.js';
import { parseEffect } from '$lib/utils/geneAnalysis.js';

describe('parseEffect', () => {
  it('parses standard attribute+sign strings', () => {
    expect(parseEffect('Toughness+')).toEqual({ attribute: 'toughness', sign: '+' });
    expect(parseEffect('Intelligence-')).toEqual({ attribute: 'intelligence', sign: '-' });
    expect(parseEffect('Ferocity+')).toEqual({ attribute: 'ferocity', sign: '+' });
    expect(parseEffect('Temperament-')).toEqual({ attribute: 'temperament', sign: '-' });
  });

  it('returns null for no-effect sentinels', () => {
    for (const sentinel of ['None', 'No dominant effect', 'No recessive effect', 'No gene data found', 'null']) {
      expect(parseEffect(sentinel)).toBeNull();
    }
  });

  it('returns null for empty, null, and undefined', () => {
    expect(parseEffect('')).toBeNull();
    expect(parseEffect(null)).toBeNull();
    expect(parseEffect(undefined)).toBeNull();
  });

  it('returns null for potential effects', () => {
    expect(parseEffect('Toughness?')).toBeNull();
    expect(parseEffect('Potential Intelligence+')).toBeNull();
  });

  it("returns null for appearance-style strings that don't match the shape", () => {
    expect(parseEffect('Body Color Hue')).toBeNull();
    expect(parseEffect('Tough+ness+')).toBeNull();
    expect(parseEffect('Toughness')).toBeNull();
  });
});

describe('upsertGene persists parsed columns', () => {
  beforeEach(async () => {
    await closeDatabase();
    await initDatabase();
    await runMigrations();
    geneService.clearGeneEffectsCache();
  });

  it('writes dominant_attribute/sign and recessive_attribute/sign', async () => {
    await geneService.upsertGene('beewasp', '01', '01A1', {
      effectDominant: 'Toughness+',
      effectRecessive: 'Intelligence-',
    });
    const db = getDb();
    const rows = await db.select(
      'SELECT dominant_attribute, dominant_sign, recessive_attribute, recessive_sign FROM genes WHERE gene = $g',
      { g: '01A1' },
    );
    expect(rows[0].dominant_attribute).toBe('toughness');
    expect(rows[0].dominant_sign).toBe('+');
    expect(rows[0].recessive_attribute).toBe('intelligence');
    expect(rows[0].recessive_sign).toBe('-');
  });

  it('writes NULL for no-effect / appearance strings', async () => {
    await geneService.upsertGene('beewasp', '01', '01B1', {
      effectDominant: 'None',
      effectRecessive: 'Body Color Hue',
    });
    const db = getDb();
    const rows = await db.select(
      'SELECT dominant_attribute, dominant_sign, recessive_attribute, recessive_sign FROM genes WHERE gene = $g',
      { g: '01B1' },
    );
    expect(rows[0].dominant_attribute).toBeNull();
    expect(rows[0].dominant_sign).toBeNull();
    expect(rows[0].recessive_attribute).toBeNull();
    expect(rows[0].recessive_sign).toBeNull();
  });
});

describe('updateGene refreshes parsed columns', () => {
  beforeEach(async () => {
    await closeDatabase();
    await initDatabase();
    await runMigrations();
    geneService.clearGeneEffectsCache();
  });

  it('rewrites dominant parsed columns when effectDominant changes', async () => {
    await geneService.upsertGene('beewasp', '01', '01A1', {
      effectDominant: 'Toughness+',
      effectRecessive: 'None',
    });
    await geneService.updateGene('beewasp', '01A1', {
      effectDominant: 'Ferocity-',
    });
    const db = getDb();
    const rows = await db.select('SELECT dominant_attribute, dominant_sign FROM genes WHERE gene = $g', { g: '01A1' });
    expect(rows[0].dominant_attribute).toBe('ferocity');
    expect(rows[0].dominant_sign).toBe('-');
  });

  it('clears parsed columns when effect moves to None', async () => {
    await geneService.upsertGene('beewasp', '01', '01A1', {
      effectDominant: 'Toughness+',
      effectRecessive: 'Intelligence-',
    });
    await geneService.updateGene('beewasp', '01A1', {
      effectRecessive: 'None',
    });
    const db = getDb();
    const rows = await db.select('SELECT recessive_attribute, recessive_sign FROM genes WHERE gene = $g', {
      g: '01A1',
    });
    expect(rows[0].recessive_attribute).toBeNull();
    expect(rows[0].recessive_sign).toBeNull();
  });
});

describe('backfillParsedGeneEffectsIfNeeded', () => {
  beforeEach(async () => {
    await closeDatabase();
    await initDatabase();
    await runMigrations();
    geneService.clearGeneEffectsCache();
  });

  async function insertLegacyGene(gene, effectDominant, effectRecessive) {
    // Simulate a pre-v10 row: written without parsed columns. Bypass
    // upsertGene because that now always populates them. All values use
    // named params — the in-memory test adapter maps columns positionally
    // to bind params and gets confused by mixed literals.
    const db = getDb();
    await db.execute(
      `INSERT OR REPLACE INTO genes
       (animal_type, chromosome, gene, effectDominant, effectRecessive, appearance, breed, notes, created_at, updated_at)
       VALUES ($at, $chr, $g, $ed, $er, $app, $breed, $notes, $created, $updated)`,
      {
        at: 'beewasp',
        chr: '01',
        g: gene,
        ed: effectDominant,
        er: effectRecessive,
        app: 'None',
        breed: '',
        notes: '',
        created: '2024-01-01',
        updated: '2024-01-01',
      },
    );
  }

  it('populates parsed columns for legacy rows', async () => {
    await insertLegacyGene('01A1', 'Toughness+', 'None');
    await insertLegacyGene('01A2', 'None', 'Intelligence-');
    await geneService.backfillParsedGeneEffectsIfNeeded();

    const db = getDb();
    const rows = await db.select(
      'SELECT gene, dominant_attribute, dominant_sign, recessive_attribute, recessive_sign FROM genes ORDER BY gene',
    );
    const byGene = Object.fromEntries(rows.map((r) => [r.gene, r]));
    expect(byGene['01A1'].dominant_attribute).toBe('toughness');
    expect(byGene['01A1'].dominant_sign).toBe('+');
    expect(byGene['01A2'].recessive_attribute).toBe('intelligence');
    expect(byGene['01A2'].recessive_sign).toBe('-');
  });

  it('is idempotent — flag guard skips repeat work', async () => {
    await insertLegacyGene('01A1', 'Toughness+', 'None');
    await geneService.backfillParsedGeneEffectsIfNeeded();

    // Corrupt the parsed columns to simulate a later edit that shouldn't
    // be undone by a second backfill call (the flag is set, so it skips).
    const db = getDb();
    await db.execute('UPDATE genes SET dominant_attribute = $x WHERE gene = $g', {
      x: 'corrupted',
      g: '01A1',
    });
    await geneService.backfillParsedGeneEffectsIfNeeded();

    const rows = await db.select('SELECT dominant_attribute FROM genes WHERE gene = $g', { g: '01A1' });
    expect(rows[0].dominant_attribute).toBe('corrupted');
  });

  it('handles an empty genes table gracefully', async () => {
    await geneService.backfillParsedGeneEffectsIfNeeded();
    const db = getDb();
    const rows = await db.select('SELECT COUNT(*) as cnt FROM genes');
    expect(rows[0].cnt).toBe(0);
  });
});
