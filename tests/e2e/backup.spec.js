import { expect, test } from '@playwright/test';
import { waitForPets } from './helpers.js';

// ==========================================
// Database Backup (v2 Zip) Integration Tests
// ==========================================

/** Build a v2 zip backup from the current DB and return as base64. */
async function createBackupZip(page, { includeGenes = true, includePets = true } = {}) {
  return page.evaluate(
    async ({ includeGenes, includePets }) => {
      const { default: JSZip } = await import('/src/lib/services/jszip-reexport.ts');
      const { getDb } = await import('/src/lib/services/database.ts');
      const { CURRENT_SCHEMA_VERSION } = await import('/src/lib/services/migrationService.ts');
      const db = getDb();
      const zip = new JSZip();

      let geneCount = 0;
      let petCount = 0;

      if (includeGenes) {
        const genes = await db.select('SELECT * FROM genes ORDER BY animal_type, chromosome, gene');
        zip.file('genes.json', JSON.stringify(genes));
        geneCount = genes.length;
      }

      if (includePets) {
        const pets = await db.select('SELECT * FROM pets ORDER BY name');
        const petsExport = pets.map((p) => {
          const c = { ...p };
          delete c.id;
          return c;
        });
        zip.file('pets.json', JSON.stringify(petsExport));
        petCount = petsExport.length;
      }

      zip.file(
        'metadata.json',
        JSON.stringify({
          format: 'gorgonetics-backup',
          format_version: 2,
          schema_version: CURRENT_SCHEMA_VERSION,
          app_version: '0.1.1',
          exported_at: new Date().toISOString(),
          contents: { genes: includeGenes, pets: includePets, images: false },
          record_counts: { genes: geneCount, pets: petCount, images: 0 },
        }),
      );

      return zip.generateAsync({ type: 'base64' });
    },
    { includeGenes, includePets },
  );
}

/** Import a v2 zip from base64 with the given options. */
async function importBackupZip(page, zipBase64, options) {
  return page.evaluate(
    async ({ zipBase64, options }) => {
      const { importDatabase } = await import('/src/lib/services/backupService.ts');
      const binary = Uint8Array.from(atob(zipBase64), (c) => c.charCodeAt(0));
      return importDatabase(binary, options);
    },
    { zipBase64, options },
  );
}

/** Delete the first pet in the database. */
async function deleteFirstPet(page) {
  return page.evaluate(async () => {
    const { getDb } = await import('/src/lib/services/database.ts');
    const db = getDb();
    const pets = await db.select('SELECT * FROM pets LIMIT 1');
    await db.execute('DELETE FROM pets WHERE id = $id', { id: pets[0].id });
    return pets[0].name;
  });
}

/** Get the current pet count and sorted names. */
async function getPetState(page) {
  return page.evaluate(async () => {
    const { getDb } = await import('/src/lib/services/database.ts');
    const db = getDb();
    const pets = await db.select('SELECT * FROM pets ORDER BY name');
    const genes = await db.select('SELECT * FROM genes');
    return {
      petCount: pets.length,
      geneCount: genes.length,
      petNames: pets.map((p) => p.name).sort(),
    };
  });
}

test.describe('Database Backup – v2 Zip', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForPets(page);
  });

  test('database has correct schema version', async ({ page }) => {
    const version = await page.evaluate(async () => {
      const { getSchemaVersion } = await import('/src/lib/services/migrationService.ts');
      return getSchemaVersion();
    });
    expect(version).toBe(3);
  });

  test('export and import (replace) round-trips correctly', async ({ page }) => {
    const zipBase64 = await createBackupZip(page);
    const before = await getPetState(page);
    expect(before.petCount).toBe(2);

    await deleteFirstPet(page);
    expect((await getPetState(page)).petCount).toBe(1);

    const result = await importBackupZip(page, zipBase64, {
      mode: 'replace',
      includeGenes: true,
      includePets: true,
      includeImages: false,
    });
    expect(result.pets).toBe(2);
    expect(result.petsSkipped).toBe(0);

    const after = await getPetState(page);
    expect(after.petCount).toBe(2);
    expect(after.petNames).toEqual(before.petNames);
  });

  test('export and import (merge) restores deleted pet', async ({ page }) => {
    const zipBase64 = await createBackupZip(page);
    await deleteFirstPet(page);

    const result = await importBackupZip(page, zipBase64, {
      mode: 'merge',
      includeGenes: true,
      includePets: true,
      includeImages: false,
    });
    expect(result.pets).toBe(1);
    expect(result.petsSkipped).toBe(1);
    expect((await getPetState(page)).petCount).toBe(2);
  });

  test('merge on full database skips all existing pets', async ({ page }) => {
    const zipBase64 = await createBackupZip(page);
    const result = await importBackupZip(page, zipBase64, {
      mode: 'merge',
      includeGenes: true,
      includePets: true,
      includeImages: false,
    });
    expect(result.pets).toBe(0);
    expect(result.petsSkipped).toBe(2);
  });

  test('selective import (genes only) preserves pets', async ({ page }) => {
    const zipBase64 = await createBackupZip(page, { includeGenes: true, includePets: false });

    const result = await importBackupZip(page, zipBase64, {
      mode: 'replace',
      includeGenes: true,
      includePets: false,
      includeImages: false,
    });
    expect(result.genes).toBeGreaterThan(0);
    expect(result.pets).toBe(0);
    expect((await getPetState(page)).petCount).toBe(2);
  });

  test('import rejects invalid zip files', async ({ page }) => {
    const opts = { mode: 'replace', includeGenes: true, includePets: true, includeImages: false };

    const err = await page.evaluate(async (opts) => {
      const { importDatabase } = await import('/src/lib/services/backupService.ts');
      try {
        await importDatabase(new TextEncoder().encode('not a zip file'), opts);
        return null;
      } catch (e) {
        return e.message;
      }
    }, opts);
    expect(err).toBeTruthy();
  });

  test('DataMenu shows export/import buttons', async ({ page }) => {
    const menuBtn = page.getByTitle('Data management');
    await expect(menuBtn).toBeVisible();

    await menuBtn.click();
    await expect(page.getByText('Export Backup')).toBeVisible();
    await expect(page.getByText('Import Backup')).toBeVisible();

    await page.locator('.top-bar-left').click();
    await expect(page.getByText('Export Backup')).not.toBeVisible();
  });

  test('Export dialog shows checkboxes', async ({ page }) => {
    await page.getByTitle('Data management').click();
    await page.getByText('Export Backup').click();

    await expect(page.getByText('Gene definitions')).toBeVisible();
    await expect(page.getByText('Pet data')).toBeVisible();
    await expect(page.getByText('Pet images')).toBeVisible();

    await page.getByText('Cancel').click();
    await expect(page.getByText('Gene definitions')).not.toBeVisible();
  });
});
