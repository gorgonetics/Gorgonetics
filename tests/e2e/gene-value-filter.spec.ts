import { expect, type Page, test } from '@playwright/test';
import { gotoDestination, waitForAppReady } from './helpers.js';

// Gene value filter (#369) — the Genes section in My Pets narrows the roster
// by allele criteria. One shared filter result feeds the table, the counts
// line and the footer (#405), so they can never disagree.
// See docs/design/gene-value-filter-v1.md.

async function openMyPets(page: Page) {
  await page.goto('/');
  await waitForAppReady(page);
  await expect(page.locator('[data-testid="roster"]')).toBeVisible();
  await page.waitForSelector('[data-backfills-done="true"]');
}

async function addToughnessCriterion(page: Page) {
  await page.locator('[data-testid="filter-species"] [data-species="horse"]').click();
  await page.locator('[data-testid="gene-filter-toggle"]').click();
  await page.locator('[data-testid="gene-filter-group"]').selectOption('Toughness');
  await page.locator('[data-testid="gene-filter-add"]').click();
  await expect(page.locator('[data-testid="gene-chip-group"]')).toBeVisible();
}

test.describe('Gene value filter', () => {
  test('expanding an attribute adds one chip and narrows the roster', async ({ page }) => {
    await openMyPets(page);
    const rows = page.locator('[data-testid="roster"] tbody tr[data-pet-id]');
    await addToughnessCriterion(page);

    // One chip per criterion, not one per locus (§6) — with the real
    // Toughness expansion size in its label.
    const chips = page.locator('[data-testid="gene-chip-group"]');
    await expect(chips).toHaveCount(1);
    await expect(chips.first()).toContainText('of 86');

    // The roster row count matches the reported match count (#405 rule).
    const counts = await page.locator('[data-testid="gene-filter-counts"]').textContent();
    const matches = Number(/(\d+) of \d+ match/.exec(counts ?? '')?.[1]);
    await expect(rows).toHaveCount(matches);

    // A sortable matched/total column appears while the criterion is active.
    await expect(page.locator('[data-testid="roster"] thead')).toContainText('🧬 Toughness');
    await expect(page.locator('[data-testid="roster"] tbody')).toContainText(/\d+\/86/);
  });

  test('activating criteria forces and locks the species filter (§5c)', async ({ page }) => {
    await openMyPets(page);
    await addToughnessCriterion(page);
    for (const btn of await page.locator('[data-testid="filter-species"] button').all()) {
      await expect(btn).toBeDisabled();
    }
    await expect(page.locator('[data-testid="filter-species"] [data-species="horse"]')).toHaveClass(/active/);

    // Clearing the criteria unlocks it again.
    await page.locator('[data-testid="gene-filter-clear"]').click();
    await expect(page.locator('[data-testid="filter-species"] [data-species="horse"]')).toBeEnabled();
  });

  test('removing the chip re-widens the roster', async ({ page }) => {
    await openMyPets(page);
    await page.locator('[data-testid="filter-species"] [data-species="horse"]').click();
    const rows = page.locator('[data-testid="roster"] tbody tr[data-pet-id]');
    const before = await rows.count();

    await addToughnessCriterion(page);
    await page.locator('[data-testid="gene-chip-editor"]').isHidden();
    // Force a threshold nothing satisfies so the filter demonstrably narrows.
    await page.locator('[data-testid="gene-chip-edit"]').click();
    await page.locator('[data-testid="gene-chip-threshold"]').fill('86');
    await expect(rows).toHaveCount(0);

    await page.locator('[data-testid="gene-chip-remove"]').click();
    await expect(rows).toHaveCount(before);
  });

  test('a chromosome group filters by one row — Chr 01 (§5e)', async ({ page }) => {
    await openMyPets(page);
    await page.locator('[data-testid="filter-species"] [data-species="horse"]').click();
    await page.locator('[data-testid="gene-filter-toggle"]').click();
    await page.locator('[data-testid="gene-filter-group"]').selectOption('Chr 01');
    await page.locator('[data-testid="gene-filter-add"]').click();
    // The full dual-effect, breed-generic first row: 24 loci.
    const chip = page.locator('[data-testid="gene-chip-group"]');
    await expect(chip).toContainText('Chr 01');
    await expect(chip).toContainText('of 24');
    await expect(page.locator('[data-testid="roster"] thead')).toContainText('🧬 Chr 01');
    await expect(page.locator('[data-testid="roster"] tbody')).toContainText(/\d+\/24/);
  });

  test('saved filters: save, clear, load restores the campaign (§6)', async ({ page }) => {
    await openMyPets(page);
    await page.locator('[data-testid="filter-species"] [data-species="horse"]').click();
    await page.locator('[data-testid="gene-filter-toggle"]').click();
    await page.locator('[data-testid="gene-filter-group"]').selectOption('Chr 01');
    await page.locator('[data-testid="gene-filter-add"]').click();
    await expect(page.locator('[data-testid="gene-chip-group"]')).toBeVisible();

    await page.locator('[data-testid="gene-filter-save-name"]').fill('Line A');
    await page.locator('[data-testid="gene-filter-save"]').click();
    await page.locator('[data-testid="gene-filter-clear"]').click();
    await expect(page.locator('[data-testid="gene-chip-group"]')).toHaveCount(0);

    await page.locator('[data-testid="gene-filter-saved-select"]').selectOption('Line A');
    await page.locator('[data-testid="gene-filter-load"]').click();
    const chip = page.locator('[data-testid="gene-chip-group"]');
    await expect(chip).toContainText('Chr 01');
    await expect(chip).toContainText('of 24');
    // Loading re-forces the species lock (§5c).
    await expect(page.locator('[data-testid="filter-species"] [data-species="horse"]')).toBeDisabled();
  });

  test('genome-map click adds a locus criterion (§5b)', async ({ page }) => {
    await openMyPets(page);
    await gotoDestination(page, 'Reference');
    const labels = await page.locator('#animalType option').allTextContents();
    const horse = labels.find((l) => l.toLowerCase().includes('horse'));
    await page.locator('#animalType').selectOption({ label: horse as string });
    await expect(page.getByTestId('genome-map-grid')).toBeVisible();
    await page.locator('.gene-cell[data-gene-id="01A1"]').click();
    await expect(page.locator('[data-testid="map-add-status"]')).toContainText('Added 01A1');

    await gotoDestination(page, 'My Pets');
    const chip = page.locator('[data-testid="gene-chip-locus"]');
    await expect(chip).toBeVisible();
    await expect(chip).toContainText('01A1');
    // Default is "carries the recessive": R and x pressed, D not.
    await expect(chip.locator('[data-state="R"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(chip.locator('[data-state="x"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(chip.locator('[data-state="D"]')).toHaveAttribute('aria-pressed', 'false');
  });
});
