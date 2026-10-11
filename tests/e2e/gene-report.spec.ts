import { expect, type Page, test } from '@playwright/test';
import { blockFirestore, openGeneEditor, waitForAppReady } from './helpers.js';

// Edit → save → "Report upstream" → dialog preview. Firestore traffic is
// aborted, so the suite never writes to the live project; the send path is
// covered by tests/unit/geneReportDialog.test.ts (mocked service) and the
// rules by tests/integration/geneReports.emulator.test.ts.

/** Change the first gene's dominant effect to a different value. Returns the gene ID. */
async function editFirstGene(page: Page): Promise<string> {
  const card = page.locator('.gene-card').first();
  const geneId = (await card.locator('.gene-id').textContent())?.trim() ?? '';
  const trigger = card.locator('.select-trigger').first();
  const current = (await trigger.textContent())?.replace('▼', '').trim();

  await trigger.click();
  const options = card.locator('.dropdown .option.positive');
  const count = await options.count();
  for (let i = 0; i < count; i++) {
    const text = (await options.nth(i).textContent())?.trim();
    if (text && text !== current) {
      await options.nth(i).click();
      break;
    }
  }
  return geneId;
}

async function editAndSaveFirstGene(page: Page): Promise<string> {
  const geneId = await editFirstGene(page);
  await page.locator('.save-btn').click();
  await expect(page.locator('.save-btn')).toHaveText(/All Saved/);
  return geneId;
}

test.describe('Gene effect reports', () => {
  test.beforeEach(async ({ page }) => {
    await blockFirestore(page);
    await page.goto('/');
    await waitForAppReady(page);
    await openGeneEditor(page);
  });

  test('offers no report while genes match the bundled data', async ({ page }) => {
    await expect(page.locator('.genes-grid')).toBeVisible();
    await expect(page.getByTestId('gene-report-btn')).toHaveCount(0);
  });

  test('a saved edit can be previewed for reporting', async ({ page }) => {
    const geneId = await editAndSaveFirstGene(page);

    const button = page.getByTestId('gene-report-btn');
    await expect(button).toHaveText('Report upstream (1)');
    await button.click();

    const dialog = page.getByRole('dialog', { name: 'Report gene corrections' });
    await expect(dialog).toBeVisible();
    const rows = dialog.getByTestId('gene-report-row');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText(geneId);
    await expect(rows.first()).toContainText('→');
    await expect(dialog.getByTestId('gene-report-fields')).toContainText('set by the server');
    await expect(dialog.getByTestId('gene-report-send')).toBeEnabled();
  });

  test('the button waits for unsaved edits to be saved', async ({ page }) => {
    await editAndSaveFirstGene(page);
    // A second, unsaved edit disables reporting until it is saved. A text
    // field, not an effect dropdown: after a save the success banner pushes
    // the card down and the dropdown flips up under the sticky header.
    await page.locator('.gene-card').first().locator('input[id^="appearance-"]').fill('e2e appearance');
    await expect(page.getByTestId('gene-report-btn')).toBeDisabled();
    await page.locator('.save-btn').click();
    await expect(page.getByTestId('gene-report-btn')).toBeEnabled();
  });

  test("switching chromosome drops the previous chromosome's reports", async ({ page }) => {
    await editAndSaveFirstGene(page);
    await expect(page.getByTestId('gene-report-btn')).toBeVisible();

    const next = await page.locator('#chromosome option').nth(2).getAttribute('value');
    await page.locator('#chromosome').selectOption(next);
    await page.locator('button.load-btn').click();
    await expect(page.locator('.gene-editing-title')).toContainText(next ?? '');
    await expect(page.getByTestId('gene-report-btn')).toHaveCount(0);
  });

  test('Cancel and Escape close the dialog', async ({ page }) => {
    await editAndSaveFirstGene(page);
    const dialog = page.getByRole('dialog', { name: 'Report gene corrections' });

    await page.getByTestId('gene-report-btn').click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).not.toBeVisible();

    await page.getByTestId('gene-report-btn').click();
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
  });
});
