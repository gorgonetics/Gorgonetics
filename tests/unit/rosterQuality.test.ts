import { cleanup, render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Roster from '$lib/components/mypets/Roster.svelte';
import { closeDatabase, initDatabase } from '$lib/services/database.js';
import * as geneService from '$lib/services/geneService.js';
import { runMigrations } from '$lib/services/migrationService.js';
import * as petService from '$lib/services/petService.js';
import { myPetsView } from '$lib/stores/mypets.svelte.js';
import { pets as petStore } from '$lib/stores/pets.js';
import { Gender, type Pet } from '$lib/types/index.js';

/**
 * The Quality column, tested at component level rather than E2E.
 *
 * E2E cannot reach it: outside Tauri `pickGenomeFiles` returns nothing, so a
 * browser test can only ever see the 3-pet demo stable — two horses, below
 * `MIN_POPULATION`, where the column correctly refuses to render. Seeding a
 * real population needs the service layer, which is what this does.
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

async function seed(): Promise<Pet[]> {
  await geneService.upsertGene('beewasp', '01', '01A1', {
    effectDominant: 'Toughness-',
    effectRecessive: 'Intelligence+',
  });
  geneService.clearGeneEffectsCache('beewasp');
  return [
    // Sole carrier of the recessive positive: irreplaceable.
    await upload('Founder', Gender.FEMALE, 'R??'),
    await upload('Dup1', Gender.MALE, 'D??'),
    await upload('Dup2', Gender.MALE, 'D??'),
    await upload('Dup3', Gender.FEMALE, 'D??'),
  ];
}

function setView(species: string) {
  myPetsView.species = species;
  myPetsView.sortCol = 'name';
  myPetsView.sortDir = 'asc';
  myPetsView.selectedIds = new Set();
}

beforeEach(async () => {
  await closeDatabase();
  await initDatabase();
  await runMigrations();
  geneService.clearGeneEffectsCache();
  setView('beewasp');
});

afterEach(() => {
  cleanup();
  petStore.set([]);
  setView('');
});

const headers = (c: HTMLElement) => [...c.querySelectorAll('.roster-table thead th')].map((h) => h.textContent?.trim());
const cellFor = (c: HTMLElement, name: string) => {
  const row = [...c.querySelectorAll('.roster-table tbody tr')].find((r) => r.textContent?.includes(name));
  return row?.querySelector('.quality') as HTMLElement | undefined;
};

describe('Roster — genetic quality column', () => {
  it('shows a share for the irreplaceable pet and a dash for redundant ones', async () => {
    const pets = await seed();
    petStore.set(pets);
    const { container } = render(Roster, { pets });

    await waitFor(() => expect(headers(container)).toContain('Quality'));
    // The founder holds every irreplaceable allele in the population.
    await waitFor(() => expect(cellFor(container, 'Founder')?.textContent?.trim()).toBe('100.0%'));
    expect(cellFor(container, 'Dup1')?.textContent?.trim()).toBe('—');
    expect(cellFor(container, 'Dup1')?.classList.contains('redundant')).toBe(true);
  });

  it('explains a zero rather than leaving it bare', async () => {
    const pets = await seed();
    petStore.set(pets);
    const { container } = render(Roster, { pets });
    await waitFor(() => expect(cellFor(container, 'Dup1')).toBeTruthy());
    expect(cellFor(container, 'Dup1')?.getAttribute('title')).toContain('available from another stabled pet');
    expect(cellFor(container, 'Founder')?.getAttribute('title')).toContain('sole source');
  });

  it('scores against the stabled population, not the filtered rows', async () => {
    // The roster is handed ONE row, but the score still reflects the whole
    // stable — otherwise a search box would silently change every score.
    const pets = await seed();
    petStore.set(pets);
    const { container } = render(Roster, { pets: [pets[1]] });
    await waitFor(() => expect(headers(container)).toContain('Quality'));
    // Dup1 alone on screen still reads redundant, because its rivals exist.
    expect(cellFor(container, 'Dup1')?.textContent?.trim()).toBe('—');
  });

  it('hides the column below the population floor', async () => {
    await geneService.upsertGene('beewasp', '01', '01A1', {
      effectDominant: 'Toughness-',
      effectRecessive: 'Intelligence+',
    });
    geneService.clearGeneEffectsCache('beewasp');
    const pets = [await upload('Only', Gender.FEMALE, 'R??'), await upload('Other', Gender.MALE, 'D??')];
    petStore.set(pets);
    const { container } = render(Roster, { pets });
    // Two pets: every allele reads as sole, so the score cannot discriminate.
    await waitFor(() => expect(container.querySelector('.roster-table')).toBeTruthy());
    expect(headers(container)).not.toContain('Quality');
  });

  it('hides the column when no single species is selected', async () => {
    const pets = await seed();
    petStore.set(pets);
    setView('');
    const { container } = render(Roster, { pets });
    await waitFor(() => expect(container.querySelector('.roster-table')).toBeTruthy());
    expect(headers(container)).not.toContain('Quality');
  });
});
