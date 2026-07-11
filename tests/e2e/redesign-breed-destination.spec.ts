import { expect, type Page, test } from '@playwright/test';
import { waitForAppReady } from './helpers.js';

// The Breed destination — a first-class, search-first breeding helper reached
// from the top nav. Pick a species; it ranks pairs across the stabled pets of
// that species and opens the trio on inspect (no pre-selection needed).

async function openBreed(page: Page) {
  await page.goto('/');
  await waitForAppReady(page);
  await page.locator('[data-testid="tab-breed"]').click();
  await expect(page.locator('[data-testid="breed-view"]')).toBeVisible();
}

test.describe('Redesign — Breed destination', () => {
  test('is reachable from the top nav and ranks pairs by species', async ({ page }) => {
    await openBreed(page);
    await expect(page.locator('[data-testid="tab-breed"]')).toHaveClass(/active/);

    // Pick horses (the demo has a male + female) → a ranked pair table appears
    // without any pre-selection.
    await page.locator('[data-testid="breed-species"] [data-species="horse"]').click();
    await expect(page.locator('[data-testid="breeding-pair-table"]')).toBeVisible();
    await expect(page.locator('[data-testid="breeding-pair-table"] tbody tr').first()).toBeVisible();
  });

  test('inspecting a pair opens the offspring trio', async ({ page }) => {
    // The trio grid (~2304 cells) is heavy; allow extra time under CPU contention.
    test.slow();
    await openBreed(page);
    await page.locator('[data-testid="breed-species"] [data-species="horse"]').click();
    await expect(page.locator('[data-testid="breeding-pair-table"]')).toBeVisible();

    await page.locator('[data-testid="inspect-pair"]').first().click();
    const trio = page.getByTestId('trio-view');
    await expect(trio).toBeVisible();
    // Unified with the single-pet / Compare lenses: an in-tab full-view overlay
    // with a back button — not the old modal popup (no backdrop).
    await expect(trio).toHaveClass(/detail-overlay/);
    await expect(trio.locator('.modal-backdrop')).toHaveCount(0);
    await expect(trio.getByTestId('trio-view-back')).toBeVisible();
    // The covered pair table is made inert so focus / AT can't reach controls
    // hidden behind the overlay.
    await expect(page.getByTestId('breed-view')).toHaveAttribute('inert', '');
    // Wait out the heavy grid render (~2304 cells; slow under CPU contention).
    await expect(trio.locator('.role-label').first()).toBeVisible({ timeout: 30000 });
    await expect(trio.getByText('Offspring', { exact: false }).first()).toBeVisible();

    // Escape backs out (focus lands inside the overlay on open), returning to
    // the still-mounted pair table — the keyboard affordance the old modal had.
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('trio-view')).toHaveCount(0);
    // Backed out to the breed destination; the covered table is interactive again.
    await expect(page.getByTestId('breed-view')).toBeVisible();
    await expect(page.getByTestId('breed-view')).not.toHaveAttribute('inert', '');
  });

  test('clicking a parent name opens that pet in My Pets', async ({ page }) => {
    await openBreed(page);
    await page.locator('[data-testid="breed-species"] [data-species="horse"]').click();
    await expect(page.locator('[data-testid="breeding-pair-table"]')).toBeVisible();

    await page.locator('[data-testid="breeding-pair-table"] .parent-link').first().click();

    // Jumps to My Pets with that pet's detail open.
    await expect(page.locator('[data-testid="tab-mypets"]')).toHaveClass(/active/);
    await expect(page.locator('[data-testid="pet-detail"]')).toBeVisible();
    await expect(page.locator('.pet-visualization')).toBeVisible();

    // Returning to Breed keeps the chosen species — the excursion must not
    // reset the destination to its default (#399).
    await page.locator('[data-testid="tab-breed"]').click();
    await expect(page.locator('[data-testid="breed-view"]')).toBeVisible();
    await expect(page.locator('[data-testid="breed-species"] [data-species="horse"]')).toHaveClass(/active/);
    await expect(page.locator('[data-testid="breeding-pair-table"]')).toBeVisible();
  });

  test('a sparse pair table hugs its rows instead of framing empty space', async ({ page }) => {
    // The demo stable ranks a single horse pair; the bordered wrapper must
    // size to the table rather than stretching to the full body height (#401).
    await openBreed(page);
    await page.locator('[data-testid="breed-species"] [data-species="horse"]').click();
    const wrapper = page.locator('[data-testid="breeding-pair-table"]');
    await expect(wrapper).toBeVisible();
    await expect(wrapper.locator('tbody tr').first()).toBeVisible();

    const wrapperBox = await wrapper.boundingBox();
    const tableBox = await wrapper.locator('table').boundingBox();
    expect(wrapperBox).not.toBeNull();
    expect(tableBox).not.toBeNull();
    if (!wrapperBox || !tableBox) return;
    // Allowance: 2px of border + a horizontal scrollbar gutter (the table is
    // wide) on platforms with classic scrollbars.
    expect(wrapperBox.height).toBeLessThanOrEqual(tableBox.height + 20);
  });

  test('offspring breed can be chosen and re-ranks the pairs (horses)', async ({ page }) => {
    await openBreed(page);
    await page.locator('[data-testid="breed-species"] [data-species="horse"]').click();
    await expect(page.locator('[data-testid="breeding-pair-table"]')).toBeVisible();

    // Horses expose an offspring-breed control that shapes the ranking.
    const offspring = page.getByTestId('breed-offspring');
    await expect(offspring).toBeVisible();

    const trigger = offspring.getByTestId('breed-selector-trigger');
    await trigger.click();
    const pop = offspring.getByTestId('breed-selector-pop');
    await expect(pop).toBeVisible();

    const opt = pop.locator('.bs-opt[data-breed]:not([data-breed=""])').first();
    const chosen = await opt.getAttribute('data-breed');
    await opt.click();

    await expect(pop).toHaveCount(0);
    await expect(trigger.locator('.bs-value')).toHaveText(chosen ?? '');
    // Re-ranks under the chosen breed without emptying the table.
    await expect(page.locator('[data-testid="breeding-pair-table"] tbody tr').first()).toBeVisible();
  });

  test('trio can hide locked-in loci to show new gains only', async ({ page }) => {
    test.slow();
    await openBreed(page);
    await page.locator('[data-testid="breed-species"] [data-species="horse"]').click();
    await expect(page.locator('[data-testid="breeding-pair-table"]')).toBeVisible();
    await page.locator('[data-testid="inspect-pair"]').first().click();

    const trio = page.getByTestId('trio-view');
    await expect(trio).toBeVisible();
    // Wait for the heavy grid (~2304 cells) to fully render before interacting,
    // so a click doesn't race the summary re-rendering as the grid settles.
    await expect(trio.locator('.role-label').first()).toBeVisible({ timeout: 30000 });
    await expect(trio.locator('.outcome-box').first()).toBeVisible();

    const toggle = trio.getByTestId('trio-hide-locked');
    // The toggle only exists when the pair has locked loci to hide.
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect(toggle).not.toContainText('hidden');

    // force: the toggle is pinned and clickable, but the heavy grid reflowing
    // underneath can keep Playwright's stability check from settling under CI
    // CPU load. The assertions below confirm the click actually applied.
    await toggle.click({ force: true });
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(toggle).toContainText('hidden');
    await expect(trio.locator('.trio-grid-container.hide-locked')).toBeVisible();
  });

  test('benching an animal drops its pairs, and Return all restores them', async ({ page }) => {
    await openBreed(page);
    await page.locator('[data-testid="breed-species"] [data-species="horse"]').click();
    await expect(page.locator('[data-testid="breeding-pair-table"]')).toBeVisible();

    // Expand the pool (collapsed by default) and bench the one stabled male —
    // the demo has a single M × F horse pair, so this empties the ranking.
    const pool = page.getByTestId('breeding-pool');
    await pool.locator('.pool-toggle').click();
    const chips = pool.getByTestId('pool-chip');
    await expect(chips).toHaveCount(2);
    await chips.first().click();

    await expect(page.getByTestId('breeding-pair-table')).toHaveCount(0);
    await expect(page.getByTestId('empty-state')).toBeVisible();

    // Return all brings the pool — and the ranking — back.
    await pool.getByTestId('pool-return-all').click();
    await expect(page.getByTestId('breeding-pair-table')).toBeVisible();
  });

  test('setting breeding spots groups the ranking into suggested plans', async ({ page }) => {
    await openBreed(page);
    await page.locator('[data-testid="breed-species"] [data-species="horse"]').click();
    await expect(page.locator('[data-testid="breeding-pair-table"]')).toBeVisible();
    // Flat ranking has no option groups.
    await expect(page.getByTestId('plan-option')).toHaveCount(0);

    const controls = page.getByTestId('breed-plan-controls');
    await expect(controls.getByTestId('spots-value')).toHaveText('Off');
    await controls.getByRole('button', { name: 'More breeding spots' }).click();
    await expect(controls.getByTestId('spots-value')).toHaveText('1');

    // Same table, now split into ranked colour-coded option groups; #1 is best.
    await expect(page.getByTestId('breeding-pair-table')).toBeVisible();
    await expect(page.getByTestId('plan-option').first()).toBeVisible();
    await expect(page.getByTestId('plan-option').first()).toContainText('best');

    // Turning planning off returns the flat ranking.
    await controls.getByRole('button', { name: 'Fewer breeding spots' }).click();
    await expect(page.getByTestId('plan-option')).toHaveCount(0);
    await expect(page.getByTestId('breeding-pair-table')).toBeVisible();
  });

  test('the offspring-breed control is horse-only', async ({ page }) => {
    await openBreed(page);
    await page.locator('[data-testid="breed-species"] [data-species="horse"]').click();
    await expect(page.getByTestId('breed-offspring')).toBeVisible();

    // Species without breeds (beewasp) don't expose the control.
    await page.locator('[data-testid="breed-species"] [data-species="beewasp"]').click();
    await expect(page.getByTestId('breed-offspring')).toHaveCount(0);
  });
});
