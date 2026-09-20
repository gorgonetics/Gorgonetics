import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { waitForAppReady } from './helpers.js';

/**
 * A real horse genome. Anything shorter is rejected as incomplete — the study
 * requires every locus the gene table declares, and the shipped horse table
 * declares ~1,600 of them.
 */
const SAMPLE_HORSE = readFileSync(resolve('data/Genes_SampleHorse.txt'), 'utf-8');

/** The same genome under a structured name, which is what makes it studyable. */
const named = (entity: string) => SAMPLE_HORSE.replace(/^Entity=.*$/m, `Entity=${entity}`);

/**
 * The Study tab's evidence column is resizable.
 *
 * End-to-end rather than a unit test because the whole mechanism is pointer
 * capture and layout measurement: jsdom reports every element as zero-sized,
 * so a unit test could assert the handler ran but never that the column moved.
 *
 * The corpus is seeded here because the evidence column only exists when the
 * study has evidence to show — a test that skipped on an empty corpus would
 * pass for ever without exercising anything.
 */
test.describe('Study evidence splitter', () => {
  test('drag and arrow keys resize the evidence column', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);

    // Two things are needed before the column exists: a corpus the study will
    // accept at all (otherwise the tab shows its empty state instead of the
    // split), and some evidence to put in the column. An excluded animal is
    // the cheapest evidence — it needs no corpus large enough to disagree
    // with itself — and it populates "Not used for studies".
    const seeded = await page.evaluate(
      async ([genomes]) => {
        const petService = await import(/* @vite-ignore */ '/src/lib/services/petService.ts' as string);
        const studyService = await import(/* @vite-ignore */ '/src/lib/services/studyService.ts' as string);
        const ids: number[] = [];
        for (const text of genomes as string[]) {
          const result = await petService.uploadPet(text);
          if (result.pet_id) ids.push(result.pet_id);
        }
        if (ids.length < 2) return 0;
        await studyService.setUseForStudies('horse', String(ids[0]), false);
        return ids.length;
      },
      [
        [
          named('Kb F 50 80 70 70 70 70 70 Alpha'),
          named('Kb F 55 80 70 70 70 70 70 Beta'),
          named('Kb F 60 80 70 70 70 70 70 Gamma'),
        ],
      ],
    );
    expect(seeded, 'seeding the study corpus failed').toBeGreaterThanOrEqual(2);

    await page.locator('[data-testid="tab-study"]').click();

    const splitter = page.locator('[data-testid="study-splitter"]');
    const evidence = page.locator('[data-testid="study-evidence"]');
    await expect(splitter).toBeVisible();

    const widthOf = async () => (await evidence.boundingBox())?.width ?? 0;
    const before = await widthOf();
    expect(before).toBeGreaterThan(0);

    // Left widens the column: the divider is on its left edge, so dragging
    // that edge leftwards gives the evidence more room.
    await splitter.focus();
    await page.keyboard.press('ArrowLeft');
    expect(await widthOf()).toBeGreaterThan(before);

    await page.keyboard.press('ArrowRight');
    expect(await widthOf()).toBeCloseTo(before, 0);

    // Clamped, so repeated presses cannot shrink the column out of existence.
    await page.keyboard.press('End');
    const min = await widthOf();
    await page.keyboard.press('ArrowRight');
    expect(await widthOf()).toBeCloseTo(min, 0);
    expect(min).toBeGreaterThan(0);

    // And a real drag, which is what almost everyone will actually use.
    const handle = await splitter.boundingBox();
    if (!handle) throw new Error('splitter has no box');
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(handle.x - 80, handle.y + handle.height / 2, { steps: 8 });
    await page.mouse.up();
    expect(await widthOf()).toBeGreaterThan(min);
  });
});
