import { expect, test } from '@playwright/test';
import { waitForPets } from './helpers.js';

// Drag-and-drop genome upload (#98). The webview's native HTML5 drag events
// reach the app (dragDropEnabled is false in tauri.conf.json), so we drive the
// feature with synthetic DragEvents carrying a DataTransfer. A real OS drag
// can't be scripted, but the handler path — file detection, reading, upload —
// is identical.

/** Dispatch a synthetic file drop of the given {name, url|content} files onto the pet list. */
async function dropFilesOnList(page, files) {
  await page.evaluate(async (files) => {
    const dt = new DataTransfer();
    for (const f of files) {
      const content = f.url ? await (await fetch(f.url)).text() : f.content;
      dt.items.add(new File([content], f.name, { type: 'text/plain' }));
    }
    // A real OS file drag exposes the 'Files' type; jsdom/Chromium won't set it
    // from items.add alone, so pin it to match what the handler keys off.
    Object.defineProperty(dt, 'types', { value: ['Files'], configurable: true });
    document
      .querySelector('.pet-list')
      .dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
  }, files);
}

test.describe('Genome drop-to-upload (#98)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForPets(page);
  });

  test('shows a drop overlay while files are dragged over the list', async ({ page }) => {
    await page.evaluate(() => {
      const dt = new DataTransfer();
      Object.defineProperty(dt, 'types', { value: ['Files'], configurable: true });
      document
        .querySelector('.pet-list')
        .dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
    });
    await expect(page.locator('.file-drop-overlay')).toBeVisible();
    await expect(page.locator('.file-drop-overlay')).toHaveText(/Drop genome files/);

    // Leaving the panel (null relatedTarget) clears the overlay.
    await page.evaluate(() => {
      const dt = new DataTransfer();
      Object.defineProperty(dt, 'types', { value: ['Files'], configurable: true });
      document
        .querySelector('.pet-list')
        .dispatchEvent(new DragEvent('dragleave', { bubbles: true, cancelable: true, dataTransfer: dt }));
    });
    await expect(page.locator('.file-drop-overlay')).toHaveCount(0);
  });

  test('rejects dropped non-genome files with a message', async ({ page }) => {
    await dropFilesOnList(page, [{ name: 'cat.png', content: 'not a genome' }]);

    await expect(page.locator('.error-banner')).toContainText('No genome files (.txt)');
    await expect(page.locator('.pet-count')).toHaveText('3 pets');
  });

  test('uploads a dropped genome file into the list', async ({ page }) => {
    // Sample Horse ships as demo data, so delete it first to prove the drop
    // re-adds it (content-hash dedup makes re-uploading an existing pet a no-op).
    const horse = page.locator('.pet-card-wrapper', { hasText: 'Sample Horse' });
    await horse.hover();
    await horse.locator('.delete-btn').click();
    await page.locator('.confirm-dialog .btn-danger').click();
    await expect(page.locator('.pet-count')).toHaveText('2 pets');

    await dropFilesOnList(page, [{ name: 'Genes_SampleHorse.txt', url: '/data/Genes_SampleHorse.txt' }]);

    await expect(page.locator('.pet-count')).toHaveText('3 pets');
    await expect(page.locator('.pet-card-name', { hasText: 'Sample Horse' })).toBeVisible();
    await expect(page.locator('.error-banner')).toHaveCount(0);
  });
});
