import { expect, type Page, test } from '@playwright/test';
import { waitForAppReady } from './helpers.js';

// My Pets (the Library + Workspace shell) is the default destination.
async function openLibrary(page: Page) {
  await page.goto('/');
  await waitForAppReady(page);
  await expect(page.locator('[data-testid="library"]')).toBeVisible();
}

/** Dispatch a synthetic genome-file drop onto the library list (see drop-upload.spec). */
async function dropGenomeOnLibrary(page: Page, files: { name: string; url?: string; content?: string }[]) {
  await page.evaluate(async (files) => {
    const dt = new DataTransfer();
    for (const f of files) {
      const content = f.url ? await (await fetch(f.url)).text() : (f.content ?? '');
      dt.items.add(new File([content], f.name, { type: 'text/plain' }));
    }
    Object.defineProperty(dt, 'types', { value: ['Files'], configurable: true });
    document
      .querySelector('[data-testid="library-list"]')
      ?.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
  }, files);
}

test.describe('Redesign — Library + Workspace shell', () => {
  test('My Pets is the default destination', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);
    // The three-destination nav, with My Pets active by default.
    await expect(page.locator('[data-testid="tab-library"]')).toHaveClass(/active/);
    await expect(page.locator('[data-testid="tab-community"]')).toBeVisible();
    await expect(page.locator('[data-testid="tab-reference"]')).toBeVisible();
    await expect(page.locator('[data-testid="library"]')).toBeVisible();
  });

  test('shows the roster when nothing is selected, and a pet detail once selected', async ({ page }) => {
    await openLibrary(page);
    // Nothing selected → the full roster table fills the workspace.
    await expect(page.locator('[data-testid="workspace-roster"]')).toBeVisible();
    await expect(page.locator('[data-testid="roster"]')).toBeVisible();

    // Opening a pet from the roster shows its detail.
    await page.locator('[data-testid="roster-open"]').first().click();
    await expect(page.locator('.pet-visualization')).toBeVisible();
    // The pet detail renders gene cells in the unified square shape — assert
    // the computed border-radius so a regression back to circles (50% → 7px)
    // fails the test rather than passing on mere presence.
    const petCell = page.locator('.pet-visualization .gene-cell').first();
    await expect(petCell).toBeVisible();
    await expect.poll(() => petCell.evaluate((el) => getComputedStyle(el).borderRadius)).toBe('3px');
  });

  test('two same-species pets open the multi lens with Compare and Breed tabs', async ({ page }) => {
    await openLibrary(page);

    // Narrow to horses (the demo has two) so both selected pets share a species.
    await page.locator('[data-testid="filter-species"] [data-species="horse"]').click();
    const checks = page.locator('[data-testid="pet-row-select"]');
    await expect(checks).toHaveCount(2);
    await checks.nth(0).check();
    await checks.nth(1).check();

    // Compare is the default lens for exactly two same-species pets.
    await expect(page.locator('[data-testid="workspace-multi"]')).toBeVisible();
    await expect(page.locator('[data-testid="lens-tab-compare"]')).toHaveClass(/active/);
    // The Compare diff renders gene cells in the unified square shape — assert
    // the computed border-radius to guard against a regression to circles.
    const compareCell = page.locator('[data-testid="workspace-multi"] .gene-cell').first();
    await expect(compareCell).toBeVisible();
    await expect.poll(() => compareCell.evaluate((el) => getComputedStyle(el).borderRadius)).toBe('3px');

    // Switching to the Breed lens ranks the pair; inspecting opens the trio.
    await page.locator('[data-testid="lens-tab-breed"]').click();
    await expect(page.locator('[data-testid="lens-tab-breed"]')).toHaveClass(/active/);
    await expect(page.locator('[data-testid="breeding-pair-table"]')).toBeVisible();
    await page.locator('[data-testid="inspect-pair"]').first().click();
    await expect(page.getByTestId('trio-view')).toBeVisible();
    await page.getByTestId('trio-view').getByRole('button', { name: 'Close trio view' }).click();

    // Clearing the selection resets the lens — a fresh 2-pet selection reopens on Compare.
    await page.locator('[data-testid="library-foot"] .clear-btn').click();
    const checks2 = page.locator('[data-testid="pet-row-select"]');
    await checks2.nth(0).check();
    await checks2.nth(1).check();
    await expect(page.locator('[data-testid="lens-tab-compare"]')).toHaveClass(/active/);
  });

  test('the Compare lens reports the species gene total, not the padded grid size', async ({ page }) => {
    // Regression (ported from the retired Compare tab): the diff loop padded
    // every chromosome to the largest grid shape (48×48=2304 for horses), which
    // was wrongly reported as the gene total — a horse genome has 1576 positions.
    await openLibrary(page);
    await page.locator('[data-testid="filter-species"] [data-species="horse"]').click();
    const checks = page.locator('[data-testid="pet-row-select"]');
    await expect(checks).toHaveCount(2);
    await checks.nth(0).check();
    await checks.nth(1).check();

    await expect(page.locator('[data-testid="lens-tab-compare"]')).toHaveClass(/active/);
    const summary = page.locator('[data-testid="workspace-multi"] .summary-detail');
    await expect(summary).toBeVisible();
    await expect(summary).toContainText('/1576 genes match');
    await expect(summary).not.toContainText('/2304');
  });

  test('a library row can edit a pet via the shared editor', async ({ page }) => {
    await openLibrary(page);
    const firstRow = page.locator('[data-testid="pet-row"]').first();
    const newName = `Renamed-${Date.now()}`;

    await firstRow.locator('[data-testid="pet-edit-btn"]').click();
    await expect(page.locator('.modal-panel')).toBeVisible();
    await page.locator('#petName').fill(newName);
    await page.locator('.btn-primary').click();

    await expect(page.locator('.modal-panel')).not.toBeVisible();
    await expect(page.locator('[data-testid="pet-row"] .pr-name').filter({ hasText: newName }).first()).toBeVisible();
  });

  test('a library row can delete a pet after confirmation', async ({ page }) => {
    await openLibrary(page);
    const rows = page.locator('[data-testid="pet-row"]');
    const before = await rows.count();
    expect(before).toBeGreaterThan(0);

    await rows.first().locator('[data-testid="pet-delete-btn"]').click();
    const dialog = page.locator('[role="alertdialog"]');
    await expect(dialog).toBeVisible();
    await dialog.locator('.btn-danger').click();

    await expect(rows).toHaveCount(before - 1);
  });

  test('the library exposes upload and auto-scan actions', async ({ page }) => {
    await openLibrary(page);
    await expect(page.locator('[data-testid="library-upload"]')).toBeVisible();
    await expect(page.locator('[data-testid="library-autoscan"]')).toBeVisible();
  });

  test('dragging genome files over the library shows a drop overlay', async ({ page }) => {
    await openLibrary(page);
    await page.evaluate(() => {
      const dt = new DataTransfer();
      Object.defineProperty(dt, 'types', { value: ['Files'], configurable: true });
      document
        .querySelector('[data-testid="library-list"]')
        ?.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
    });
    await expect(page.locator('.file-drop-overlay')).toBeVisible();
    await expect(page.locator('.file-drop-overlay')).toHaveText(/Drop genome files/);
  });

  test('dropping a genome file uploads it into the library', async ({ page }) => {
    await openLibrary(page);
    const rows = page.locator('[data-testid="pet-row"]');

    // Remove the demo Sample Horse so the drop re-adds it (content-hash dedup
    // makes re-uploading an existing pet a no-op otherwise).
    const horseRow = rows.filter({ hasText: 'Sample Horse' }).first();
    const before = await rows.count();
    await horseRow.locator('[data-testid="pet-delete-btn"]').click();
    await page.locator('[role="alertdialog"] .btn-danger').click();
    await expect(rows).toHaveCount(before - 1);

    await dropGenomeOnLibrary(page, [{ name: 'Genes_SampleHorse.txt', url: '/data/Genes_SampleHorse.txt' }]);

    await expect(rows).toHaveCount(before);
    await expect(rows.filter({ hasText: 'Sample Horse' }).first()).toBeVisible();
  });

  test('a multi-selection can be bulk-shared to the community', async ({ page }) => {
    await openLibrary(page);

    const checks = page.locator('[data-testid="pet-row-select"]');
    await checks.nth(0).check();
    await checks.nth(1).check();

    // The selection footer surfaces the bulk-share action.
    const foot = page.locator('[data-testid="library-foot"]');
    await expect(foot).toContainText('2 selected');
    await foot.locator('[data-testid="library-bulk-share"]').click();

    const dialog = page.getByTestId('bulk-share-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Share 2 pets to the community');

    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByTestId('bulk-share-dialog')).toHaveCount(0);
  });
});
