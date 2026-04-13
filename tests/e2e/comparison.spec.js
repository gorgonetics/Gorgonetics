import { expect, test } from '@playwright/test';
import { waitForPets } from './helpers.js';

test.describe('Pet Comparison', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForPets(page);
  });

  test('shows Compare tab in top bar', async ({ page }) => {
    await expect(page.locator('.tab-btn').filter({ hasText: 'Compare' })).toBeVisible();
  });

  test('clicking Compare tab shows empty state', async ({ page }) => {
    await page.locator('.tab-btn').filter({ hasText: 'Compare' }).click();
    await expect(page.getByText('Select two pets to compare')).toBeVisible();
  });

  test('Compare tab shows pet picker in sidebar', async ({ page }) => {
    await page.locator('.tab-btn').filter({ hasText: 'Compare' }).click();
    await expect(page.locator('.picker-title')).toHaveText('Compare Pets');
    await expect(page.locator('.empty-slot')).toHaveCount(2);
  });

  test('clicking a pet in picker fills a slot', async ({ page }) => {
    await page.locator('.tab-btn').filter({ hasText: 'Compare' }).click();
    await page.locator('.picker-pet-card').first().click();
    await expect(page.locator('.empty-slot')).toHaveCount(1);
    await expect(page.locator('.slot-name')).toHaveCount(1);
  });

  test('species filter activates when slot A is filled', async ({ page }) => {
    await page.locator('.tab-btn').filter({ hasText: 'Compare' }).click();
    await page.locator('.picker-pet-card').first().click();
    // Species filter hint should appear
    await expect(page.locator('.species-filter-hint')).toBeVisible();
  });

  test('clearing a slot removes species filter', async ({ page }) => {
    await page.locator('.tab-btn').filter({ hasText: 'Compare' }).click();
    await page.locator('.picker-pet-card').first().click();
    await expect(page.locator('.species-filter-hint')).toBeVisible();

    await page.locator('.slot-clear').first().click();
    await expect(page.locator('.species-filter-hint')).toHaveCount(0);
    await expect(page.locator('.empty-slot')).toHaveCount(2);
  });

  test('swap button works with one pet', async ({ page }) => {
    await page.locator('.tab-btn').filter({ hasText: 'Compare' }).click();
    await page.locator('.picker-pet-card').first().click();
    const name = await page.locator('.slot-name').textContent();

    // Swap moves pet from Slot A to Slot B
    await page.locator('.swap-btn').click();

    // Slot A should now be empty, Slot B should have the pet
    const slots = page.locator('.picker-slot');
    await expect(slots.first().locator('.empty-slot')).toBeVisible();
    await expect(slots.last().locator('.slot-name')).toHaveText(name);
  });

  test('PetList shows compare mode button', async ({ page }) => {
    await expect(page.locator('.compare-mode-btn')).toBeVisible();
  });

  test('PetList compare mode shows checkboxes', async ({ page }) => {
    await page.locator('.compare-mode-btn').click();
    await expect(page.locator('.compare-checkbox').first()).toBeVisible();
    await expect(page.locator('.cancel-compare-btn')).toBeVisible();
  });

  test('PetList compare mode cancel exits mode', async ({ page }) => {
    await page.locator('.compare-mode-btn').click();
    await expect(page.locator('.compare-checkbox').first()).toBeVisible();

    await page.locator('.cancel-compare-btn').click();
    await expect(page.locator('.compare-checkbox')).toHaveCount(0);
    await expect(page.locator('.upload-btn')).toBeVisible();
  });

  test('PetList compare checkbox selects a pet', async ({ page }) => {
    await page.locator('.compare-mode-btn').click();
    await page.locator('.compare-checkbox').first().click();

    // Compare button should show 1/2
    await expect(page.locator('.compare-now-btn')).toContainText('1/2');
  });
});
