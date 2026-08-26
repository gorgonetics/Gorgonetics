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
 * referenced in docs/quickstart.html, plus a handful of homepage
 * screenshots in docs/images/ referenced by docs/index.html.
 *
 * Selectors were verified against the live redesigned UI (no ?redesign
 * flag needed — the new My Pets / Breed / Community / Reference IA is
 * the default). Prefer data-testid, aria-label, and exact text over
 * brittle class names wherever the app exposes one.
 *
 * The three bundled demo pets are too few to photograph the app honestly:
 * rarity, genetic quality and culling are all measured against a
 * population, and each one suppresses itself below a floor the demo set
 * cannot reach. So after the first-launch shot this script loads a real
 * horse stable from scripts/fixtures/stable/ and captures everything else
 * against that. See seedStable() for how.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const BASE_URL = 'http://localhost:5174';
const OUT = 'docs/images/quickstart';
const HOME_OUT = 'docs/images';
const FIXTURES = 'scripts/fixtures/stable';
const VIEWPORT = { width: 1280, height: 800 };
const HIGHLIGHT_SHADOW = '0 0 0 3px #3b82f6, 0 0 20px rgba(59,130,246,0.5)';

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

/** Highlight the first element matching a CSS selector. */
async function highlight(page, selector, { padding = '' } = {}) {
  await page.evaluate(
    ({ sel, pad, shadow }) => {
      const el = document.querySelector(sel);
      if (!el) return;
      el.style.position = 'relative';
      el.style.zIndex = '9999';
      el.style.boxShadow = shadow;
      el.style.borderRadius = '6px';
      if (pad) el.style.padding = pad;
      el.id = 'qs-highlighted';
    },
    { sel: selector, pad: padding, shadow: HIGHLIGHT_SHADOW },
  );
}

/**
 * Highlight an element located via an arbitrary DOM traversal, for cases
 * where no single stable CSS selector identifies the target (e.g. "the
 * parent of this button", "the row whose text includes this name").
 * `finderBody` is the body of a zero-arg function returning the element.
 */
