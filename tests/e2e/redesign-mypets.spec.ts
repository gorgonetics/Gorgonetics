import { expect, type Page, test } from '@playwright/test';
import { waitForAppReady } from './helpers.js';

// My Pets — the table-first home. The full-width roster is the primary surface;
// clicking a name opens a full-view detail with back; checkboxes drive bulk
// actions (Compare / Share). No persistent sidebar.

async function openMyPets(page: Page) {
  await page.goto('/');
  await waitForAppReady(page);
  await expect(page.locator('[data-testid="my-pets"]')).toBeVisible();
  await expect(page.locator('[data-testid="roster"]')).toBeVisible();
  // The startup backfill chain fires loadPets() after the spinner clears,
  // re-rendering the roster. Wait for it to settle so a later click doesn't
  // race a DOM swap that detaches the row/control mid-action. See AuthWrapper.
  await page.waitForSelector('[data-backfills-done="true"]');
}

/** Synthetic genome-file drop onto the roster table. */
async function dropGenomeOnTable(page: Page, files: { name: string; url?: string; content?: string }[]) {
  await page.evaluate(async (files) => {
    const dt = new DataTransfer();
    for (const f of files) {
      const content = f.url ? await (await fetch(f.url)).text() : (f.content ?? '');
      dt.items.add(new File([content], f.name, { type: 'text/plain' }));
    }
    Object.defineProperty(dt, 'types', { value: ['Files'], configurable: true });
    document
      .querySelector('[data-testid="mypets-table"]')
      ?.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
  }, files);
}

