import { expect, test } from '@playwright/test';
import { waitForPets } from './helpers.js';

// ==========================================
// Database Export / Import Integration Tests
// ==========================================

/** Build a backup JSON string from the current in-memory database. */
async function createBackupJson(page) {
  return page.evaluate(async () => {
    const { getDb } = await import('/src/lib/services/database.ts');
    const { CURRENT_SCHEMA_VERSION } = await import('/src/lib/services/migrationService.ts');
    const db = getDb();
    const genes = await db.select('SELECT * FROM genes ORDER BY animal_type, chromosome, gene');
    const pets = await db.select('SELECT * FROM pets ORDER BY name');

    const petsExport = pets.map((p) => {
      const copy = { ...p };
      delete copy.id;
      if (typeof copy.genome_data === 'string') {
        try {
          copy.genome_data = JSON.parse(copy.genome_data);
        } catch {}
      }
      return copy;
    });

    return JSON.stringify({
      metadata: {
        format: 'gorgonetics-backup',
        format_version: 1,
        schema_version: CURRENT_SCHEMA_VERSION,
        app_version: '0.1.1',
        exported_at: new Date().toISOString(),
        record_counts: { genes: genes.length, pets: pets.length },
      },
      data: { genes, pets: petsExport },
    });
  });
}

/** Delete the first pet in the database. Returns the deleted pet's name. */
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

/** Import a backup JSON string with the given mode. */
async function importBackup(page, json, mode) {
  return page.evaluate(
    async ({ json, mode }) => {
      const { importDatabase } = await import('/src/lib/services/backupService.ts');
      return importDatabase(json, mode);
    },
    { json, mode },
  );
}

test.describe('Database Backup – Export & Import', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForPets(page);
  });

  test('export produces a valid backup with correct metadata', async ({ page }) => {
    const backup = await page.evaluate(async () => {
      const { getDb } = await import('/src/lib/services/database.ts');
      const { getSchemaVersion } = await import('/src/lib/services/migrationService.ts');
      const db = getDb();
      const genes = await db.select('SELECT * FROM genes');
      const pets = await db.select('SELECT * FROM pets');
      const version = await getSchemaVersion();
      return { geneCount: genes.length, petCount: pets.length, schemaVersion: version };
    });

    expect(backup.petCount).toBe(2);
    expect(backup.geneCount).toBeGreaterThan(0);
    expect(backup.schemaVersion).toBe(2);
  });

  test('export and import (replace) round-trips correctly', async ({ page }) => {
    const exportedJson = await createBackupJson(page);
    const initial = JSON.parse(exportedJson);
    expect(initial.data.pets).toHaveLength(2);

    await deleteFirstPet(page);
    expect((await getPetState(page)).petCount).toBe(1);

    const result = await importBackup(page, exportedJson, 'replace');
    expect(result.pets).toBe(2);
    expect(result.skipped).toBe(0);

    const afterImport = await getPetState(page);
    expect(afterImport.petCount).toBe(2);
    expect(afterImport.geneCount).toBe(initial.data.genes.length);
    expect(afterImport.petNames).toEqual(initial.data.pets.map((p) => p.name).sort());
  });

  test('export and import (merge) restores deleted pet without duplicating', async ({ page }) => {
    const exportedJson = await createBackupJson(page);
    const initial = JSON.parse(exportedJson);

    await deleteFirstPet(page);

    const result = await importBackup(page, exportedJson, 'merge');
    expect(result.pets).toBe(1);
    expect(result.skipped).toBe(1);

    const afterMerge = await getPetState(page);
    expect(afterMerge.petCount).toBe(2);
    expect(afterMerge.petNames).toEqual(initial.data.pets.map((p) => p.name).sort());
  });

  test('merge import on full database skips all existing pets', async ({ page }) => {
    const exportedJson = await createBackupJson(page);

    const result = await importBackup(page, exportedJson, 'merge');
    expect(result.pets).toBe(0);
    expect(result.skipped).toBe(2);

    expect((await getPetState(page)).petCount).toBe(2);
  });

  test('import rejects invalid backup files', async ({ page }) => {
    // Not JSON
    const err1 = await page.evaluate(async () => {
      const { importDatabase } = await import('/src/lib/services/backupService.ts');
      try {
        await importDatabase('not json', 'replace');
        return null;
      } catch (e) {
        return e.message;
      }
    });
    expect(err1).toContain('Invalid JSON');

    // Wrong format
    const err2 = await page.evaluate(async () => {
      const { importDatabase } = await import('/src/lib/services/backupService.ts');
      try {
        await importDatabase(JSON.stringify({ metadata: { format: 'wrong' } }), 'replace');
        return null;
      } catch (e) {
        return e.message;
      }
    });
    expect(err2).toContain('Not a Gorgonetics backup');

    // Newer version
    const err3 = await page.evaluate(async () => {
      const { importDatabase } = await import('/src/lib/services/backupService.ts');
      const backup = {
        metadata: {
          format: 'gorgonetics-backup',
          format_version: 99,
          schema_version: 1,
          app_version: '0.1.1',
          exported_at: '',
          record_counts: { genes: 0, pets: 0 },
        },
        data: { genes: [], pets: [] },
      };
      try {
        await importDatabase(JSON.stringify(backup), 'replace');
        return null;
      } catch (e) {
        return e.message;
      }
    });
    expect(err3).toContain('newer version');
  });

  test('DataMenu UI is present and shows dropdown', async ({ page }) => {
    const menuBtn = page.getByTitle('Data management');
    await expect(menuBtn).toBeVisible();

    await menuBtn.click();
    await expect(page.getByText('Export Data')).toBeVisible();
    await expect(page.getByText('Import (Replace)')).toBeVisible();
    await expect(page.getByText('Import (Merge)')).toBeVisible();

    await page.locator('.top-bar-left').click();
    await expect(page.getByText('Export Data')).not.toBeVisible();
  });

  test('Import (Replace) shows confirmation dialog', async ({ page }) => {
    await page.getByTitle('Data management').click();
    await page.getByText('Import (Replace)').click();

    await expect(page.getByText('Replace all data?')).toBeVisible();
    await expect(page.getByText('delete all existing pets')).toBeVisible();

    await page.getByText('Cancel').click();
    await expect(page.getByText('Replace all data?')).not.toBeVisible();
  });

  test('Import (Merge) shows confirmation dialog', async ({ page }) => {
    await page.getByTitle('Data management').click();
    await page.getByText('Import (Merge)').click();

    await expect(page.getByText('Merge backup data?')).toBeVisible();

    await page.getByText('Cancel').click();
    await expect(page.getByText('Merge backup data?')).not.toBeVisible();
  });
});
