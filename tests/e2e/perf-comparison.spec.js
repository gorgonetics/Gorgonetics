import { expect, test } from '@playwright/test';
import { waitForPets } from './helpers.js';

test.describe('Performance: GenomeGridDiff vs GeneVisualizer', () => {
  test('measure attribute filter click time in comparison grid', async ({ page }) => {
    await page.goto('/');
    await waitForPets(page);

    // Navigate to compare tab and select two horses
    await page.locator('.tab-btn').filter({ hasText: 'Compare' }).click();

    // Pick the first pet (should be a horse or bee)
    await page.locator('.picker-pet-card').first().click();
    await page.waitForTimeout(500);

    // Check if we have a second pet available — if species filter hides it, clear and try
    const pickerCards = await page.locator('.picker-pet-card').count();
    if (pickerCards === 0) {
      // Only 1 pet of this species — clear and pick the other
      await page.locator('.slot-clear').first().click();
      // Can't compare with demo data (1 bee, 1 horse) — skip
      test.skip();
      return;
    }

    await page.locator('.picker-pet-card').first().click();
    await page.waitForTimeout(500);

    // Switch to Genome Diff tab
    await page.locator('.view-tab').filter({ hasText: 'Genome Diff' }).click();
    await page.waitForTimeout(1000);

    // Collect console logs
    const logs = [];
    page.on('console', (msg) => {
      if (msg.text().includes('[GenomeGridDiff]')) {
        logs.push(msg.text());
      }
    });

    // Check if attribute filter buttons exist
    const attrBtns = page.locator('.attr-filter-btn');
    const btnCount = await attrBtns.count();
    console.log(`Found ${btnCount} attribute filter buttons`);

    if (btnCount < 2) {
      test.skip();
      return;
    }

    // Measure: click an attribute filter and time until paint
    const timings = [];

    for (let clickNum = 0; clickNum < 3; clickNum++) {
      // Click the second attribute button (first is "All")
      const btnIndex = (clickNum % (btnCount - 1)) + 1;

      const startTime = Date.now();

      await page.evaluate(() => {
        window.__perfStart = performance.now();
      });

      await attrBtns.nth(btnIndex).click();

      // Wait for any visual update
      await page.waitForTimeout(50);

      const elapsed = await page.evaluate(() => {
        return performance.now() - window.__perfStart;
      });

      timings.push(elapsed);
      console.log(`Click ${clickNum + 1}: attribute filter took ${elapsed.toFixed(1)}ms (wall clock)`);

      // Reset
      await attrBtns.first().click();
      await page.waitForTimeout(50);
    }

    // Print console logs from the component
    console.log('\nComponent logs:');
    for (const log of logs) {
      console.log(`  ${log}`);
    }

    console.log(`\nAverage click time: ${(timings.reduce((a, b) => a + b, 0) / timings.length).toFixed(1)}ms`);

    // Count total DOM elements in the grid
    const domCount = await page.evaluate(() => {
      const grid = document.querySelector('.grid-container');
      return grid ? grid.querySelectorAll('*').length : 0;
    });
    console.log(`Total DOM elements in grid: ${domCount}`);

    const geneCellCount = await page.evaluate(() => {
      return document.querySelectorAll('.gene-cell').length;
    });
    console.log(`Total gene cells: ${geneCellCount}`);
  });

  test('measure attribute filter in regular GeneVisualizer for comparison', async ({ page }) => {
    await page.goto('/');
    await waitForPets(page);

    // Click first pet to open visualization
    await page.locator('.pet-card').first().click();
    await page.waitForTimeout(1000);

    // Open stats drawer
    const statsBtn = page.locator('.view-btn').filter({ hasText: 'Stats' });
    if ((await statsBtn.count()) > 0) {
      await statsBtn.click();
      await page.waitForTimeout(500);
    }

    // Count gene cells
    const geneCellCount = await page.evaluate(() => {
      return document.querySelectorAll('.gene-cell').length;
    });
    console.log(`Regular GeneVisualizer gene cells: ${geneCellCount}`);

    const domCount = await page.evaluate(() => {
      const grid = document.querySelector('.gene-grid-container');
      return grid ? grid.querySelectorAll('*').length : 0;
    });
    console.log(`Regular GeneVisualizer DOM elements in grid: ${domCount}`);

    // Click an attribute row in the stats table to filter
    const attrRows = page.locator('.attribute-row');
    const rowCount = await attrRows.count();
    console.log(`Stats table attribute rows: ${rowCount}`);

    if (rowCount < 2) {
      test.skip();
      return;
    }

    const timings = [];
    for (let clickNum = 0; clickNum < 3; clickNum++) {
      const rowIndex = clickNum % rowCount;

      await page.evaluate(() => {
        window.__perfStart = performance.now();
      });

      await attrRows.nth(rowIndex).click();

      await page.waitForTimeout(50);

      const elapsed = await page.evaluate(() => {
        return performance.now() - window.__perfStart;
      });

      timings.push(elapsed);
      console.log(`Click ${clickNum + 1}: GeneVisualizer filter took ${elapsed.toFixed(1)}ms`);

      // Click same row again to deselect
      await attrRows.nth(rowIndex).click();
      await page.waitForTimeout(50);
    }

    console.log(
      `\nRegular GeneVisualizer average: ${(timings.reduce((a, b) => a + b, 0) / timings.length).toFixed(1)}ms`,
    );
  });
});
