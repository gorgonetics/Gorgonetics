import { expect, test } from '@playwright/test';
import { gotoDestination, openGeneEditor, waitForAppReady, waitForPets } from './helpers.js';

// App-level smoke coverage for the four-destination IA (My Pets / Breed /
// Community / Reference). The table-first My Pets flows live in
// redesign-mypets.spec; pet editing/deletion detail lives in pet-crud.spec.
// This file keeps launch, layout, navigation, and gene-editor reachability.

test.describe('App Launch', () => {
  test('shows top bar with the four destinations', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);

    await expect(page.locator('.app-name')).toHaveText('Gorgonetics');
    await expect(page.locator('[data-testid="tab-library"]')).toBeVisible();
    await expect(page.locator('[data-testid="tab-breed"]')).toBeVisible();
    await expect(page.locator('[data-testid="tab-community"]')).toBeVisible();
    await expect(page.locator('[data-testid="tab-reference"]')).toBeVisible();
  });

  test('My Pets is the full-width default with no sidebar', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);

    await expect(page.locator('[data-testid="my-pets"]')).toBeVisible();
    await expect(page.locator('[data-testid="roster"]')).toBeVisible();
    // Table-first: no persistent master-panel sidebar on My Pets.
    await expect(page.locator('.master-panel')).toHaveCount(0);
  });

  test('has no auth UI', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);

    await expect(page.getByText('Sign In')).toHaveCount(0);
    await expect(page.getByText('Sign Up')).toHaveCount(0);
  });
});

test.describe('My Pets table', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForPets(page);
  });

  test('shows demo pets as roster rows', async ({ page }) => {
    expect(await page.locator('[data-testid="roster-open"]').count()).toBeGreaterThan(0);
  });

  test('shows search input and upload button', async ({ page }) => {
    await expect(page.locator('[data-testid="filter-search"]')).toBeVisible();
    await expect(page.locator('[data-testid="mypets-upload"]')).toContainText('Upload Genome');
  });

  test('filters rows by search', async ({ page }) => {
    const rows = page.locator('[data-testid="roster"] tbody tr');
    const before = await rows.count();
    expect(before).toBeGreaterThan(0);

    await page.locator('[data-testid="filter-search"]').fill('zzz-nonexistent');
    await expect(page.locator('[data-testid="roster-open"]')).toHaveCount(0);

    await page.locator('[data-testid="filter-search"]').fill('');
    await expect(rows).toHaveCount(before);
  });

  test('shows per-row edit/delete actions', async ({ page }) => {
    const firstRow = page.locator('[data-testid="roster"] tbody tr').first();
    await expect(firstRow.locator('[data-testid="pet-edit-btn"]')).toBeVisible();
    await expect(firstRow.locator('[data-testid="pet-delete-btn"]')).toBeVisible();
  });

  test('checking a row marks it selected', async ({ page }) => {
    await page.locator('[data-testid="roster-row-select"]').first().check();
    await expect(page.locator('[data-testid="roster"] tbody tr.row-selected')).toHaveCount(1);
  });
});

test.describe('Pet Detail View', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForPets(page);
    await page.locator('[data-testid="roster-open"]').first().click();
    await expect(page.locator('[data-testid="pet-detail"]')).toBeVisible();
  });

  test('opening a pet shows its visualization', async ({ page }) => {
    await expect(page.locator('.pet-visualization')).toBeVisible();
    await expect(page.locator('.detail-meta')).toBeVisible();
  });

  test('shows view control buttons', async ({ page }) => {
    await expect(page.locator('.view-btn').filter({ hasText: 'Attributes' })).toBeVisible();
    await expect(page.locator('.view-btn').filter({ hasText: 'Appearance' })).toBeVisible();
    await expect(page.getByTestId('detail-stats-toggle')).toBeVisible();
  });

  test('stats drawer toggles on button click', async ({ page }) => {
    await expect(page.locator('.stats-drawer')).toHaveCount(0);
    await page.getByTestId('detail-stats-toggle').click();
    await expect(page.locator('.stats-drawer')).toBeVisible();
    await page.getByTestId('detail-stats-toggle').click();
    await expect(page.locator('.stats-drawer')).toHaveCount(0);
  });

  test('back returns to the table', async ({ page }) => {
    await page.locator('[data-testid="pet-detail-back"]').click();
    await expect(page.locator('[data-testid="pet-detail"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="roster"]')).toBeVisible();
  });
});

test.describe('Gene Editor (Reference)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);
  });

  test('shows the selector form on the Reference destination', async ({ page }) => {
    await gotoDestination(page, 'Reference');
    await expect(page.locator('#animalType')).toBeVisible();
    await expect(page.locator('#chromosome')).toBeVisible();
  });

  test('populates animal types and loads chromosomes', async ({ page }) => {
    await gotoDestination(page, 'Reference');
    await expect(page.locator('#animalType option')).not.toHaveCount(1);

    const firstValue = await page.locator('#animalType option').nth(1).getAttribute('value');
    await page.locator('#animalType').selectOption(firstValue);
    await expect(page.locator('#chromosome option')).not.toHaveCount(1);
  });

  test('opens the gene editing view', async ({ page }) => {
    await openGeneEditor(page);
    await expect(page.locator('.gene-editing-header')).toBeVisible();
    await expect(page.locator('.genes-grid')).toBeVisible();
    expect(await page.locator('.gene-card').count()).toBeGreaterThan(0);
    await expect(page.locator('.export-btn')).toBeVisible();
  });
});

test.describe('Destination Navigation', () => {
  test('switches between destinations', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);

    await expect(page.locator('[data-testid="tab-library"]')).toHaveClass(/active/);

    await gotoDestination(page, 'Breed');
    await expect(page.locator('[data-testid="tab-breed"]')).toHaveClass(/active/);
    await expect(page.locator('[data-testid="breed-view"]')).toBeVisible();

    await gotoDestination(page, 'Reference');
    await expect(page.locator('[data-testid="tab-reference"]')).toHaveClass(/active/);
    await expect(page.locator('#animalType')).toBeVisible();

    await gotoDestination(page, 'My Pets');
    await expect(page.locator('[data-testid="tab-library"]')).toHaveClass(/active/);
  });

  test('returning to My Pets resets to the table', async ({ page }) => {
    await page.goto('/');
    await waitForPets(page);

    await page.locator('[data-testid="roster-open"]').first().click();
    await expect(page.locator('[data-testid="pet-detail"]')).toBeVisible();

    // Leaving unmounts My Pets; returning remounts it back at the table.
    await gotoDestination(page, 'Reference');
    await gotoDestination(page, 'My Pets');
    await expect(page.locator('[data-testid="pet-detail"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="roster"]')).toBeVisible();
  });
});

test.describe('Window Sizing', () => {
  for (const [w, h] of [
    [1200, 800],
    [1024, 768],
    [800, 600],
  ]) {
    test(`renders at ${w}x${h}`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await page.goto('/');
      await waitForAppReady(page);
      await expect(page.locator('.top-bar')).toBeVisible();
      await expect(page.locator('[data-testid="my-pets"]')).toBeVisible();
    });
  }
});