async function highlightNode(page, finderBody) {
  await page.evaluate(
    ({ body, shadow }) => {
      // eslint-disable-next-line no-new-func
      const finder = new Function(body);
      const el = finder();
      if (!el) return;
      el.style.position = 'relative';
      el.style.zIndex = '9999';
      el.style.boxShadow = shadow;
      el.style.borderRadius = '6px';
      el.id = 'qs-highlighted';
    },
    { body: finderBody, shadow: HIGHLIGHT_SHADOW },
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

async function shot(page, name, { dir = OUT } = {}) {
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${dir}/${name}`, type: 'png' });
  console.log(`  ✓ ${name}`);
}

/**
 * Load the fixture stable into the running app.
 *
 * Goes through the app's own drag-and-drop import rather than writing to the
 * database: the "+ Upload Genome" button opens a native Tauri dialog and does
 * nothing in a browser, but the drop handler reads `dataTransfer.files`
 * directly, so a synthesised DataTransfer is the one import path that works
 * here. Everything else follows from the genome text — the file's Entity name
 * becomes the pet name, and the structured-name parser fills in breed, gender
 * and attributes from it — and pets land stabled, which is what the
 * population-gated features need.
 */
async function seedStable(page) {
  const files = readdirSync(FIXTURES)
    .filter((f) => f.endsWith('.txt'))
    .map((f) => ({ name: f, content: readFileSync(`${FIXTURES}/${f}`, 'utf-8') }));
  if (files.length === 0) throw new Error(`No genome fixtures in ${FIXTURES}`);

  const before = await page.locator('[data-testid="roster"] tbody tr').count();
  const dataTransfer = await page.evaluateHandle((items) => {
    const dt = new DataTransfer();
    for (const item of items) dt.items.add(new File([item.content], item.name, { type: 'text/plain' }));
    return dt;
  }, files);
  await page.dispatchEvent('[data-testid="mypets-table"]', 'drop', { dataTransfer });

  // The import is chunked and reloads the store when it finishes, so wait for
  // the row count to reach the expected total rather than for a fixed delay.
  await page
    .locator('[data-testid="roster"] tbody tr')
    .nth(before + files.length - 1)
    .waitFor({ state: 'attached', timeout: 60000 });
  console.log(`  · seeded ${files.length} horses from ${FIXTURES}`);
}

/**
 * Scroll every scrollable ancestor of `selector` back to the top.
 *
 * Shooting a long list after something scrolled it captures the middle of the
 * table while `allTextContents()` still reports the whole thing in order — the
 * DOM looks right and the screenshot is wrong. Walking the ancestor chain
 * avoids naming the scroll container, which is not the element the list's own
 * test id is on.
 */
async function scrollToTop(page, selector) {
  await page.evaluate((sel) => {
    let el = document.querySelector(sel);
    while (el) {
      if (el.scrollHeight > el.clientHeight + 1) el.scrollTop = 0;
      el = el.parentElement;
    }
  }, selector);
  await page.waitForTimeout(150);
}

async function openPet(page, name) {
  await page
    .getByRole('button', { name, exact: true })
    .first()
    .click();
  await waitFor(page, '[data-testid="pet-detail"]');
}

// --- Main ---

console.log('Capturing quickstart screenshots...\n');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: VIEWPORT });
await page.goto(BASE_URL);
await waitFor(page, '[data-testid="roster"]');

// 01 — First launch: My Pets table with all 3 demo pets, filter bar + footer
// visible. Taken BEFORE the fixture stable lands, because step 1 of the guide
// describes exactly this state and no other shot can show it.
await shot(page, '01-first-launch.png');

await seedStable(page);

// 02 — Filter bar highlighted
await addOverlay(page);
await highlight(page, '[data-testid="filter-bar"]');
await shot(page, '02-filter-bar.png');
await clearHighlight(page);
await removeOverlay(page);

// 03 — Roach row's ✎ Edit / ✕ Delete actions highlighted. Roach sorts well down
// the seeded roster, so scroll its row into view before shooting.
await addOverlay(page);
await highlightNode(
  page,
  `const el = document.querySelector('[aria-label="Edit Roach"]')?.closest('td');
   el?.scrollIntoView({ block: 'center' });
   return el;`,
);
await shot(page, '03-row-actions.png');
await clearHighlight(page);
await removeOverlay(page);
await scrollToTop(page, '.roster-table');

// 04 — Footer "+ Upload Genome" and 🔄 auto-import highlighted
await addOverlay(page);
await highlightNode(
  page,
  `return document.querySelector('[data-testid="mypets-upload"]')?.parentElement;`,
);
await shot(page, '04-upload.png');
await clearHighlight(page);
await removeOverlay(page);

// 31 — Genetic quality column, sorted. Both this and 32 need a single species
// selected: capability is only comparable within one gene set, so the column
// and the "Free up slots" button are hidden until the roster is scoped.
await page.locator('[data-testid="filter-species"] button', { hasText: 'Horse' }).click();
await waitFor(page, 'th:has-text("Quality")');
// Twice: the first click sorts ascending, which fills the top of the table with
// the animals that carry nothing unique. Descending is the useful reading.
await page.getByRole('button', { name: 'Quality', exact: true }).click();
await page.waitForTimeout(400);
await page.getByRole('button', { name: /^Quality/ }).click();
await page.waitForTimeout(600);
await scrollToTop(page, '.roster-table');
// No dimming overlay here: the column sits at the far right of a wide table, and
// a highlight ring on one narrow <th> reads as noise rather than emphasis.
await shot(page, '31-quality-column.png');

// 32 — "Free up slots" release plan
await page.getByTestId('mypets-free-slots').click();
await waitFor(page, '[data-testid="free-slots-dialog"]');
await page
  .locator('[data-testid="free-slots-list"], [data-testid="free-slots-none"]')
  .first()
  .waitFor({ state: 'visible', timeout: 30000 });
await page.waitForTimeout(300);
await shot(page, '32-free-slots.png');
await page.getByRole('button', { name: 'Cancel' }).click();
await page.waitForTimeout(200);
// Back to an unscoped roster for the steps that follow.
await page.locator('[data-testid="filter-species"] button', { hasText: 'All' }).first().click();
await page.waitForTimeout(300);

// 05 — Sample Fae Bee detail, Attributes gene grid (default view)
await openPet(page, 'Sample Fae Bee');
await shot(page, '05-gene-grid.png');

// 06 — Effect:/Value: legend-filter row highlighted
await addOverlay(page);
await highlight(page, '.gene-legend');
await shot(page, '06-gene-legend.png');
await clearHighlight(page);
await removeOverlay(page);

// 07 — Hover a gene cell so its tooltip shows
await page.getByRole('button', { name: 'Gene 01B3: Ferocity+' }).hover();
await waitFor(page, '.gene-tooltip');
await shot(page, '07-gene-tooltip.png');
await page.mouse.move(0, 0);
await page.waitForTimeout(150);

// 08 — Detail controls (Attributes/Appearance/Stats/Gallery/Share/Edit/Delete) highlighted
await addOverlay(page);
await highlight(page, '.header-controls');
await shot(page, '08-detail-controls.png');
await clearHighlight(page);
await removeOverlay(page);

// 09 — Appearance grid view
await page.getByRole('button', { name: 'Appearance', exact: true }).click();
await page.waitForTimeout(200);
await shot(page, '09-appearance-view.png');

// 10 — Stats panel open (Attribute Effects)
await page.getByRole('button', { name: 'Attributes', exact: true }).click();
await page.waitForTimeout(200);
await page.getByTestId('detail-stats-toggle').click();
await waitFor(page, '.attribute-row');
await shot(page, '10-stats-panel.png');

// 11 — Attribute row clicked so the grid filters/dims
await page.locator('.attribute-row', { hasText: 'Intelligence' }).click();
await page.waitForTimeout(200);
await shot(page, '11-attribute-filtered.png');
// Deselect and close the stats panel for the next steps
await page.locator('.attribute-row', { hasText: 'Intelligence' }).click();
await page.getByTestId('detail-stats-toggle').click();
await page.waitForTimeout(200);

// 12 — Sample Horse detail, Auto breed filter row highlighted
await page.getByTestId('pet-detail-back').click();
await page.waitForTimeout(200);
await openPet(page, 'Sample Horse');
await addOverlay(page);
await highlight(page, '.breed-filter', { padding: '4px' });
await shot(page, '12-breed-filter.png');
await clearHighlight(page);
await removeOverlay(page);

// 30 — Rarity lens on the same horse. Numbered after the original set rather
// than inserted at its narrative position, so the existing files keep their
// names and quickstart.html's other <img> references stay valid.
await page.getByTestId('view-rarity-btn').click();
await waitFor(page, '[data-testid="rarity-legend"]');
// The baseline is computed asynchronously; the grid renders unshaded until it
// lands, so wait for the legend to stop reporting progress before shooting.
await page.waitForFunction(
  () => {
    const el = document.querySelector('[data-testid="rarity-baseline"]');
    return el !== null && !el.textContent.includes('Analysing');
  },
  null,
  { timeout: 10000 },
);
await shot(page, '30-rarity-view.png');
await page.getByRole('button', { name: 'Attributes', exact: true }).click();
await page.waitForTimeout(200);

// 13 — Two rows selected, the selection bar highlighted
await page.getByTestId('pet-detail-back').click();
await page.waitForTimeout(200);
await page.getByRole('checkbox', { name: 'Select Roach' }).check();
await page.getByRole('checkbox', { name: 'Select Sample Horse' }).check();
await page.waitForTimeout(200);
await addOverlay(page);
await highlight(page, '[data-testid="mypets-selection"]');
await shot(page, '13-select-compare.png');
await clearHighlight(page);
await removeOverlay(page);

// 14 — Compare (GenomeGridDiff) view of the two selected pets
await page.getByTestId('mypets-compare').click();
await waitFor(page, '[data-testid="pet-compare"]');
await shot(page, '14-compare.png');

// 15 — Breed destination ranking table (switch species to horse)
await page.getByTestId('pet-compare-back').click();
await page.waitForTimeout(200);
await page.getByTestId('mypets-clear').click();
await page.waitForTimeout(200);
await page.getByTestId('tab-breed').click();
await page.getByRole('button', { name: '🐴 Horse' }).click();
await waitFor(page, '[data-testid="breeding-pair-table"]');
// A full stable is hundreds of pairs rather than one, and every pair is scored
// locus by locus; give the ranking time to land before shooting.
await page.locator('[data-testid="breeding-pair-table"] tbody tr').first().waitFor({ timeout: 60000 });
await page.waitForTimeout(1000);
await shot(page, '15-breed-rank.png');

// 16 — Trio offspring view (inspect the demo horse pair)
await page.getByTestId('inspect-pair').first().click();
await waitFor(page, '[data-testid="trio-view"]');
await shot(page, '16-trio.png');
// Same view also fronts the homepage "See It in Action" grid.
await page.screenshot({ path: `${HOME_OUT}/screenshot-trio.png`, type: 'png' });
console.log('  ✓ screenshot-trio.png (homepage)');
await page.getByTestId('trio-view-back').click();
await page.waitForTimeout(200);

// 17 — Reference destination. It is map-first now: picking an animal type
// renders the whole-species genome map, and gene editing sits behind the
// Edit toggle (captured as 18 below).
// Horse, not beewasp: rarity needs two pets with a reading at a locus before it
// scores one, and the demo set has a single beewasp — a beewasp map is entirely
// "no data" and shows nothing of the feature.
await page.getByTestId('tab-reference').click();
await page.waitForTimeout(200);
await page.locator('#animalType').selectOption('horse');
await waitFor(page, '[data-testid="genome-map-grid"]');
await page.waitForTimeout(800);
await shot(page, '17-reference.png');

// 18 — Gene-template editing table, reached via Edit → chromosome → Edit Genes.
// #chromosome only exists in edit mode, so the toggle must come first. Back to
// beewasp here: 10 chromosomes make a legible editor screenshot.
await page.getByTestId('reference-edit-toggle').click();
await waitFor(page, '#chromosome');
await page.locator('#animalType').selectOption('beewasp');
await page.waitForTimeout(400);
await page.locator('#chromosome').selectOption({ index: 1 });
await page.waitForTimeout(200);
await page.getByRole('button', { name: 'Edit Genes' }).click();
await waitFor(page, '.gene-editing-view');
await shot(page, '18-gene-editing.png');
await page.screenshot({ path: `${HOME_OUT}/screenshot-gene-editor.png`, type: 'png' });
console.log('  ✓ screenshot-gene-editor.png (homepage)');

// 19 — Pet Gallery view (empty state)
await page.getByTestId('tab-mypets').click();
await page.waitForTimeout(200);
await openPet(page, 'Sample Fae Bee');
await page.getByTestId('detail-gallery-toggle').click();
await page.waitForTimeout(200);
await shot(page, '19-gallery.png');
await page.getByTestId('detail-gallery-toggle').click();
await page.waitForTimeout(200);

// 20 — "Data management" dropdown open (Export/Import Backup) highlighted
await page.getByTestId('pet-detail-back').click();
await page.waitForTimeout(200);
await page.getByTitle('Data management').click();
await page.waitForTimeout(200);
await addOverlay(page);
await highlight(page, '.dropdown');
await shot(page, '20-data-menu.png');
await clearHighlight(page);
await removeOverlay(page);

// 21 — Export Backup dialog
await page.getByRole('menuitem', { name: 'Export Backup' }).click();
await waitFor(page, 'dialog[aria-label="Export Backup"], [role="dialog"]');
await shot(page, '21-export-dialog.png');
await page.getByRole('button', { name: 'Cancel' }).click();
await page.waitForTimeout(200);

// 22 — Settings modal (Display/Theme/Updates)
await page.getByTitle('Settings').click();
await page.waitForTimeout(300);
await shot(page, '22-settings.png');

// 23 — Settings with 🌙 Dark theme selected
await page.getByRole('button', { name: 'Dark theme' }).click();
await page.waitForTimeout(300);
await shot(page, '23-settings-dark.png');

// 24 — My Pets table in dark mode
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
await shot(page, '24-dark-mode.png');

// 25 — Gene grid in dark mode
await openPet(page, 'Sample Fae Bee');
await shot(page, '25-dark-gene-grid.png');

// Revert to light mode before continuing
await page.getByTestId('pet-detail-back').click();
await page.waitForTimeout(200);
await page.getByTitle('Settings').click();
await page.waitForTimeout(200);
await page.getByRole('button', { name: 'Light theme' }).click();
await page.waitForTimeout(200);
await page.keyboard.press('Escape');
await page.waitForTimeout(200);

// 26 — Pet editor open showing the Tags section (add a couple tags)
await page.getByRole('button', { name: 'Edit Roach' }).click();
await waitFor(page, '.tag-text-input');
const tagInput = page.locator('.tag-text-input');
await tagInput.fill('breeder');
await tagInput.press('Enter');
await page.waitForTimeout(150);
await tagInput.fill('keeper');
await tagInput.press('Enter');
await page.waitForTimeout(150);
await page.evaluate(() => {
  const heading = [...document.querySelectorAll('h3')].find((h) => h.textContent.includes('Tags'));
  heading?.scrollIntoView({ block: 'center' });
});
await addOverlay(page);
await highlightNode(
  page,
  `return [...document.querySelectorAll('h3')].find(h => h.textContent.includes('Tags'))?.parentElement;`,
);
await shot(page, '26-tags.png');
await clearHighlight(page);
await removeOverlay(page);
await page.getByRole('button', { name: 'Save Changes' }).click();
await page.waitForTimeout(300);

// 27 — My Pets filter bar showing tag filter pills (now that a pet has tags)
await addOverlay(page);
await highlight(page, '[data-testid="filter-tags"]');
await shot(page, '27-tag-filters.png');
await clearHighlight(page);
await removeOverlay(page);

// 28 — Community destination. NOTE: the dev environment is wired to a live
// Firebase catalogue, so this is NOT an empty/placeholder state — it shows
// real shared community pet listings (real owner names). Captured as-is
// per instructions to never fake a state; flag before publishing if that
// real user data shouldn't appear in public docs.
await page.getByTestId('tab-community').click();
await page
  .locator('[data-testid="community-row"], [data-testid="community-empty"]')
  .first()
  .waitFor({ state: 'visible', timeout: 20000 });
await shot(page, '28-community.png');

// 29 — Share-to-community dialog from a pet detail
await page.getByTestId('tab-mypets').click();
await page.waitForTimeout(200);
await openPet(page, 'Sample Fae Bee');
await page.getByTestId('share-pet-btn').click();
await waitFor(page, '[data-testid="share-preview"]');
await shot(page, '29-share-dialog.png');
await page.getByTestId('share-pet-backdrop').click({ position: { x: 10, y: 10 } });
await page.waitForTimeout(200);

// ===== Homepage screenshots (docs/images/) =====
// Still on Sample Fae Bee detail, Attributes view by default.
await page.getByTestId('detail-stats-toggle').click();
await waitFor(page, '.attribute-row');
await page.waitForTimeout(200);
await shot(page, 'screenshot-gene-grid.png', { dir: HOME_OUT });
await shot(page, 'screenshot-stats.png', { dir: HOME_OUT });

await browser.close();
console.log(`\nAll screenshots saved to ${OUT}/ and ${HOME_OUT}/`);
