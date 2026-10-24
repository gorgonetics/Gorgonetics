import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { waitForAppReady } from './helpers.js';

const SAMPLE_HORSE = readFileSync(resolve('data/Genes_SampleHorse.txt'), 'utf-8');
const withEntity = (entity: string) => SAMPLE_HORSE.replace(/^Entity=.*$/m, `Entity=${entity}`);

/**
 * The Capture tab (#367): the latest wild import, with a capture-or-let-go
 * verdict per sex until the sex is set.
 */
test.describe('Capture tab', () => {
  test('says how to start before any wild horse is imported', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);
    await page.locator('[data-testid="tab-capture"]').click();
    await expect(page.getByText('No wild horse imported yet')).toBeVisible();
  });

  test('gives a verdict for each sex, then one for the sex set', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);
    const imported = await page.evaluate(
      async ([wild]) => {
        const { appState } = await import(/* @vite-ignore */ '/src/lib/stores/pets.ts' as string);
        const result = await appState.uploadPet(wild);
        await appState.loadPets();
        return result.status;
      },
      [withEntity('Wild Horse')],
    );
    expect(imported).toBe('success');

    await page.locator('[data-testid="tab-capture"]').click();
    const verdicts = page.locator('[data-testid="capture-verdict"]');
    await expect(verdicts).toHaveCount(2);
    await expect(page.locator('[data-testid="capture-wild"]')).toContainText('Wild Horse');

    await page.locator('[data-testid="capture-sex"]').getByRole('button', { name: 'Female' }).click();
    await expect(verdicts).toHaveCount(1);
    await expect(verdicts.first()).toHaveAttribute('data-sex', 'Female');
    // Nothing pinned yet, so nothing is worth a capture.
    await expect(verdicts.first()).toContainText('Let go');
    await expect(page.locator('[data-testid="capture-why"]')).toContainText('No alleles pinned');
  });

  test('pins an allele from the hunt list', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);
    await page.evaluate(
      async ([wild]) => {
        const { appState } = await import(/* @vite-ignore */ '/src/lib/stores/pets.ts' as string);
        await appState.uploadPet(wild);
        await appState.loadPets();
      },
      [withEntity('Wild Horse')],
    );
    await page.locator('[data-testid="tab-capture"]').click();
    const hunt = page.locator('[data-testid="capture-hunt"]');
    await hunt.locator('summary').click();
    const first = hunt.locator('[data-testid="capture-hunt-list"] li').first();
    const label = (await first.locator('.cv-chip').textContent())?.trim() ?? '';
    await first.locator('.cv-pin').click();
    await expect(page.locator('[data-testid="capture-pins"]')).toContainText(label.split(' · ')[0]);
  });
});
