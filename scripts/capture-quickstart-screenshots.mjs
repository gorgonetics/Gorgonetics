#!/usr/bin/env node
/**
 * Captures all quickstart guide screenshots from the running app.
 * Run with: node scripts/capture-quickstart-screenshots.mjs
 *
 * Prerequisites:
 *   - Dev server running at http://localhost:5174 (pnpm dev)
 *   - Playwright installed (@playwright/test)
 *
 * Outputs PNGs to docs/images/quickstart/ matching the filenames
 * referenced in docs/quickstart.html.
 */

import { chromium } from '@playwright/test';

const BASE_URL = 'http://localhost:5174';
const OUT = 'docs/images/quickstart';
const VIEWPORT = { width: 1280, height: 800 };

// --- Helpers ---

/** Wait for a selector to be visible (replaces arbitrary sleep). */
async function waitFor(page, selector) {
  await page.locator(selector).first().waitFor({ state: 'visible', timeout: 10000 });
}

async function addOverlay(page) {
  await page.evaluate(() => {
    const el = document.createElement('div');
    el.id = 'qs-overlay';
    el.style.cssText =
      'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:9998;pointer-events:none;';
    document.body.appendChild(el);
  });
}

async function removeOverlay(page) {
  await page.evaluate(() => document.getElementById('qs-overlay')?.remove());
}

async function highlight(page, selector, { padding = '' } = {}) {
  await page.evaluate(
    ({ sel, pad }) => {
      const el = document.querySelector(sel);
      if (!el) return;
      el.style.position = 'relative';
      el.style.zIndex = '9999';
      el.style.boxShadow = '0 0 0 3px #3b82f6, 0 0 20px rgba(59,130,246,0.5)';
      el.style.borderRadius = '6px';
      if (pad) el.style.padding = pad;
      el.id = 'qs-highlighted';
    },
    { sel: selector, pad: padding },
  );
}

async function clearHighlight(page) {
  await page.evaluate(() => {
    const el = document.getElementById('qs-highlighted');
    if (el) {
      el.style.position = '';
      el.style.zIndex = '';
      el.style.boxShadow = '';
      el.style.borderRadius = '';
      el.style.padding = '';
      el.removeAttribute('id');
    }
  });
}

