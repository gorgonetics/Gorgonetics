import { expect, test } from '@playwright/test';
import { waitForPets } from './helpers.js';

test.describe('Pet Image Gallery', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForPets(page);
  });

  test('Gallery button appears in view controls', async ({ page }) => {
    // Select a pet first
    await page.locator('button', { hasText: 'Sample Fae Bee' }).first().click();
    await page.waitForTimeout(500);

    const galleryBtn = page.locator('.view-btn', { hasText: 'Gallery' });
    await expect(galleryBtn).toBeVisible();
  });

  test('Clicking Gallery shows the gallery view', async ({ page }) => {
    await page.locator('button', { hasText: 'Sample Fae Bee' }).first().click();
    await page.waitForTimeout(500);

    await page.locator('.view-btn', { hasText: 'Gallery' }).click();
    await page.waitForTimeout(300);

    // Should show gallery with empty state (no images in test mode)
    await expect(page.locator('.gallery')).toBeVisible();
    await expect(page.getByText('No images yet')).toBeVisible();
    await expect(page.getByText('Upload Images')).toBeVisible();
  });

  test('Toggling Gallery hides the gene visualizer', async ({ page }) => {
    await page.locator('button', { hasText: 'Sample Fae Bee' }).first().click();
    await page.waitForTimeout(500);

    // Gene visualizer should be visible initially
    await expect(page.locator('.gene-visualizer')).toBeVisible();

    // Click Gallery
    await page.locator('.view-btn', { hasText: 'Gallery' }).click();
    await page.waitForTimeout(300);

    // Gene visualizer should be hidden, gallery visible
    await expect(page.locator('.gene-visualizer')).not.toBeVisible();
    await expect(page.locator('.gallery')).toBeVisible();

    // Click Gallery again to toggle off
    await page.locator('.view-btn', { hasText: 'Gallery' }).click();
    await page.waitForTimeout(300);

    // Back to gene visualizer
    await expect(page.locator('.gene-visualizer')).toBeVisible();
    await expect(page.locator('.gallery')).not.toBeVisible();
  });

  test('Gallery shows image count', async ({ page }) => {
    await page.locator('button', { hasText: 'Sample Fae Bee' }).first().click();
    await page.waitForTimeout(500);

    await page.locator('.view-btn', { hasText: 'Gallery' }).click();
    await page.waitForTimeout(300);

    await expect(page.locator('.gallery-count')).toHaveText('0 images');
  });

  test('Upload button exists but requires Tauri for actual upload', async ({ page }) => {
    await page.locator('button', { hasText: 'Sample Fae Bee' }).first().click();
    await page.waitForTimeout(500);

    await page.locator('.view-btn', { hasText: 'Gallery' }).click();
    await page.waitForTimeout(300);

    const uploadBtn = page.getByText('Upload Images');
    await expect(uploadBtn).toBeVisible();
    await expect(uploadBtn).toBeEnabled();
  });

  test('image DB records can be inserted and queried', async ({ page }) => {
    // Directly insert an image record via the database (bypasses filesystem)
    const result = await page.evaluate(async () => {
      const { getDb } = await import('/src/lib/services/database.ts');
      const db = getDb();

      // Insert a fake image record
      const res = await db.execute(
        `INSERT INTO pet_images (pet_id, filename, original_name, caption, tags, created_at)
         VALUES ($pet_id, $filename, $original_name, $caption, $tags, $created_at)`,
        {
          pet_id: 1,
          filename: 'test-uuid.png',
          original_name: 'screenshot.png',
          caption: 'Test caption',
          tags: '["head"]',
          created_at: new Date().toISOString(),
        },
      );

      // Query it back
      const rows = await db.select('SELECT * FROM pet_images WHERE pet_id = $pet_id', { pet_id: 1 });

      return { insertId: res.lastInsertId, count: rows.length, row: rows[0] };
    });

    expect(result.insertId).toBeGreaterThan(0);
    expect(result.count).toBe(1);
    expect(result.row.filename).toBe('test-uuid.png');
    expect(result.row.original_name).toBe('screenshot.png');
    expect(result.row.caption).toBe('Test caption');
    expect(result.row.tags).toBe('["head"]');
  });

  test('bulk delete removes all image records for a pet', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { getDb } = await import('/src/lib/services/database.ts');
      const db = getDb();

      const pets = await db.select('SELECT id FROM pets LIMIT 1');
      const petId = pets[0].id;

      // Insert two image records
      for (const name of ['a.png', 'b.png']) {
        await db.execute(
          `INSERT INTO pet_images (pet_id, filename, original_name, caption, tags, created_at)
           VALUES ($pet_id, $filename, $original_name, $caption, $tags, $created_at)`,
          {
            pet_id: petId,
            filename: name,
            original_name: name,
            caption: '',
            tags: '[]',
            created_at: new Date().toISOString(),
          },
        );
      }

      const before = await db.select('SELECT COUNT(*) as cnt FROM pet_images WHERE pet_id = $pet_id', {
        pet_id: petId,
      });

      // Bulk delete (same as deleteAllImagesForPet DB path)
      await db.execute('DELETE FROM pet_images WHERE pet_id = $pet_id', { pet_id: petId });

      const after = await db.select('SELECT COUNT(*) as cnt FROM pet_images WHERE pet_id = $pet_id', { pet_id: petId });

      return { beforeCount: before[0].cnt, afterCount: after[0].cnt };
    });

    expect(result.beforeCount).toBe(2);
    expect(result.afterCount).toBe(0);
  });

  test('image record delete works independently', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { getDb } = await import('/src/lib/services/database.ts');
      const db = getDb();

      // Insert
      const res = await db.execute(
        `INSERT INTO pet_images (pet_id, filename, original_name, caption, tags, created_at)
         VALUES ($pet_id, $filename, $original_name, $caption, $tags, $created_at)`,
        {
          pet_id: 1,
          filename: 'delete-test.png',
          original_name: 'del.png',
          caption: '',
          tags: '[]',
          created_at: new Date().toISOString(),
        },
      );

      // Delete by ID
      await db.execute('DELETE FROM pet_images WHERE id = $id', { id: res.lastInsertId });

      // Verify gone
      const rows = await db.select('SELECT COUNT(*) as cnt FROM pet_images WHERE id = $id', { id: res.lastInsertId });

      return { deleted: rows[0].cnt === 0 };
    });

    expect(result.deleted).toBe(true);
  });
});
