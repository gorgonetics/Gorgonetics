import { expect, test } from '@playwright/test';
import { waitForPets } from './helpers.js';

// ==========================================
// Database Export / Import Integration Tests
// ==========================================

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
    expect(backup.schemaVersion).toBe(1);
  });

  test('export and import (replace) round-trips correctly', async ({ page }) => {
    // 1. Capture initial state and export
    const exportedJson = await page.evaluate(async () => {
      const { getDb } = await import('/src/lib/services/database.ts');
      const { CURRENT_SCHEMA_VERSION } = await import('/src/lib/services/migrationService.ts');
      const db = getDb();
      const genes = await db.select('SELECT * FROM genes ORDER BY animal_type, chromosome, gene');
      const pets = await db.select('SELECT * FROM pets ORDER BY name');

      const petsExport = pets.map((p) => {
        const copy = { ...p };
        delete copy.id;
        if (typeof copy.genome_data === 'string') {
          try { copy.genome_data = JSON.parse(copy.genome_data); } catch {}
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

    const initial = JSON.parse(exportedJson);
    expect(initial.data.pets).toHaveLength(2);

    // 2. Delete one pet
    await page.evaluate(async () => {
      const { getDb } = await import('/src/lib/services/database.ts');
      const db = getDb();
      const pets = await db.select('SELECT id FROM pets LIMIT 1');
      await db.execute('DELETE FROM pets WHERE id = ?', [pets[0].id]);
    });

    // Verify only 1 pet remains
    const afterDelete = await page.evaluate(async () => {
      const { getDb } = await import('/src/lib/services/database.ts');
      const db = getDb();
      const pets = await db.select('SELECT * FROM pets');
      return pets.length;
    });
    expect(afterDelete).toBe(1);

    // 3. Import with replace mode
    const importResult = await page.evaluate(async (json) => {
      const { importDatabase } = await import('/src/lib/services/backupService.ts');
      return importDatabase(json, 'replace');
    }, exportedJson);

    expect(importResult.pets).toBe(2);
    expect(importResult.skipped).toBe(0);

    // 4. Verify state matches initial
    const afterImport = await page.evaluate(async () => {
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

    expect(afterImport.petCount).toBe(2);
    expect(afterImport.geneCount).toBe(initial.data.genes.length);
    expect(afterImport.petNames).toEqual(initial.data.pets.map((p) => p.name).sort());
  });

  test('export and import (merge) restores deleted pet without duplicating', async ({ page }) => {
    // 1. Export initial state
    const exportedJson = await page.evaluate(async () => {
      const { getDb } = await import('/src/lib/services/database.ts');
      const { CURRENT_SCHEMA_VERSION } = await import('/src/lib/services/migrationService.ts');
      const db = getDb();
      const genes = await db.select('SELECT * FROM genes ORDER BY animal_type, chromosome, gene');
      const pets = await db.select('SELECT * FROM pets ORDER BY name');

      const petsExport = pets.map((p) => {
        const copy = { ...p };
        delete copy.id;
        if (typeof copy.genome_data === 'string') {
          try { copy.genome_data = JSON.parse(copy.genome_data); } catch {}
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

    const initial = JSON.parse(exportedJson);

    // 2. Delete one pet
    const deletedPetName = await page.evaluate(async () => {
      const { getDb } = await import('/src/lib/services/database.ts');
      const db = getDb();
      const pets = await db.select('SELECT * FROM pets LIMIT 1');
      await db.execute('DELETE FROM pets WHERE id = ?', [pets[0].id]);
      return pets[0].name;
    });

    // 3. Import with merge mode
    const importResult = await page.evaluate(async (json) => {
      const { importDatabase } = await import('/src/lib/services/backupService.ts');
      return importDatabase(json, 'merge');
    }, exportedJson);

    // One pet was already there (skipped), one was missing (imported)
    expect(importResult.pets).toBe(1);
    expect(importResult.skipped).toBe(1);

    // 4. Verify we're back to 2 pets including the deleted one
    const afterMerge = await page.evaluate(async () => {
      const { getDb } = await import('/src/lib/services/database.ts');
      const db = getDb();
      const pets = await db.select('SELECT * FROM pets ORDER BY name');
      return {
        petCount: pets.length,
        petNames: pets.map((p) => p.name).sort(),
      };
    });

    expect(afterMerge.petCount).toBe(2);
    expect(afterMerge.petNames).toEqual(initial.data.pets.map((p) => p.name).sort());
  });

  test('merge import on full database skips all existing pets', async ({ page }) => {
    // Export then immediately merge — nothing should change
    const exportedJson = await page.evaluate(async () => {
      const { getDb } = await import('/src/lib/services/database.ts');
      const { CURRENT_SCHEMA_VERSION } = await import('/src/lib/services/migrationService.ts');
      const db = getDb();
      const genes = await db.select('SELECT * FROM genes ORDER BY animal_type, chromosome, gene');
      const pets = await db.select('SELECT * FROM pets ORDER BY name');

      const petsExport = pets.map((p) => {
        const copy = { ...p };
        delete copy.id;
        if (typeof copy.genome_data === 'string') {
          try { copy.genome_data = JSON.parse(copy.genome_data); } catch {}
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

    const importResult = await page.evaluate(async (json) => {
      const { importDatabase } = await import('/src/lib/services/backupService.ts');
      return importDatabase(json, 'merge');
    }, exportedJson);

    expect(importResult.pets).toBe(0);
    expect(importResult.skipped).toBe(2);

    // Still 2 pets
    const petCount = await page.evaluate(async () => {
      const { getDb } = await import('/src/lib/services/database.ts');
      const db = getDb();
      const result = await db.select('SELECT COUNT(*) as cnt FROM pets');
      return result[0].cnt;
    });
    expect(petCount).toBe(2);
  });

  test('import rejects invalid backup files', async ({ page }) => {
    // Not JSON
    const err1 = await page.evaluate(async () => {
      const { importDatabase } = await import('/src/lib/services/backupService.ts');
      try { await importDatabase('not json', 'replace'); return null; } catch (e) { return e.message; }
    });
    expect(err1).toContain('Invalid JSON');

    // Wrong format
    const err2 = await page.evaluate(async () => {
      const { importDatabase } = await import('/src/lib/services/backupService.ts');
      try { await importDatabase(JSON.stringify({ metadata: { format: 'wrong' } }), 'replace'); return null; } catch (e) { return e.message; }
    });
    expect(err2).toContain('Not a Gorgonetics backup');

    // Newer version
    const err3 = await page.evaluate(async () => {
      const { importDatabase } = await import('/src/lib/services/backupService.ts');
      const backup = {
        metadata: { format: 'gorgonetics-backup', format_version: 99, schema_version: 1, app_version: '0.1.1', exported_at: '', record_counts: { genes: 0, pets: 0 } },
        data: { genes: [], pets: [] },
      };
      try { await importDatabase(JSON.stringify(backup), 'replace'); return null; } catch (e) { return e.message; }
    });
    expect(err3).toContain('newer version');
  });

  test('DataMenu UI is present and shows dropdown', async ({ page }) => {
    // The database icon button should exist
    const menuBtn = page.getByTitle('Data management');
    await expect(menuBtn).toBeVisible();

    // Click opens dropdown
    await menuBtn.click();
    await expect(page.getByText('Export Data')).toBeVisible();
    await expect(page.getByText('Import (Replace)')).toBeVisible();
    await expect(page.getByText('Import (Merge)')).toBeVisible();

    // Click outside closes dropdown
    await page.locator('.top-bar-left').click();
    await expect(page.getByText('Export Data')).not.toBeVisible();
  });

  test('Import (Replace) shows confirmation dialog', async ({ page }) => {
    await page.getByTitle('Data management').click();
    await page.getByText('Import (Replace)').click();

    // Confirmation dialog should appear
    await expect(page.getByText('Replace all data?')).toBeVisible();
    await expect(page.getByText('delete all existing pets')).toBeVisible();

    // Cancel closes it
    await page.getByText('Cancel').click();
    await expect(page.getByText('Replace all data?')).not.toBeVisible();
  });

  test('Import (Merge) shows confirmation dialog', async ({ page }) => {
    await page.getByTitle('Data management').click();
    await page.getByText('Import (Merge)').click();

    // Confirmation dialog should appear
    await expect(page.getByText('Merge backup data?')).toBeVisible();

    // Cancel closes it
    await page.getByText('Cancel').click();
    await expect(page.getByText('Merge backup data?')).not.toBeVisible();
  });
});
