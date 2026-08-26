import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import FreeSlotsDialog from '$lib/components/mypets/FreeSlotsDialog.svelte';
import { closeDatabase, initDatabase } from '$lib/services/database.js';
import * as geneService from '$lib/services/geneService.js';
import { runMigrations } from '$lib/services/migrationService.js';
import * as petService from '$lib/services/petService.js';
import { Gender, type Pet } from '$lib/types/index.js';

/**
 * The free-up-slots dialog.
 *
 * The contract worth protecting here is not the layout — it is that the
 * dialog never lets a player act on a set the arithmetic does not support.
 * Leave-one-out scores are not additive, so the list is an ordered sequence
 * and its total only holds if released in order.
 */

function genome(name: string, alleles: string) {
  return `[Overview]
Format=1.0
Character=Tester
Entity=${name}
Genome=BeeWasp

[Genes]
1=${alleles}
`;
}

async function upload(name: string, gender: Gender, alleles: string): Promise<Pet> {
  const r = await petService.uploadPet(genome(name, alleles), { name, gender });
  expect(r.status).toBe('success');
  return (await petService.getPet(r.pet_id as number)) as Pet;
}

/** `01A1`: recessive positive, dominant negative — the chromosome-01 shape. */
async function seedGenes() {
  await geneService.upsertGene('beewasp', '01', '01A1', {
    effectDominant: 'Toughness-',
    effectRecessive: 'Intelligence+',
  });
  geneService.clearGeneEffectsCache('beewasp');
}

/** One irreplaceable founder plus six interchangeable animals. */
async function stable(): Promise<Pet[]> {
  await seedGenes();
  return [
    await upload('Founder', Gender.FEMALE, 'R??'),
    await upload('Dup1', Gender.MALE, 'D??'),
    await upload('Dup2', Gender.MALE, 'D??'),
    await upload('Dup3', Gender.FEMALE, 'D??'),
    await upload('Dup4', Gender.FEMALE, 'D??'),
    await upload('Dup5', Gender.MALE, 'D??'),
    await upload('Dup6', Gender.MALE, 'D??'),
  ];
}

beforeEach(async () => {
  await closeDatabase();
  await initDatabase();
  await runMigrations();
  geneService.clearGeneEffectsCache();
});

afterEach(cleanup);

const noop = async () => {};
const items = (c: HTMLElement) =>
  [...c.querySelectorAll('[data-testid="free-slots-list"] li')].map((li) =>
    li.textContent?.replace(/\s+/g, ' ').trim(),
  );

