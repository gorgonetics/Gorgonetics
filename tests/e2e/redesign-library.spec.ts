import { expect, type Page, test } from '@playwright/test';
import { waitForAppReady } from './helpers.js';

// The redesign Library + Workspace shell lives behind the ?redesign=1 flag.
async function openLibrary(page: Page) {
  await page.goto('/?redesign=1');
  await waitForAppReady(page);
  await page.locator('[data-testid="tab-library"]').click();
  await expect(page.locator('[data-testid="library"]')).toBeVisible();
}

test.describe('Redesign — Library + Workspace shell', () => {
  test('the My Pets destination appears only with the flag', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);
    await expect(page.locator('[data-testid="tab-library"]')).toHaveCount(0);

    await openLibrary(page);
    await expect(page.locator('[data-testid="tab-library"]')).toBeVisible();
  });

  test('shows the roster when nothing is selected, and a pet detail once selected', async ({ page }) => {
    await openLibrary(page);
    // Nothing selected → the full roster table fills the workspace.
    await expect(page.locator('[data-testid="workspace-roster"]')).toBeVisible();
    await expect(page.locator('[data-testid="roster"]')).toBeVisible();

    // Opening a pet from the roster shows its detail.
    await page.locator('[data-testid="roster-open"]').first().click();
    await expect(page.locator('.pet-visualization')).toBeVisible();
    // The pet detail renders gene cells (now square — the unified shape).
    await expect(page.locator('.pet-visualization .gene-cell').first()).toBeVisible();
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
    // The Compare diff renders gene cells (now square — the unified shape).
    await expect(page.locator('[data-testid="workspace-multi"] .gene-cell').first()).toBeVisible();

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
});