test.describe('Redesign — My Pets (table-first)', () => {
  test('My Pets is the default destination and shows the roster table', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);
    await expect(page.locator('[data-testid="tab-library"]')).toHaveClass(/active/);
    await expect(page.locator('[data-testid="tab-breed"]')).toBeVisible();
    await expect(page.locator('[data-testid="my-pets"]')).toBeVisible();
    await expect(page.locator('[data-testid="roster-open"]').first()).toBeVisible();
  });

  test('clicking a pet name opens its detail; back returns to the table', async ({ page }) => {
    await openMyPets(page);
    await page.locator('[data-testid="roster-open"]').first().click();

    await expect(page.locator('[data-testid="pet-detail"]')).toBeVisible();
    await expect(page.locator('.pet-visualization')).toBeVisible();
    // Square gene cells (the unified shape).
    const cell = page.locator('.pet-visualization .gene-cell').first();
    await expect(cell).toBeVisible();
    await expect.poll(() => cell.evaluate((el) => getComputedStyle(el).borderRadius)).toBe('3px');

    await page.locator('[data-testid="pet-detail-back"]').click();
    await expect(page.locator('[data-testid="pet-detail"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="roster"]')).toBeVisible();
  });

  test('dimming a gene (chromosome select) preserves its fill, only fading it', async ({ page }) => {
    // Regression: `.gene-filtered-out` used to force a solid background + grey
    // border, so a dimmed recessive (hollow) or mixed (half-gradient) gene
    // redrew as a solid square (visible flicker + wrong shape). Dimming must
    // only fade/desaturate and keep the original fill, like the trio grid.
    await openMyPets(page);
    await page.locator('button[data-testid="roster-open"]:has-text("Sample Horse")').click();
    await expect(page.locator('.pet-visualization')).toBeVisible();

    // Select a single chromosome — every gene on other chromosomes dims.
    await page.locator('.pet-visualization .chromosome-label[data-chromosome="01"]').click();

    const dimmedRecessive = page.locator('.pet-visualization .gene-cell.gene-filtered-out.gene-recessive').first();
    await expect(dimmedRecessive).toBeAttached();
    // Poll opacity — the fade transitions from 1 over 0.2s, so a bare read can
    // catch it mid-animation.
    await expect
      .poll(() => dimmedRecessive.evaluate((el) => Number(getComputedStyle(el).opacity)))
      .toBeLessThan(1);
    const recessive = await dimmedRecessive.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { bg: cs.backgroundColor, borderWidth: cs.borderWidth };
    });
    // Recessive keeps its translucent centre + thick border (not the old solid
    // rgb(249,250,251) fill).
    expect(recessive.borderWidth).toBe('4px');
    expect(recessive.bg).not.toBe('rgb(249, 250, 251)');

    const dimmedMixed = page.locator('.pet-visualization .gene-cell.gene-filtered-out.gene-mixed').first();
    if (await dimmedMixed.count()) {
      const bgImage = await dimmedMixed.evaluate((el) => getComputedStyle(el).backgroundImage);
      // Mixed keeps its half-fill gradient rather than a flat fill.
      expect(bgImage).toContain('linear-gradient');
    }
  });

  test('a roster row can edit and delete a pet', async ({ page }) => {
    await openMyPets(page);
    const rows = page.locator('[data-testid="roster"] tbody tr');

    // Edit the first pet's name via its row action.
    const newName = `Renamed-${Date.now()}`;
    await rows.first().locator('[data-testid="pet-edit-btn"]').click();
    await expect(page.locator('.modal-panel')).toBeVisible();
    await page.locator('#petName').fill(newName);
    await page.locator('.btn-primary').click();
    await expect(page.locator('.modal-panel')).not.toBeVisible();
    await expect(page.locator('[data-testid="roster-open"]').filter({ hasText: newName }).first()).toBeVisible();

    // Delete a pet via its row action.
    const before = await rows.count();
    await rows.first().locator('[data-testid="pet-delete-btn"]').click();
    await page.locator('[role="alertdialog"] .btn-danger').click();
    await expect(rows).toHaveCount(before - 1);
  });

  test('selecting two same-species pets enables Compare', async ({ page }) => {
    await openMyPets(page);
    // Narrow to horses (the demo has two) so the pair shares a species.
    await page.locator('[data-testid="filter-species"] [data-species="horse"]').click();
    const checks = page.locator('[data-testid="roster-row-select"]');
    await expect(checks).toHaveCount(2);
    await checks.nth(0).check();
    await checks.nth(1).check();

    await expect(page.locator('[data-testid="mypets-selection"]')).toContainText('2 selected');
    await page.locator('[data-testid="mypets-compare"]').click();

    await expect(page.locator('[data-testid="pet-compare"]')).toBeVisible();
    // The diff reports the species gene total, not the padded grid size. The
    // ~2304-cell grid computes asynchronously, so allow it room.
    const summary = page.locator('[data-testid="pet-compare"] .summary-detail');
    await expect(summary).toBeVisible({ timeout: 15000 });
    await expect(summary).toContainText('/1576 genes match');
    await expect(summary).not.toContainText('/2304');

    await page.locator('[data-testid="pet-compare-back"]').click();
    await expect(page.locator('[data-testid="pet-compare"]')).toHaveCount(0);
  });

  test('the gender filter narrows the roster', async ({ page }) => {
    await openMyPets(page);
    // Narrow to horses: Sample Horse (Male) + Roach (Female).
    await page.locator('[data-testid="filter-species"] [data-species="horse"]').click();
    const rows = page.locator('[data-testid="roster"] tbody tr');
    await expect(rows).toHaveCount(2);

    await page.locator('[data-testid="filter-gender"] [data-gender="Male"]').click();
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('Sample Horse');

    await page.locator('[data-testid="filter-gender"] [data-gender=""]').click();
    await expect(rows).toHaveCount(2);
  });

  test('a selected pet hidden by a filter drops out of the bulk selection', async ({ page }) => {
    await openMyPets(page);
    await page.locator('[data-testid="filter-species"] [data-species="horse"]').click();
    const checks = page.locator('[data-testid="roster-row-select"]');
    await expect(checks).toHaveCount(2);
    await checks.nth(0).check();
    await checks.nth(1).check();
    await expect(page.locator('[data-testid="mypets-selection"]')).toContainText('2 selected');
    await expect(page.locator('[data-testid="mypets-compare"]')).toBeEnabled();

    // Filter to Male hides one selected horse; it must leave the selection so
    // Compare/Share can't act on an off-screen pet.
    await page.locator('[data-testid="filter-gender"] [data-gender="Male"]').click();
    await expect(page.locator('[data-testid="mypets-selection"]')).toContainText('1 selected');
    await expect(page.locator('[data-testid="mypets-compare"]')).toBeDisabled();
  });

  test('a multi-selection can be bulk-shared to the community', async ({ page }) => {
    await openMyPets(page);
    const checks = page.locator('[data-testid="roster-row-select"]');
    await checks.nth(0).check();
    await checks.nth(1).check();

    await expect(page.locator('[data-testid="mypets-selection"]')).toContainText('2 selected');
    await page.locator('[data-testid="mypets-share"]').click();

    const dialog = page.getByTestId('bulk-share-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Share 2 pets to the community');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByTestId('bulk-share-dialog')).toHaveCount(0);
  });

  test('exposes upload + auto-scan, and a dropped genome uploads', async ({ page }) => {
    await openMyPets(page);
    await expect(page.locator('[data-testid="mypets-upload"]')).toBeVisible();
    await expect(page.locator('[data-testid="mypets-autoscan"]')).toBeVisible();

    // Drag-over shows the overlay.
    await page.evaluate(() => {
      const dt = new DataTransfer();
      Object.defineProperty(dt, 'types', { value: ['Files'], configurable: true });
      document
        .querySelector('[data-testid="mypets-table"]')
        ?.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
    });
    await expect(page.locator('.file-drop-overlay')).toBeVisible();

    // Delete Sample Horse, then drop to re-add it.
    const rows = page.locator('[data-testid="roster"] tbody tr');
    const horseRow = rows.filter({ hasText: 'Sample Horse' }).first();
    const before = await rows.count();
    await horseRow.locator('[data-testid="pet-delete-btn"]').click();
    await page.locator('[role="alertdialog"] .btn-danger').click();
    await expect(rows).toHaveCount(before - 1);

    await dropGenomeOnTable(page, [{ name: 'Genes_SampleHorse.txt', url: '/data/Genes_SampleHorse.txt' }]);
    await expect(rows).toHaveCount(before);
    await expect(rows.filter({ hasText: 'Sample Horse' }).first()).toBeVisible();
  });
});
