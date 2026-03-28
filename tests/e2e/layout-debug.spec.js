import { test, expect } from '@playwright/test';

test('debug: capture pet visualization layout', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.goto('/');

  // Wait for app to load
  await page.waitForSelector('.top-bar');
  await page.waitForSelector('.pet-card');

  // Take screenshot of initial state
  await page.screenshot({ path: 'test-results/01-initial.png' });

  // Click first pet
  await page.locator('.pet-card').first().click();
  await page.waitForSelector('.pet-visualization', { timeout: 15000 });

  // Wait for gene grid to render
  await page.waitForTimeout(3000);
  await page.screenshot({ path: 'test-results/02-pet-selected.png' });

  // Check layout dimensions
  const dims = await page.evaluate(() => {
    const results = {};

    const detailPane = document.querySelector('.detail-pane') || document.querySelector('main');
    if (detailPane) {
      const r = detailPane.getBoundingClientRect();
      results.detailPane = { top: r.top, bottom: r.bottom, height: r.height, overflow: getComputedStyle(detailPane).overflow };
    }

    const petViz = document.querySelector('.pet-visualization');
    if (petViz) {
      const r = petViz.getBoundingClientRect();
      results.petVisualization = { top: r.top, bottom: r.bottom, height: r.height, overflow: getComputedStyle(petViz).overflow, scrollHeight: petViz.scrollHeight };
    }

    const detailContent = document.querySelector('.detail-content');
    if (detailContent) {
      const r = detailContent.getBoundingClientRect();
      results.detailContent = { top: r.top, bottom: r.bottom, height: r.height, overflow: getComputedStyle(detailContent).overflow, position: getComputedStyle(detailContent).position };
    }

    const vizContainer = document.querySelector('.visualizer-container');
    if (vizContainer) {
      const r = vizContainer.getBoundingClientRect();
      results.visualizerContainer = { top: r.top, bottom: r.bottom, height: r.height, overflow: getComputedStyle(vizContainer).overflow, scrollHeight: vizContainer.scrollHeight };
    }

    const geneViz = document.querySelector('.gene-visualizer');
    if (geneViz) {
      const r = geneViz.getBoundingClientRect();
      results.geneVisualizer = { top: r.top, bottom: r.bottom, height: r.height, overflow: getComputedStyle(geneViz).overflow, scrollHeight: geneViz.scrollHeight };
    }

    const geneSection = document.querySelector('.gene-section');
    if (geneSection) {
      const r = geneSection.getBoundingClientRect();
      results.geneSection = { top: r.top, bottom: r.bottom, height: r.height, overflow: getComputedStyle(geneSection).overflow };
    }

    const gridContainer = document.querySelector('.gene-grid-container');
    if (gridContainer) {
      const r = gridContainer.getBoundingClientRect();
      results.geneGridContainer = { top: r.top, bottom: r.bottom, height: r.height, overflow: getComputedStyle(gridContainer).overflow, scrollHeight: gridContainer.scrollHeight };
    }

    const legend = document.querySelector('.gene-legend');
    if (legend) {
      const r = legend.getBoundingClientRect();
      results.geneLegend = { top: r.top, bottom: r.bottom, height: r.height };
    }

    const header = document.querySelector('.detail-header');
    if (header) {
      const r = header.getBoundingClientRect();
      results.detailHeader = { top: r.top, bottom: r.bottom, height: r.height };
    }

    // Full parent chain from gene-grid-container to body
    results.parentChain = [];
    let el = document.querySelector('.gene-grid-container');
    while (el && el !== document.documentElement) {
      const style = getComputedStyle(el);
      results.parentChain.push({
        tag: el.tagName,
        class: (el.className || '').toString().split(' ').slice(0, 2).join(' '),
        height: Math.round(el.getBoundingClientRect().height),
        overflow: style.overflow,
        display: style.display,
        flexGrow: style.flexGrow,
        position: style.position,
      });
      el = el.parentElement;
    }

    results.viewportHeight = window.innerHeight;
    return results;
  });

  console.log('=== LAYOUT DEBUG ===');
  console.log(JSON.stringify(dims, null, 2));

  // Now click Stats button
  const statsBtn = page.locator('.view-btn').filter({ hasText: 'Stats' });
  if (await statsBtn.isVisible()) {
    await statsBtn.click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'test-results/03-stats-open.png' });

    const statsDrawer = await page.evaluate(() => {
      const drawer = document.querySelector('.stats-drawer');
      if (!drawer) return { exists: false };
      const r = drawer.getBoundingClientRect();
      return {
        exists: true,
        top: r.top,
        bottom: r.bottom,
        height: r.height,
        isInViewport: r.top < window.innerHeight && r.bottom > 0,
        viewportHeight: window.innerHeight,
      };
    });
    console.log('=== STATS DRAWER ===');
    console.log(JSON.stringify(statsDrawer, null, 2));
  }

  // The actual assertions
  expect(dims.viewportHeight).toBe(800);

  // Pet visualization should be constrained to viewport, not growing beyond it
  if (dims.petVisualization) {
    expect(dims.petVisualization.height).toBeLessThanOrEqual(800);
    expect(dims.petVisualization.bottom).toBeLessThanOrEqual(800);
  }
});
