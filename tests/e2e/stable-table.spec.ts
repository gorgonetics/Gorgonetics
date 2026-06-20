import { expect, type Page, test } from '@playwright/test';
import { blockFirestore, waitForAppReady } from './helpers.js';

async function openStable(page: Page) {
  await page.goto('/');
  await waitForAppReady(page);
  await page.locator('.tab-btn').filter({ hasText: 'Stable' }).click();
  await expect(page.locator('[data-testid="stable-view"]')).toBeVisible();
}

test.describe('Stable Table', () => {
  test('renders the table with columns and at least one stabled pet', async ({ page }) => {
    await openStable(page);
    await expect(page.locator('.stable-table')).toBeVisible();
    // Demo data always ships one beewasp pet; default species is the first
    // supported species (beewasp), so it should render with a row.
    await expect(page.locator('.stable-table tbody tr')).not.toHaveCount(0);
  });

  test('species tabs swap the visible pets and the species-specific column', async ({ page }) => {
    await openStable(page);

    // Beewasp view must expose a Ferocity column and no Temperament column.
    await expect(page.locator('.stable-table th[data-col="ferocity"]')).toBeVisible();
    await expect(page.locator('.stable-table th[data-col="temperament"]')).toHaveCount(0);

    await page.locator('.species-tab-btn[data-species="horse"]').click();

    // Horse view flips the species-specific column.
    await expect(page.locator('.stable-table th[data-col="temperament"]')).toBeVisible();
    await expect(page.locator('.stable-table th[data-col="ferocity"]')).toHaveCount(0);
  });

  test('clicking a header toggles the sort direction', async ({ page }) => {
    await openStable(page);

    const nameHeader = page.locator('.stable-table th[data-col="name"] .header-sort-btn');

    // Default sort is on name, ascending.
    await expect(nameHeader).toContainText('▲');

    await nameHeader.click();
    await expect(nameHeader).toContainText('▼');

    await nameHeader.click();
    await expect(nameHeader).toContainText('▲');
  });

  test('sort column falls back to name when switching to a species without that attribute', async ({ page }) => {
    await openStable(page);

    // Sort by ferocity (beewasp-specific).
    await page.locator('.stable-table th[data-col="ferocity"] .header-sort-btn').click();
    await expect(page.locator('.stable-table th[data-col="ferocity"]')).toHaveClass(/active-sort/);

    // Switching to horse drops ferocity; the sort should fall back to name.
    await page.locator('.species-tab-btn[data-species="horse"]').click();
    await expect(page.locator('.stable-table th[data-col="name"]')).toHaveClass(/active-sort/);
  });

  test('positive-genes column is visible and numeric', async ({ page }) => {
    await openStable(page);
    const header = page.locator('.stable-table th[data-col="positive_genes"]');
    await expect(header).toBeVisible();
    await expect(header).toHaveClass(/numeric/);
  });

  test('view action switches to Pets tab and opens the visualization', async ({ page }) => {
    await openStable(page);
    await page.locator('.stable-table tbody tr button[data-action="view"]').first().click();
    await expect(page.locator('.tab-btn').filter({ hasText: 'Pets' })).toHaveClass(/active/);
    await expect(page.locator('.pet-visualization')).toBeVisible();
  });

  test('edit action opens the pet editor modal', async ({ page }) => {
    await openStable(page);
    await page.locator('.stable-table tbody tr button[data-action="edit"]').first().click();
    await expect(page.getByText('Basic Information')).toBeVisible();
  });

  test('text search narrows rows by pet name', async ({ page }) => {
    await openStable(page);
    const rowsBefore = await page.locator('.stable-table tbody tr[data-pet-id]').count();
    expect(rowsBefore).toBeGreaterThan(0);

    await page.locator('[data-testid="stable-search"]').fill('zzz-nonexistent-name');
    await expect(page.locator('.stable-table tbody tr[data-pet-id]')).toHaveCount(0);

    await page.locator('[data-testid="stable-search"]').fill('');
    await expect(page.locator('.stable-table tbody tr[data-pet-id]')).toHaveCount(rowsBefore);
  });

  test('gender filter narrows rows and persists across tabs', async ({ page }) => {
    await openStable(page);

    // The demo beewasp is Female; switching to Male should empty the table.
    await page.locator('[data-testid="stable-gender"]').selectOption('Male');
    await expect(page.locator('.stable-table tbody tr[data-pet-id]')).toHaveCount(0);

    // Bounce through another tab; gender filter should still be "Male".
    await page.locator('.tab-btn').filter({ hasText: 'Pets' }).click();
    await page.locator('.tab-btn').filter({ hasText: 'Stable' }).click();
    await expect(page.locator('[data-testid="stable-gender"]')).toHaveValue('Male');
  });

  test('breed filter resets when switching species', async ({ page }) => {
    await openStable(page);

    // Switch to horse, pick a horse breed.
    await page.locator('.species-tab-btn[data-species="horse"]').click();
    await page.locator('[data-testid="stable-breed"]').selectOption('Standardbred');
    await expect(page.locator('[data-testid="stable-breed"]')).toHaveValue('Standardbred');

    // Switch back to beewasp — Standardbred is not a beewasp breed, should reset.
    await page.locator('.species-tab-btn[data-species="beewasp"]').click();
    await expect(page.locator('[data-testid="stable-breed"]')).toHaveValue('all');
  });

  test('view state (species + sort) persists across tab switches', async ({ page }) => {
    await openStable(page);

    // Switch to horse and sort by toughness descending.
    await page.locator('.species-tab-btn[data-species="horse"]').click();
    const toughnessHeader = page.locator('.stable-table th[data-col="toughness"] .header-sort-btn');
    await toughnessHeader.click(); // asc
    await toughnessHeader.click(); // desc
    await expect(toughnessHeader).toContainText('▼');

    // Bounce through another tab.
    await page.locator('.tab-btn').filter({ hasText: 'Pets' }).click();
    await page.locator('.tab-btn').filter({ hasText: 'Stable' }).click();

    // Horse species and desc sort on toughness should be restored.
    await expect(page.locator('.species-tab-btn[data-species="horse"]')).toHaveClass(/active/);
    await expect(page.locator('.stable-table th[data-col="toughness"] .header-sort-btn')).toContainText('▼');
  });

  test('compare action toggles active state and reveals the compare-now button', async ({ page }) => {
    await openStable(page);
    const compareBtn = page.locator('.stable-table tbody tr button[data-action="compare"]').first();

    await expect(compareBtn).not.toHaveClass(/active/);
    await compareBtn.click();
    await expect(compareBtn).toHaveClass(/active/);

    // Only one pet selected — compare-now should not appear yet.
    await expect(page.locator('.compare-now-btn')).toHaveCount(0);

    // Switch species, pick the second pet, then compare-now appears.
    await page.locator('.species-tab-btn[data-species="horse"]').click();
    const horseCompare = page.locator('.stable-table tbody tr button[data-action="compare"]').first();
    await horseCompare.click();

    await expect(page.locator('.compare-now-btn')).toBeVisible();
  });
});

