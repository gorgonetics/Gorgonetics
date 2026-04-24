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
      'SELECT dominant_attribute, dominant_sign, recessive_attribute, recessive_sign FROM genes WHERE animal_type = $at AND gene = $g',
      { at: 'beewasp', g: '01A1' },
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
      'SELECT dominant_attribute, dominant_sign, recessive_attribute, recessive_sign FROM genes WHERE animal_type = $at AND gene = $g',
      { at: 'beewasp', g: '01B1' },
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
    const rows = await db.select(
      'SELECT dominant_attribute, dominant_sign FROM genes WHERE animal_type = $at AND gene = $g',
      { at: 'beewasp', g: '01A1' },
    );
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
    const rows = await db.select(
      'SELECT recessive_attribute, recessive_sign FROM genes WHERE animal_type = $at AND gene = $g',
      { at: 'beewasp', g: '01A1' },
    );
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

  it('steady-state run is a no-op over already-parsed rows', async () => {
    await insertLegacyGene('01A1', 'Toughness+', 'None');
    await geneService.backfillParsedGeneEffectsIfNeeded();
    const db = getDb();
    const [before] = await db.select('SELECT updated_at FROM genes WHERE animal_type = $at AND gene = $g', {
      at: 'beewasp',
      g: '01A1',
    });

    // Second run should see consistent parsed columns and skip without
    // issuing UPDATEs — the updated_at timestamp must not move.
    await geneService.backfillParsedGeneEffectsIfNeeded();
    const [after] = await db.select('SELECT updated_at FROM genes WHERE animal_type = $at AND gene = $g', {
      at: 'beewasp',
      g: '01A1',
    });
    expect(after.updated_at).toBe(before.updated_at);
  });

  it('self-heals when parsed columns are wiped (e.g. backup restore)', async () => {
    await insertLegacyGene('01A1', 'Toughness+', 'None');
    await geneService.backfillParsedGeneEffectsIfNeeded();

    // Simulate a backup-restore that rewrote genes back to pre-v10 state
    // (effect strings present, parsed columns NULL). Without a flag guard,
    // the next backfill call should detect this and heal the row.
    const db = getDb();
    await db.execute(
      `UPDATE genes
       SET dominant_attribute = NULL, dominant_sign = NULL,
           recessive_attribute = NULL, recessive_sign = NULL
       WHERE animal_type = $at AND gene = $g`,
      { at: 'beewasp', g: '01A1' },
    );
    await geneService.backfillParsedGeneEffectsIfNeeded();

    const rows = await db.select(
      'SELECT dominant_attribute, dominant_sign FROM genes WHERE animal_type = $at AND gene = $g',
      { at: 'beewasp', g: '01A1' },
    );
    expect(rows[0].dominant_attribute).toBe('toughness');
    expect(rows[0].dominant_sign).toBe('+');
  });

  it('skips rows whose effectDominant changed between read and write', async () => {
    // Can't easily race within a single-threaded test; instead verify the
    // WHERE guard by pre-inserting a row with consistent parsed state,
    // editing just the effect string, then confirming backfill won't
    // overwrite the parsed columns because they already match what a
    // fresh parse would produce (probe skips it entirely).
    await insertLegacyGene('01A1', 'Toughness+', 'None');
    await geneService.backfillParsedGeneEffectsIfNeeded();

    const db = getDb();
    await db.execute(
      `UPDATE genes SET effectDominant = $ed,
         dominant_attribute = $da, dominant_sign = $ds
       WHERE animal_type = $at AND gene = $g`,
      { ed: 'Intelligence-', da: 'intelligence', ds: '-', at: 'beewasp', g: '01A1' },
    );
    await geneService.backfillParsedGeneEffectsIfNeeded();

    const rows = await db.select(
      'SELECT dominant_attribute, dominant_sign FROM genes WHERE animal_type = $at AND gene = $g',
      { at: 'beewasp', g: '01A1' },
    );
    expect(rows[0].dominant_attribute).toBe('intelligence');
    expect(rows[0].dominant_sign).toBe('-');
  });

  it('handles an empty genes table gracefully', async () => {
    await geneService.backfillParsedGeneEffectsIfNeeded();
    const db = getDb();
    const rows = await db.select('SELECT COUNT(*) as cnt FROM genes');
    expect(rows[0].cnt).toBe(0);
  });
});
