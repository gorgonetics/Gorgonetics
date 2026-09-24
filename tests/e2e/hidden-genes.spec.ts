import { expect, test } from '@playwright/test';
import { gotoDestination, waitForPets } from './helpers.js';

test.describe('Hidden gene warnings', () => {
  test('Breed and the trio warn about animals with hidden genes', async ({ page }) => {
    test.slow();
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.goto('/');
    await waitForPets(page);
    // The demo horses were studied without every gene revealed.
    await gotoDestination(page, 'Breed');
    await page.locator('[data-testid="breed-species"] [data-species="horse"]').click();
    await expect(page.getByTestId('breed-hidden-warning')).toContainText('hidden genes');
    await page.locator('[data-testid="inspect-pair"]').first().click();
    await expect(page.getByTestId('trio-hidden-warning')).toContainText('hidden gene');
  });
});