test.describe('Stable Table — bulk share', () => {
  test('select-all checks every filtered row and shows the bulk action bar', async ({ page }) => {
    await openStable(page);
    const rows = page.locator('.stable-table tbody tr[data-pet-id]');
    const rowCount = await rows.count();
    expect(rowCount).toBeGreaterThan(0);

    // No selection → no bulk action bar.
    await expect(page.getByTestId('bulk-actions')).toHaveCount(0);

    await page.getByTestId('bulk-select-all').check();

    // Every row checkbox is checked and the bar reports the full count.
    const rowBoxes = page.getByTestId('bulk-select-row');
    for (let i = 0; i < rowCount; i++) {
      await expect(rowBoxes.nth(i)).toBeChecked();
    }
    await expect(page.getByTestId('bulk-actions')).toContainText(`${rowCount} selected`);

    // Clear resets selection and hides the bar.
    await page.locator('.bulk-clear-btn').click();
    await expect(page.getByTestId('bulk-actions')).toHaveCount(0);
    await expect(rowBoxes.first()).not.toBeChecked();
  });

  test('a single row selection opens the bulk dialog with the right count, and cancel closes it', async ({ page }) => {
    await openStable(page);
    await page.getByTestId('bulk-select-row').first().check();
    await expect(page.getByTestId('bulk-actions')).toContainText('1 selected');

    await page.getByTestId('bulk-share-open').click();
    const dialog = page.getByTestId('bulk-share-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Share 1 pet to the community');
    // Notes-excluded guarantee is stated up front.
    await expect(dialog).toContainText('Notes stay local');

    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByTestId('bulk-share-dialog')).toHaveCount(0);
  });

  test('confirming starts the batch run (progress UI appears)', async ({ page }) => {
    // Block Firestore so the run never touches the live catalogue. We assert
    // the run *starts* (progress phase) rather than waiting for completion —
    // the Firestore client queues writes when offline instead of failing fast,
    // so the terminal summary is non-deterministic here. The created/skipped/
    // failed accounting is covered by the uploadPets unit tests.
    await blockFirestore(page);
    await openStable(page);

    await page.getByTestId('bulk-select-all').check();
    await page.getByTestId('bulk-share-open').click();
    await page.getByTestId('bulk-share-confirm').click();

    // Confirm flips the dialog into the running phase with a progress bar.
    await expect(page.getByTestId('bulk-share-progress')).toBeVisible();
    await expect(page.getByTestId('bulk-share-cancel')).toBeVisible();
  });
});