async function shot(page, name) {
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${OUT}/${name}`, type: 'png' });
  console.log(`  ✓ ${name}`);
}

// --- Main ---

console.log('Capturing quickstart screenshots...\n');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: VIEWPORT });
await page.goto(BASE_URL);
await page.waitForSelector('.pet-card');

// 01 — First launch (empty state, no pet selected)
await shot(page, '01-first-launch.png');

// 02 — Pet list sidebar highlighted
await addOverlay(page);
await highlight(page, '[role="complementary"]');
await shot(page, '02-pet-list-highlight.png');
await clearHighlight(page);
await removeOverlay(page);

// 03 — Pet card hover (edit/delete visible)
const firstCard = page.locator('.pet-card-wrapper').first();
await firstCard.hover();
await page.waitForTimeout(200);
await addOverlay(page);
await page.evaluate(() => {
  const card = document.querySelector('.pet-card-wrapper');
  if (card) {
    card.style.position = 'relative';
    card.style.zIndex = '9999';
    card.style.boxShadow = '0 0 0 3px #3b82f6, 0 0 20px rgba(59,130,246,0.5)';
    card.style.borderRadius = '8px';
    card.id = 'qs-highlighted';
  }
});
await shot(page, '03-pet-card-hover.png');
await clearHighlight(page);
await removeOverlay(page);

// 04 — Upload button highlighted
await addOverlay(page);
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find((b) =>
    b.textContent.includes('Upload Genome'),
  );
  if (btn) {
    btn.style.position = 'relative';
    btn.style.zIndex = '9999';
    btn.style.boxShadow = '0 0 0 3px #3b82f6, 0 0 20px rgba(59,130,246,0.5)';
    btn.id = 'qs-highlighted';
  }
});
await shot(page, '04-upload-highlight.png');
await clearHighlight(page);
await removeOverlay(page);

// 05 — BeeWasp gene grid (click bee pet)
await page.locator('button', { hasText: 'Sample Fae Bee' }).first().click();
await waitFor(page, ".gene-visualizer, .gallery");
await shot(page, '05-gene-grid.png');

// 06 — Gene tooltip on hover
const positiveCells = page.locator('.gene-cell.gene-positive');
const cellCount = await positiveCells.count();
for (let i = 0; i < cellCount; i++) {
  const box = await positiveCells.nth(i).boundingBox();
  if (box && box.x > 350 && box.x < 800 && box.y > 200 && box.y < 400) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await waitFor(page, ".gene-visualizer, .gallery");
    break;
  }
}
await addOverlay(page);
await page.evaluate(() => {
  const tooltip = document.querySelector('[class*="tooltip"]');
  if (tooltip) {
    tooltip.style.zIndex = '9999';
    tooltip.style.boxShadow = '0 0 0 3px #3b82f6, 0 0 20px rgba(59,130,246,0.5)';
    tooltip.style.borderRadius = '8px';
  }
  const grid = document.querySelector('.gene-grid-container');
  if (grid) {
    grid.style.position = 'relative';
    grid.style.zIndex = '9999';
  }
});
await shot(page, '06-gene-tooltip.png');
await page.evaluate(() => {
  const tooltip = document.querySelector('[class*="tooltip"]');
  if (tooltip) {
    tooltip.style.zIndex = '';
    tooltip.style.boxShadow = '';
    tooltip.style.borderRadius = '';
  }
  const grid = document.querySelector('.gene-grid-container');
  if (grid) {
    grid.style.position = '';
    grid.style.zIndex = '';
  }
});
await removeOverlay(page);

// Move mouse away to dismiss tooltip
await page.mouse.move(0, 0);
await page.waitForTimeout(200);

// 07 — View toggle buttons highlighted
await addOverlay(page);
await page.evaluate(() => {
  const btns = [...document.querySelectorAll('button')];
  const toggleBtns = btns.filter((b) =>
    ['Attributes', 'Appearance', 'Stats'].includes(b.textContent.trim()),
  );
  const parent = toggleBtns[0]?.parentElement;
  if (parent) {
    parent.style.position = 'relative';
    parent.style.zIndex = '9999';
    parent.style.boxShadow = '0 0 0 3px #3b82f6, 0 0 20px rgba(59,130,246,0.5)';
    parent.style.borderRadius = '8px';
    parent.id = 'qs-highlighted';
  }
});
await shot(page, '07-view-toggle-highlight.png');
await clearHighlight(page);
await removeOverlay(page);

// 08 — Appearance view
await page.locator('button', { hasText: 'Appearance' }).click();
await waitFor(page, ".gene-visualizer, .gallery, .gene-editing-view, select");
// Also open stats to show the appearance stats
await page.locator('button', { hasText: 'Stats' }).click();
await page.waitForTimeout(200);
await shot(page, '08-appearance-view.png');

// 09 — Stats panel highlighted (switch back to Attributes first)
await page.locator('button', { hasText: 'Attributes' }).click();
await page.waitForTimeout(200);
await addOverlay(page);
await page.evaluate(() => {
  const tables = document.querySelectorAll('table');
  if (tables.length > 0) {
    let container = tables[0].parentElement;
    while (container && container.getBoundingClientRect().width < 300) {
      container = container.parentElement;
    }
    if (container) {
      container.style.position = 'relative';
      container.style.zIndex = '9999';
      container.style.boxShadow =
        '0 0 0 3px #3b82f6, 0 0 20px rgba(59,130,246,0.5)';
      container.style.borderRadius = '8px';
      container.id = 'qs-highlighted';
    }
  }
});
await shot(page, '09-stats-panel.png');
await clearHighlight(page);
await removeOverlay(page);

// 10 — Attribute filtered (click Intelligence)
await page.locator('tr.attribute-row', { hasText: 'Intelligence' }).click();
await waitFor(page, ".gene-visualizer, .gallery, .gene-editing-view, select");
await addOverlay(page);
await page.evaluate(() => {
  // Lift stats and grid above overlay
  for (const sel of ['.stats-section', '.stats-drawer-body']) {
    const el = document.querySelector(sel);
    if (el) {
      el.style.position = 'relative';
      el.style.zIndex = '9999';
    }
  }
  const grid = document.querySelector('.gene-section, .gene-visualizer');
  if (grid) {
    grid.style.position = 'relative';
    grid.style.zIndex = '9999';
  }
  // Highlight selected row
  for (const row of document.querySelectorAll('tr.attribute-row')) {
    if (row.textContent.includes('Intelligence')) {
      row.style.boxShadow = '0 0 0 3px #3b82f6, 0 0 15px rgba(59,130,246,0.5)';
      row.style.borderRadius = '6px';
      row.id = 'qs-highlighted';
    }
  }
});
await shot(page, '10-attribute-filtered.png');
await clearHighlight(page);
await page.evaluate(() => {
  for (const sel of ['.stats-section', '.stats-drawer-body', '.gene-section', '.gene-visualizer']) {
    const el = document.querySelector(sel);
    if (el) {
      el.style.position = '';
      el.style.zIndex = '';
    }
  }
});
await removeOverlay(page);

// Deselect Intelligence filter
await page.locator('tr.attribute-row', { hasText: 'Intelligence' }).click();
await page.waitForTimeout(200);

// 11 — Horse auto-breed filter (select horse pet)
await page.locator('button', { hasText: 'Sample Horse' }).click();
await waitFor(page, ".gene-visualizer");
await addOverlay(page);
await highlight(page, '.breed-filter', { padding: '4px' });
await shot(page, '11-auto-breed-active.png');
await clearHighlight(page);
await removeOverlay(page);

// 12 — Genes tab with sidebar highlighted
await page.locator('.tab-btn', { hasText: 'Genes' }).click();
await waitFor(page, "#animalType");
await addOverlay(page);
await highlight(page, '[role="complementary"]');
await shot(page, '12-genes-tab.png');
await clearHighlight(page);
await removeOverlay(page);

// 13 — Gene editing view
await page.locator('select').first().selectOption('beewasp');
await page.waitForTimeout(200);
await page.locator('select').nth(1).selectOption({ index: 1 });
await page.waitForTimeout(200);
await page.locator('button', { hasText: 'Edit Genes' }).click();
await waitFor(page, '.gene-editing-view');
await shot(page, '13-gene-editing.png');

// 14 — Data menu dropdown
await page.locator('.tab-btn', { hasText: 'Pets' }).click();
await page.waitForTimeout(200);
await page.getByTitle('Data management').click();
await page.waitForTimeout(200);
await addOverlay(page);
await page.evaluate(() => {
  const dropdown = document.querySelector('.dropdown');
  if (dropdown) {
    dropdown.style.zIndex = '9999';
    dropdown.style.boxShadow = '0 0 0 3px #3b82f6, 0 0 20px rgba(59,130,246,0.5)';
    dropdown.id = 'qs-highlighted';
  }
  const toggle = document.querySelector('.menu-toggle');
  if (toggle) {
    toggle.style.position = 'relative';
    toggle.style.zIndex = '9999';
  }
});
await shot(page, '14-data-menu.png');
await clearHighlight(page);
await page.evaluate(() => {
  const toggle = document.querySelector('.menu-toggle');
  if (toggle) {
    toggle.style.position = '';
    toggle.style.zIndex = '';
  }
});
await removeOverlay(page);
// Close dropdown
await page.locator('.top-bar-left').click();
await page.waitForTimeout(200);

// 15 — Gallery empty state
await page.locator('.tab-btn', { hasText: 'Pets' }).click();
await page.waitForTimeout(200);
await page.locator('button', { hasText: 'Sample Fae Bee' }).first().click();
await waitFor(page, ".gene-visualizer, .gallery");
await page.locator('.view-btn', { hasText: 'Gallery' }).click();
await waitFor(page, ".gene-visualizer, .gallery, .gene-editing-view, select");
await shot(page, '15-gallery.png');

// 16 — Export dialog
await page.locator('.view-btn', { hasText: 'Gallery' }).click(); // toggle off
await page.waitForTimeout(200);
await page.getByTitle('Data management').click();
await page.waitForTimeout(200);
await page.getByText('Export Backup').click();
await page.waitForTimeout(200);
await shot(page, '16-export-dialog.png');

// Close export dialog
await page.getByText('Cancel').click();
await page.waitForTimeout(200);

// 17 — Settings modal
await page.getByTitle('Settings').click();
await page.waitForTimeout(200);
await shot(page, '17-settings-modal.png');

// 18 — Settings with dark mode toggle (switch to dark)
await page.locator('.theme-btn', { hasText: 'Dark' }).click();
await page.waitForTimeout(300);
await shot(page, '18-settings-dark-mode.png');

// Close settings modal
await page.keyboard.press('Escape');
await page.waitForTimeout(200);

// 19 — App in dark mode (pet list)
await shot(page, '19-dark-mode-overview.png');

// 20 — Dark mode gene grid
await page.locator('button', { hasText: 'Sample Fae Bee' }).first().click();
await waitFor(page, '.gene-visualizer, .gallery');
await shot(page, '20-dark-mode-gene-grid.png');

// 21 — Pet tags: switch back to light mode, add tags, then screenshot
await page.locator('.settings-toggle').click();
await page.waitForTimeout(200);
await page.locator('.theme-btn', { hasText: 'Light' }).click();
await page.waitForTimeout(200);
await page.keyboard.press('Escape');
await page.waitForTimeout(200);

// Add tags to the first pet via the editor
await page.locator('.pet-card-wrapper').first().hover();
await page.waitForTimeout(200);
await page.locator('.edit-btn').first().click();
await waitFor(page, '.modal-panel');

// Type tags into the tag input
const tagInput = page.locator('.tag-text-input');
await tagInput.fill('breeder');
await tagInput.press('Enter');
await page.waitForTimeout(100);
await tagInput.fill('keeper');
await tagInput.press('Enter');
await page.waitForTimeout(100);

// Scroll tags section into view and screenshot
await page.evaluate(() => {
  const tagsSection = [...document.querySelectorAll('h3')].find(h => h.textContent.includes('Tags'));
  if (tagsSection) tagsSection.scrollIntoView({ block: 'center' });
});
await addOverlay(page);
await page.evaluate(() => {
  const panel = document.querySelector('.modal-panel');
  if (panel) {
    panel.style.position = 'relative';
    panel.style.zIndex = '9999';
  }
});
await shot(page, '21-pet-tags-editor.png');
await page.evaluate(() => {
  const panel = document.querySelector('.modal-panel');
  if (panel) { panel.style.position = ''; panel.style.zIndex = ''; }
});
await removeOverlay(page);

// Save the tags
await page.getByText('Save Changes').click();
await page.waitForTimeout(300);

// Add a different tag to the second pet
await page.locator('.pet-card-wrapper').nth(1).hover();
await page.waitForTimeout(200);
await page.locator('.edit-btn').nth(1).click();
await waitFor(page, '.modal-panel');
const tagInput2 = page.locator('.tag-text-input');
await tagInput2.fill('for sale');
await tagInput2.press('Enter');
await page.waitForTimeout(100);
await tagInput2.fill('breeder');
await tagInput2.press('Enter');
await page.waitForTimeout(100);
await page.getByText('Save Changes').click();
await page.waitForTimeout(300);

// 22 — Tag filter buttons in pet list
await addOverlay(page);
await highlight(page, '.tag-filter');
await shot(page, '22-pet-tag-filters.png');
await clearHighlight(page);
await removeOverlay(page);

// ===== Homepage screenshots (docs/images/) =====
const HOME_OUT = 'docs/images';

// screenshot-gene-grid — BeeWasp gene grid with stats open
await page.locator('button', { hasText: 'Sample Fae Bee' }).first().click();
await waitFor(page, ".gene-visualizer, .gallery");
await page.locator('button', { hasText: 'Stats' }).click();
await page.waitForTimeout(200);
await page.screenshot({ path: `${HOME_OUT}/screenshot-gene-grid.png`, type: 'png' });
console.log(`  ✓ screenshot-gene-grid.png (homepage)`);

// screenshot-stats — Stats panel (Attributes view, stats open)
await page.locator('button', { hasText: 'Attributes' }).click();
await page.waitForTimeout(200);
await page.screenshot({ path: `${HOME_OUT}/screenshot-stats.png`, type: 'png' });
console.log(`  ✓ screenshot-stats.png (homepage)`);

// Close stats
await page.locator('button', { hasText: 'Stats' }).click();
await page.waitForTimeout(200);

// screenshot-gene-editor — Gene editing table
await page.locator('.tab-btn', { hasText: 'Genes' }).click();
await waitFor(page, '#animalType');
await page.locator('select').first().selectOption('beewasp');
await page.waitForTimeout(200);
await page.locator('select').nth(1).selectOption({ index: 1 });
await page.waitForTimeout(200);
await page.locator('button', { hasText: 'Edit Genes' }).click();
await waitFor(page, '.gene-editing-view');
await page.screenshot({ path: `${HOME_OUT}/screenshot-gene-editor.png`, type: 'png' });
console.log(`  ✓ screenshot-gene-editor.png (homepage)`);

await browser.close();
console.log(`\nAll screenshots saved to ${OUT}/ and ${HOME_OUT}/`);