describe('FreeSlotsDialog', () => {
  it('recommends the redundant animals and never the founder', async () => {
    const pets = await stable();
    const { container } = render(FreeSlotsDialog, {
      species: 'beewasp',
      pets,
      onRelease: noop,
      onClose: noop,
    });
    await waitFor(() => expect(items(container).length).toBeGreaterThan(0));
    const listed = items(container).join(' ');
    expect(listed).not.toContain('Founder');
    expect(listed).toContain('Dup');
  });

  it('says plainly when the release costs nothing', async () => {
    const pets = await stable();
    const { container } = render(FreeSlotsDialog, {
      species: 'beewasp',
      pets,
      onRelease: noop,
      onClose: noop,
    });
    await waitFor(() => expect(container.querySelector('[data-testid="free-slots-verdict"]')).toBeTruthy());
    expect(container.querySelector('[data-testid="free-slots-verdict"]')?.textContent).toContain('nothing');
  });

  it('numbers the releases, because the order is what makes the total honest', async () => {
    const pets = await stable();
    const { container } = render(FreeSlotsDialog, {
      species: 'beewasp',
      pets,
      onRelease: noop,
      onClose: noop,
    });
    await waitFor(() => expect(items(container).length).toBeGreaterThan(1));
    const steps = [...container.querySelectorAll('[data-testid="free-slots-list"] .step')].map((s) =>
      s.textContent?.trim(),
    );
    expect(steps).toEqual(steps.map((_, i) => String(i + 1)));
  });

  it('releases exactly the listed ids, in the listed order', async () => {
    const pets = await stable();
    let released: number[] = [];
    const { container } = render(FreeSlotsDialog, {
      species: 'beewasp',
      pets,
      onRelease: async (ids) => {
        released = ids;
      },
      onClose: noop,
    });
    await waitFor(() => expect(items(container).length).toBeGreaterThan(0));
    const listedNames = items(container).map((t) => (t as string).replace(/^\d+\s+/, '').split(' ')[0]);
    await fireEvent.click(container.querySelector('[data-testid="free-slots-confirm"]') as HTMLElement);
    await waitFor(() => expect(released.length).toBe(listedNames.length));
    const byId = new Map(pets.map((p) => [p.id, p.name]));
    expect(released.map((id) => byId.get(id))).toEqual(listedNames);
  });

  it('clamps an over-large target to what the floor allows', async () => {
    const pets = await stable();
    const { container } = render(FreeSlotsDialog, {
      species: 'beewasp',
      pets,
      onRelease: noop,
      onClose: noop,
    });
    const input = container.querySelector('[data-testid="free-slots-count"]') as HTMLInputElement;
    await fireEvent.input(input, { target: { value: '99' } });
    // 7 animals, floor of 3 → at most 4 releases, and asking for more is
    // clamped rather than reported as a shortfall.
    await waitFor(() => expect(items(container).length).toBe(pets.length - 3));
    expect(container.querySelector('[data-testid="free-slots-shortfall"]')).toBeNull();
  });

  it('never reports nothing-releasable because the target was zero or blank', async () => {
    // `min="1"` on the input is advisory: `bind:value` hands over 0 for a
    // typed zero and null for a cleared field. Either would make the walk
    // return an empty list, which the UI would misreport as "every animal
    // holds something no other one does".
    const pets = await stable();
    const { container } = render(FreeSlotsDialog, {
      species: 'beewasp',
      pets,
      onRelease: noop,
      onClose: noop,
    });
    const input = container.querySelector('[data-testid="free-slots-count"]') as HTMLInputElement;
    for (const value of ['0', '', '-4']) {
      await fireEvent.input(input, { target: { value } });
      await waitFor(() => expect(items(container).length).toBeGreaterThan(0));
      expect(container.querySelector('[data-testid="free-slots-none"]')).toBeNull();
    }
  });

  it('surfaces a failed release instead of closing on a lie', async () => {
    const pets = await stable();
    const { container } = render(FreeSlotsDialog, {
      species: 'beewasp',
      pets,
      onRelease: async () => {
        throw new Error('db down');
      },
      onClose: noop,
    });
    await waitFor(() => expect(items(container).length).toBeGreaterThan(0));
    await fireEvent.click(container.querySelector('[data-testid="free-slots-confirm"]') as HTMLElement);
    await waitFor(() => expect(container.querySelector('[data-testid="free-slots-release-error"]')).toBeTruthy());
  });

  it('nudges the player to star the animal they ride', async () => {
    // The score has no view on riding, so the exemption has to be declared.
    const pets = await stable();
    const { container } = render(FreeSlotsDialog, {
      species: 'beewasp',
      pets,
      onRelease: noop,
      onClose: noop,
    });
    await waitFor(() => expect(container.querySelector('[data-testid="free-slots-nopins"]')).toBeTruthy());
    expect(container.querySelector('[data-testid="free-slots-nopins"]')?.textContent).toContain('Star');
  });

  it('excludes a starred animal from the recommendation', async () => {
    const pets = await stable();
    // Star a redundant animal — it would otherwise be released.
    await petService.updatePet(pets[1].id, { starred: true });
    const starred = (await petService.getPet(pets[1].id)) as Pet;
    const withStar = pets.map((p) => (p.id === starred.id ? starred : p));

    const { container } = render(FreeSlotsDialog, {
      species: 'beewasp',
      pets: withStar,
      onRelease: noop,
      onClose: noop,
    });
    await waitFor(() => expect(container.querySelector('[data-testid="free-slots-pinned"]')).toBeTruthy());
    expect(container.querySelector('[data-testid="free-slots-pinned"]')?.textContent).toContain('Dup1');
    expect(items(container).join(' ')).not.toContain('Dup1 ');
  });

  it('promises no deletion, because releasing only un-stables', async () => {
    const pets = await stable();
    const { container } = render(FreeSlotsDialog, {
      species: 'beewasp',
      pets,
      onRelease: noop,
      onClose: noop,
    });
    expect(container.querySelector('.foot-note')?.textContent).toContain('Nothing is deleted');
  });
});
