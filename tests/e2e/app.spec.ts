import { expect, test } from '@playwright/test';
import { gotoDestination, openGeneEditor, waitForAppReady, waitForPets } from './helpers.js';

// App-level smoke coverage for the three-destination IA (My Pets / Community /
// Reference). Pet editing/deletion lives in pet-crud.spec; the Library/Workspace
// flows live in the redesign-*.spec files — this file keeps only the launch,
// layout, navigation, and gene-editor reachability checks.

test.describe('App Launch', () => {
  test('shows top bar with the three destinations', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);

    await expect(page.locator('.app-name')).toHaveText('Gorgonetics');
    await expect(page.locator('[data-testid="tab-library"]')).toBeVisible();
    await expect(page.locator('[data-testid="tab-community"]')).toBeVisible();
    await expect(page.locator('[data-testid="tab-reference"]')).toBeVisible();
  });

  test('shows the master-detail layout with the library and workspace', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);

    await expect(page.locator('.master-panel')).toBeVisible();
    await expect(page.locator('[data-testid="library"]')).toBeVisible();
    await expect(page.locator('[data-testid="workspace"]')).toBeVisible();
  });

  test('has no auth UI', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);

    await expect(page.getByText('Sign In')).toHaveCount(0);
    await expect(page.getByText('Sign Up')).toHaveCount(0);
  });

  test('opens on the roster when nothing is selected', async ({ page }) => {
    await page.goto('/');
    await waitForPets(page);
    // With pets present and no selection, the workspace shows the roster table.
    await expect(page.locator('[data-testid="workspace-roster"]')).toBeVisible();
  });
});

test.describe('Library', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForPets(page);
  });

  test('shows demo pet rows', async ({ page }) => {
    expect(await page.locator('[data-testid="pet-row"]').count()).toBeGreaterThan(0);
  });

  test('shows search input and upload button', async ({ page }) => {
    await expect(page.locator('[data-testid="filter-search"]')).toBeVisible();
    await expect(page.locator('[data-testid="library-upload"]')).toContainText('Upload Genome');
  });

  test('shows the pet count', async ({ page }) => {
    await expect(page.locator('[data-testid="library-count"]')).toContainText('pet');
  });

  test('filters pet rows by search', async ({ page }) => {
    const rows = page.locator('[data-testid="pet-row"]');
    const before = await rows.count();
    expect(before).toBeGreaterThan(0);

    await page.locator('[data-testid="filter-search"]').fill('zzz-nonexistent');
    await expect(rows).toHaveCount(0);

    await page.locator('[data-testid="filter-search"]').fill('');
    await expect(rows).toHaveCount(before);
  });

  test('shows per-row edit/delete actions', async ({ page }) => {
    const firstRow = page.locator('[data-testid="pet-row"]').first();
    await expect(firstRow.locator('[data-testid="pet-edit-btn"]')).toBeVisible();
    await expect(firstRow.locator('[data-testid="pet-delete-btn"]')).toBeVisible();
  });
});

test.describe('Pet Detail View', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForPets(page);
  });

  test('selecting a pet shows its visualization', async ({ page }) => {
    await page.locator('[data-testid="pet-row"]').first().click();
    await expect(page.locator('.pet-visualization')).toBeVisible();
    await expect(page.locator('.detail-title')).toBeVisible();
  });

  test('shows view control buttons', async ({ page }) => {
    await page.locator('[data-testid="pet-row"]').first().click();
    await expect(page.locator('.view-btn').filter({ hasText: 'Attributes' })).toBeVisible();
    await expect(page.locator('.view-btn').filter({ hasText: 'Appearance' })).toBeVisible();
    await expect(page.locator('.view-btn').filter({ hasText: 'Stats' })).toBeVisible();
  });

  test('highlights the selected pet row', async ({ page }) => {
    await page.locator('[data-testid="pet-row"]').first().click();
    await expect(page.locator('[data-testid="pet-row"].selected')).toHaveCount(1);
  });

  test('stats drawer toggles on button click', async ({ page }) => {
    await page.locator('[data-testid="pet-row"]').first().click();
    await expect(page.locator('.pet-visualization')).toBeVisible();
    await expect(page.locator('.stats-drawer')).toHaveCount(0);

    await page.locator('.view-btn').filter({ hasText: 'Stats' }).click();
    await expect(page.locator('.stats-drawer')).toBeVisible();

    await page.locator('.view-btn').filter({ hasText: 'Stats' }).click();
    await expect(page.locator('.stats-drawer')).toHaveCount(0);
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

    await gotoDestination(page, 'Reference');
    await expect(page.locator('[data-testid="tab-reference"]')).toHaveClass(/active/);
    await expect(page.locator('#animalType')).toBeVisible();

    await gotoDestination(page, 'My Pets');
    await expect(page.locator('[data-testid="tab-library"]')).toHaveClass(/active/);
  });

  test('clears the pet selection when returning to My Pets', async ({ page }) => {
    await page.goto('/');
    await waitForPets(page);

    await page.locator('[data-testid="pet-row"]').first().click();
    await expect(page.locator('.pet-visualization')).toBeVisible();

    // Leaving unmounts the Library; returning remounts it and its mount effect
    // clears the selection, so the workspace falls back to the roster.
    await gotoDestination(page, 'Reference');
    await gotoDestination(page, 'My Pets');
    await expect(page.locator('[data-testid="workspace-roster"]')).toBeVisible();
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
      await expect(page.locator('.master-panel')).toBeVisible();
    });
  }
});
