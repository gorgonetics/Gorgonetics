import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import JSZip from 'jszip';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { importDatabase } from '$lib/services/backupService.js';
import { closeDatabase, getDb, initDatabase } from '$lib/services/database.js';
import { refreshGeneTemplatesIfChanged } from '$lib/services/demoService.js';
import * as fileService from '$lib/services/fileService.js';
import * as geneService from '$lib/services/geneService.js';
import { CURRENT_SCHEMA_VERSION, runMigrations } from '$lib/services/migrationService.js';
import { getSetting, setSetting } from '$lib/services/settingsService.js';

// `loadBundledResource` resolves `resources/assets/...` to `/assets/...` and
// calls `fetch`. Stub fetch so it reads the real asset files off disk.
function stubFetchFromAssets() {
  vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
    const webPath = String(url);
    const diskPath = resolve('.' + webPath.replace(/^\/?/, '/').replace('/assets/', '/assets/'));
    const text = readFileSync(diskPath, 'utf-8');
    return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(text) } as unknown as Response);
  });
}

describe('refreshGeneTemplatesIfChanged', () => {
  beforeEach(async () => {
    await closeDatabase();
    await initDatabase();
    await runMigrations();
    stubFetchFromAssets();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('seeds the catalog from bundled templates on first run', async () => {
    const before = await geneService.hasGenes();
    expect(before).toBe(false);

    await refreshGeneTemplatesIfChanged();

    expect(await geneService.hasGenes()).toBe(true);
    const horseChrs = await geneService.getChromosomes('horse');
    expect(horseChrs).toHaveLength(48);
    const beewaspChrs = await geneService.getChromosomes('beewasp');
    expect(beewaspChrs).toHaveLength(10);
  });

  it('stores a bundle hash so a second run with unchanged assets is a no-op', async () => {
    await refreshGeneTemplatesIfChanged();
    const hash1 = await getSetting('genes.templateBundleHash');
    expect(typeof hash1).toBe('string');
    expect(hash1).toMatch(/^[a-f0-9]{64}$/);

    // Tamper with one row; if a second refresh re-upserts, our tamper is lost.
    await geneService.updateGene('horse', '15A1', { effectDominant: 'TAMPERED' });
    expect((await geneService.getGene('horse', '15A1'))?.effectDominant).toBe('TAMPERED');

    await refreshGeneTemplatesIfChanged();

    expect((await geneService.getGene('horse', '15A1'))?.effectDominant).toBe('TAMPERED');
    expect(await getSetting('genes.templateBundleHash')).toBe(hash1);
  });

  it('refreshes untouched effects from the bundle when the hash differs, while preserving notes', async () => {
    await refreshGeneTemplatesIfChanged();
    const realHash = await getSetting('genes.templateBundleHash');

    // Pretend the user is running a previous version of the app, whose
    // template had a different effect for this gene, and wrote a note.
    await setSetting('genes.templateBundleHash', 'stale');
    const db = getDb();
    await db.execute(
      `UPDATE genes SET effectDominant = $effect, template_dominant = $effect, notes = $notes
       WHERE animal_type = $animal_type AND gene = $gene`,
      { effect: 'StaleEffect+', notes: 'my hand-written note', animal_type: 'horse', gene: '15A1' },
    );

    await refreshGeneTemplatesIfChanged();

    const refreshed = await geneService.getGene('horse', '15A1');
    // Effect equalled its template, so it takes the new template value.
    expect(refreshed?.effectDominant).toBe('Intelligence-');
    expect(refreshed?.notes).toBe('my hand-written note');
    expect(await getSetting('genes.templateBundleHash')).toBe(realHash);
  });

  async function rowOf(gene: string) {
    const [row] = await getDb().select<Record<string, string | null>[]>(
      `SELECT effectDominant, effectRecessive, template_dominant, template_recessive
       FROM genes WHERE animal_type = $animal_type AND gene = $gene`,
      { animal_type: 'horse', gene },
    );
    return row;
  }

  /** Set columns of one horse gene row. Values are bound: the in-memory adapter applies only bound values. */
  async function setRow(db: ReturnType<typeof getDb>, gene: string, values: Record<string, string | null>) {
    const set = Object.keys(values)
      .map((col) => `${col} = $${col}`)
      .join(', ');
    await db.execute(`UPDATE genes SET ${set} WHERE animal_type = $animal_type AND gene = $gene`, {
      ...values,
      animal_type: 'horse',
      gene,
    });
  }

  it('keeps an effect the user edited, and records the new template under it', async () => {
    await refreshGeneTemplatesIfChanged();
    // The user corrects the dominant effect in the gene editor.
    await geneService.updateGenesBulk('horse', 'chr15', [
      { gene: '15A1', effectDominant: 'Virility+', effectRecessive: 'None', appearance: 'Attributes', notes: '' },
    ]);
    await setSetting('genes.templateBundleHash', 'stale');

    await refreshGeneTemplatesIfChanged();

    expect(await rowOf('15A1')).toMatchObject({
      effectDominant: 'Virility+',
      template_dominant: 'Intelligence-',
    });
  });

  it('decides each effect on its own: keeps an edited recessive, refreshes an untouched dominant', async () => {
    await refreshGeneTemplatesIfChanged();
    const db = getDb();
    // Old template: dominant 'Old+', recessive 'None'. The user edited only the recessive.
    await setRow(db, '15A1', {
      effectDominant: 'Old+',
      template_dominant: 'Old+',
      effectRecessive: 'Toughness-',
      template_recessive: 'None',
    });
    await setSetting('genes.templateBundleHash', 'stale');

    await refreshGeneTemplatesIfChanged();

    expect(await rowOf('15A1')).toMatchObject({ effectDominant: 'Intelligence-', effectRecessive: 'Toughness-' });
  });

  it('treats a cleared effect stored as an empty string like None', async () => {
    await refreshGeneTemplatesIfChanged();
    const db = getDb();
    // The editor stores a cleared effect as ''. Template 'None', value '' is untouched.
    await setRow(db, '15A1', { effectRecessive: '', template_recessive: 'None' });
    await setSetting('genes.templateBundleHash', 'stale');

    await refreshGeneTemplatesIfChanged();

    expect((await rowOf('15A1')).effectRecessive).toBe('None');
  });

  it('restoring a pre-v21 backup refreshes stale effects and keeps the edits in it', async () => {
    await refreshGeneTemplatesIfChanged();
    // A v0.10.3-era backup: no template columns, 26B3 with the recessive
    // v0.10.3 shipped, and the user's own edit on 15A1.
    const rows = await getDb().select<Record<string, unknown>[]>('SELECT * FROM genes');
    const genes = rows.map(({ template_dominant: _d, template_recessive: _r, ...g }) => {
      if (g.animal_type === 'horse' && g.gene === '26B3') return { ...g, effectRecessive: 'Toughness+' };
      if (g.animal_type === 'horse' && g.gene === '15A1') return { ...g, effectDominant: 'Virility+' };
      return g;
    });
    const zip = new JSZip();
    zip.file(
      'metadata.json',
      JSON.stringify({
        format: 'gorgonetics-backup',
        format_version: 2,
        schema_version: CURRENT_SCHEMA_VERSION - 1,
        app_version: '0.10.3',
        exported_at: '2026-10-01T00:00:00Z',
        contents: { genes: true, pets: false, images: false },
        record_counts: { genes: genes.length, pets: 0, images: 0 },
      }),
    );
    zip.file('genes.json', JSON.stringify(genes));

    await importDatabase(await zip.generateAsync({ type: 'uint8array' }), {
      mode: 'replace',
      includeGenes: true,
      includePets: false,
      includeImages: false,
    });

    expect(await rowOf('26B3')).toMatchObject({ effectRecessive: 'Toughness-', template_recessive: 'Toughness-' });
    expect(await rowOf('15A1')).toMatchObject({ effectDominant: 'Virility+', template_dominant: 'Intelligence-' });
  });

  describe('rows from before schema v21 (no template recorded)', () => {
    async function upgradeFrom(gene: string, dominant: string, recessive: string) {
      await refreshGeneTemplatesIfChanged();
      await setRow(getDb(), gene, {
        effectDominant: dominant,
        effectRecessive: recessive,
        template_dominant: null,
        template_recessive: null,
      });
      await setSetting('genes.templateBundleHash', 'stale');
      await refreshGeneTemplatesIfChanged();
      return rowOf(gene);
    }

    it('takes the new template for a value an earlier release shipped', async () => {
      // v0.10.3 shipped 26B3 with recessive Toughness+; the template now has Toughness-.
      const row = await upgradeFrom('26B3', 'None', 'Toughness+');
      expect(row).toMatchObject({ effectRecessive: 'Toughness-', template_recessive: 'Toughness-' });
    });

    it('takes the new template for a value an older release shipped', async () => {
      // 15D1's dominant was Ruggedness+ in an older release (corrected since).
      const row = await upgradeFrom('15D1', 'Ruggedness+', 'None');
      expect(row).toMatchObject({
        effectDominant: 'None',
        effectRecessive: 'Ruggedness+',
        template_dominant: 'None',
        template_recessive: 'Ruggedness+',
      });
    });

    it('keeps a value no release shipped: the user edited it', async () => {
      const row = await upgradeFrom('26B3', 'None', 'Ferocity+');
      expect(row).toMatchObject({ effectRecessive: 'Ferocity+', template_recessive: 'Toughness-' });
    });
  });

  it('clears the positive_genes backfill flag so stale per-pet counts get recomputed', async () => {
    await refreshGeneTemplatesIfChanged();
    // Simulate the backfill having run successfully on first install.
    await setSetting('pets.positive_genes_backfilled', true);
    // Force the next refresh to do work.
    await setSetting('genes.templateBundleHash', 'stale');

    await refreshGeneTemplatesIfChanged();

    // Flag must be falsy so backfillPositiveGenesIfNeeded re-fires on the
    // same launch — otherwise pets.positive_genes stays at the value computed
    // under the old effects.
    const flag = await getSetting('pets.positive_genes_backfilled');
    expect(flag === false || flag === undefined).toBe(true);
  });

  it('does not persist a hash or touch flags when the bundle is empty', async () => {
    // Simulate a missing/empty asset directory.
    vi.spyOn(fileService, 'listBundledResources').mockResolvedValue([]);
    // Pre-set the backfill flag so we can detect it being clobbered.
    await setSetting('pets.positive_genes_backfilled', true);

    await refreshGeneTemplatesIfChanged();

    expect(await getSetting('genes.templateBundleHash')).toBeUndefined();
    expect(await getSetting('pets.positive_genes_backfilled')).toBe(true);
    expect(await geneService.hasGenes()).toBe(false);
  });

  it('aborts the refresh without bumping the hash when a template file is malformed', async () => {
    // First seed cleanly so we have a known hash.
    await refreshGeneTemplatesIfChanged();
    const goodHash = await getSetting('genes.templateBundleHash');
    expect(typeof goodHash).toBe('string');

    // Force the next refresh to do work.
    await setSetting('genes.templateBundleHash', 'stale');

    // Make a single asset file invalid JSON; everything else stays real.
    vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
      const webPath = String(url);
      if (webPath.endsWith('horse_genes_chr15.json')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: () => Promise.resolve('{ this is not json'),
        } as unknown as Response);
      }
      const diskPath = resolve('.' + webPath.replace(/^\/?/, '/'));
      return Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve(readFileSync(diskPath, 'utf-8')),
      } as unknown as Response);
    });

    // Tamper with a chr01 gene so we can detect whether ANY partial upsert
    // happened before parse hit the bad chr15 file. chr01 sorts before
    // chr15, so without the parse-upfront guard it would have been
    // overwritten by the time the parse failure aborted the loop.
    const db = getDb();
    await db.execute(`UPDATE genes SET effectDominant = $effect WHERE animal_type = $animal_type AND gene = $gene`, {
      effect: 'TamperBeforeRefresh',
      animal_type: 'horse',
      gene: '01A1',
    });

    await expect(refreshGeneTemplatesIfChanged()).resolves.toBeUndefined();

    // Hash sentinel must stay 'stale' so a later launch retries once the
    // bad asset is fixed; bumping it here would silently mask the issue.
    expect(await getSetting('genes.templateBundleHash')).toBe('stale');
    // And the chr01 tamper must survive — proving no partial DB writes
    // happened before the parse failure.
    expect((await geneService.getGene('horse', '01A1'))?.effectDominant).toBe('TamperBeforeRefresh');
  });

  it('inserts brand-new template genes during a refresh', async () => {
    await refreshGeneTemplatesIfChanged();

    // Simulate a previous-version DB that's missing a gene the new bundle
    // ships. Use named placeholders — the in-memory mock's `matchesWhere`
    // ignores conditions without a `?`, so an inline-literal DELETE here
    // would wipe the whole table and mask a regression.
    const db = getDb();
    await db.execute('DELETE FROM genes WHERE animal_type = $animal_type AND gene = $gene', {
      animal_type: 'horse',
      gene: '48J4',
    });
    expect(await geneService.getGene('horse', '48J4')).toBeNull();
    await setSetting('genes.templateBundleHash', 'stale');

    await refreshGeneTemplatesIfChanged();

    const inserted = await geneService.getGene('horse', '48J4');
    expect(inserted).not.toBeNull();
    expect(inserted?.animal_type).toBe('horse');
  });
});
