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
});
