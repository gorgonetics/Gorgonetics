import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeDatabase, getDb, initDatabase } from '$lib/services/database.js';
import { refreshGeneTemplatesIfChanged } from '$lib/services/demoService.js';
import * as geneService from '$lib/services/geneService.js';
import { runMigrations } from '$lib/services/migrationService.js';
import { getSetting, setSetting } from '$lib/services/settingsService.js';

// `loadBundledResource` resolves `resources/assets/...` to `/assets/...` and
// calls `fetch`. Stub fetch so it reads the real asset files off disk.
function stubFetchFromAssets() {
  vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
    const webPath = String(url);
    const diskPath = resolve('.' + webPath.replace(/^\/?/, '/').replace('/assets/', '/assets/'));
    const text = readFileSync(diskPath, 'utf-8');
    return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(text) });
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
    expect((await geneService.getGene('horse', '15A1')).effectDominant).toBe('TAMPERED');

    await refreshGeneTemplatesIfChanged();

    expect((await geneService.getGene('horse', '15A1')).effectDominant).toBe('TAMPERED');
    expect(await getSetting('genes.templateBundleHash')).toBe(hash1);
  });

  it('refreshes effects from the bundle when the hash differs, while preserving notes', async () => {
    await refreshGeneTemplatesIfChanged();
    const realHash = await getSetting('genes.templateBundleHash');

    // Pretend the user is running a previous version of the app.
    await setSetting('genes.templateBundleHash', 'stale');
    // User scribbled some notes and (in this fake old version) the gene also
    // had a different effect on disk.
    const db = getDb();
    await db.execute(
      `UPDATE genes SET effectDominant = $effect, notes = $notes
       WHERE animal_type = $animal_type AND gene = $gene`,
      { effect: 'StaleEffect+', notes: 'my hand-written note', animal_type: 'horse', gene: '15A1' },
    );

    await refreshGeneTemplatesIfChanged();

    const refreshed = await geneService.getGene('horse', '15A1');
    // Effect was overwritten from the bundled template.
    expect(refreshed.effectDominant).toBe('Intelligence-');
    // Note was kept.
    expect(refreshed.notes).toBe('my hand-written note');
    // Hash sentinel updated.
    expect(await getSetting('genes.templateBundleHash')).toBe(realHash);
  });

  it('inserts brand-new template genes during a refresh', async () => {
    await refreshGeneTemplatesIfChanged();

    // Simulate a previous-version DB that's missing a gene the new bundle ships.
    const db = getDb();
    await db.execute(`DELETE FROM genes WHERE animal_type = 'horse' AND gene = '48J4'`);
    expect(await geneService.getGene('horse', '48J4')).toBeNull();
    await setSetting('genes.templateBundleHash', 'stale');

    await refreshGeneTemplatesIfChanged();

    const inserted = await geneService.getGene('horse', '48J4');
    expect(inserted).not.toBeNull();
    expect(inserted.animal_type).toBe('horse');
  });
});
