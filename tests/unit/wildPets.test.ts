import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { closeDatabase, getDb, initDatabase } from '#lib/services/database.js';
import * as geneService from '#lib/services/geneService.js';
import { getSchemaVersion, runMigrations } from '#lib/services/migrationService.js';
import * as petService from '#lib/services/petService.js';
import { breedFromSelectors, wildEntity, wildPetName } from '#lib/utils/wildPet.js';

const SAMPLE_HORSE = readFileSync(resolve('data/Genes_SampleHorse.txt'), 'utf-8');
const withEntity = (entity: string, text = SAMPLE_HORSE) => text.replace(/^Entity=.*$/m, `Entity=${entity}`);
const WILD = withEntity('Wild Horse');
const CAPTURED = withEntity('Kb F 40 80 70 70 70 70 70');

const SELECTOR_CHROMOSOMES = ['09', '13', '17', '21', '25', '29', '33', '37', '41', '45'];

/** `text` with every selector chromosome recessive except `dominant`, as a pure breed carries them. */
function pureBred(text: string, dominant: string): string {
  return text.replace(/^(\d+)=(\s*)(.*)$/gm, (line, chr: string, gap: string, genes: string) =>
    SELECTOR_CHROMOSOMES.includes(chr)
      ? `${chr}=${gap}${genes.replace(/[DRx?]/g, chr === dominant ? 'D' : 'R')}`
      : line,
  );
}

/** Seed the selector genes of the bundled horse template: each chromosome names one breed. */
async function seedSelectorTemplate(): Promise<void> {
  for (const chr of SELECTOR_CHROMOSOMES) {
    const genes = JSON.parse(readFileSync(resolve(`assets/horse/horse_genes_chr${chr}.json`), 'utf-8'));
    for (const g of Array.isArray(genes) ? genes : genes.genes) {
      await geneService.upsertGene('horse', chr, g.gene, { appearance: g.appearance, breed: g.breed });
    }
  }
}

/** The same file with one gene flipped, so its genes differ from `WILD`. */
function otherGenes(text: string): string {
  return text.replace(/^(01=\s*)(\S)/m, (_, head: string, gene: string) => head + (gene === 'D' ? 'R' : 'D'));
}

describe('wildEntity', () => {
  it('reads the wild kind from the Entity line, and nothing else', () => {
    expect(wildEntity(WILD)).toBe('Wild Horse');
    expect(wildEntity(SAMPLE_HORSE)).toBeNull();
    expect(wildEntity(withEntity('Wild Horse Two'))).toBeNull();
  });

  it('reads a file with Windows line endings', () => {
    expect(wildEntity(WILD.replace(/\n/g, '\r\n'))).toBe('Wild Horse');
  });

  it('reads the breed from the one all-dominant selector chromosome', () => {
    const selectors = new Map([
      ['33A1', 'Blanketed'],
      ['33A2', 'Blanketed'],
      ['13A1', 'Kurbone'],
      ['13A2', 'Kurbone'],
    ]);
    const breed = (genes: Record<string, string>) => breedFromSelectors(Object.entries(genes), selectors);
    expect(breed({ '33A1': 'D', '33A2': 'D', '13A1': 'R', '13A2': 'D' })).toBe('Blanketed');
    // An unrevealed gene is not a reading against the chromosome.
    expect(breed({ '33A1': 'D', '33A2': '?', '13A1': 'R', '13A2': 'R' })).toBe('Blanketed');
    // Mixed selectors name no breed, and neither do two all-dominant ones.
    expect(breed({ '33A1': 'D', '33A2': 'x', '13A1': 'R', '13A2': 'D' })).toBe('');
    expect(breed({ '33A1': 'D', '33A2': 'D', '13A1': 'D', '13A2': 'D' })).toBe('');
    expect(breed({ '01A1': 'D' })).toBe('');
  });

  it('names a wild animal by its import time', () => {
    expect(wildPetName('Wild Horse', new Date(2026, 9, 24, 9, 5))).toBe('Wild Horse 2026-10-24 09:05');
  });
});

describe('wild pets', () => {
  beforeEach(async () => {
    await closeDatabase();
    await initDatabase();
    await runMigrations();
  });

  it('imports a wild file as wild, never stabled, with no attribute readings', async () => {
    const result = await petService.uploadPet(WILD);
    expect(result.status).toBe('success');
    expect(result.kind).toBe('created');
    const pet = await petService.getPet(result.pet_id!);
    expect(pet?.wild).toBe(true);
    expect(pet?.stabled).toBe(false);
    expect(pet?.attributes_measured).toBe(false);
    expect(pet?.name).toMatch(/^Wild Horse \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });

  it('gives a pure-bred wild horse the breed its selectors name', async () => {
    await seedSelectorTemplate();
    const pure = await petService.uploadPet(pureBred(WILD, '33'));
    expect((await petService.getPet(pure.pet_id!))?.breed).toBe('Blanketed');
    // The sample's own selectors are mixed: no breed to read.
    const mixed = await petService.uploadPet(WILD);
    expect((await petService.getPet(mixed.pet_id!))?.breed).toBe('');
    // Captured under a name that does not parse, it keeps the selectors' breed.
    const captured = await petService.uploadPet(pureBred(withEntity('Dobbin'), '33'));
    expect(captured).toMatchObject({ kind: 'captured', pet_id: pure.pet_id });
    expect(await petService.getPet(pure.pet_id!)).toMatchObject({ name: 'Dobbin', breed: 'Blanketed' });
  });

  it('refuses to stable a wild animal, and says why', async () => {
    const { pet_id } = await petService.uploadPet(WILD);
    await expect(petService.updatePet(pet_id!, { stabled: true, notes: 'grey mare' })).rejects.toThrow(
      'cannot be stabled',
    );
    expect((await petService.getPet(pet_id!))?.stabled).toBe(false);
    await petService.updatePet(pet_id!, { notes: 'grey mare by the river' });
    expect((await petService.getPet(pet_id!))?.notes).toBe('grey mare by the river');
  });

  it('gives a captured animal whose name does not parse the sex set on its wild entry, or the one passed', async () => {
    const set = await petService.uploadPet(WILD);
    await petService.updatePet(set.pet_id!, { gender: 'Female' });
    await petService.uploadPet(withEntity('Dobbin'));
    expect((await petService.getPet(set.pet_id!))?.gender).toBe('Female');

    const passed = await petService.uploadPet(otherGenes(WILD));
    await petService.uploadPet(otherGenes(withEntity('Daisy')), { gender: 'Female' });
    expect((await petService.getPet(passed.pet_id!))?.gender).toBe('Female');
  });

  it('replaces the wild entry when the captured file is imported', async () => {
    const wild = await petService.uploadPet(WILD);
    await petService.updatePet(wild.pet_id!, { notes: 'grey mare by the river', tags: ['scouted'] });

    const wildRow = (await petService.getPet(wild.pet_id!))!;
    const result = await petService.uploadPet(CAPTURED);
    expect(result.status).toBe('success');
    expect(result.kind).toBe('captured');
    expect(result.pet_id).toBe(wild.pet_id);

    const { items } = await petService.getAllPets();
    expect(items).toHaveLength(1);
    const pet = await petService.getPet(wild.pet_id!);
    expect(pet).toMatchObject({
      name: 'Kb F 40 80 70 70 70 70 70',
      breed: 'Kurbone',
      gender: 'Female',
      wild: false,
      stabled: true,
      attributes_measured: true,
      toughness: 80,
      notes: 'grey mare by the river',
      tags: ['scouted'],
      genome_text: CAPTURED,
    });
    expect(pet!.captured_at).not.toBe('');
    expect(pet!.created_at).toBe(wildRow.created_at);
    // The captured file is in the ledger, so a rescan skips it.
    expect(await petService.hasImportedFile(pet!.content_hash)).toBe(true);
  });

  it('imports the captured file as a new pet when no wild entry has its genes', async () => {
    await petService.uploadPet(WILD);
    const result = await petService.uploadPet(otherGenes(CAPTURED));
    expect(result.kind).toBe('created');
    expect((await petService.getAllPets()).items).toHaveLength(2);
  });

  it('does not let a community import take over a wild entry', async () => {
    const wild = await petService.uploadPet(WILD);
    const result = await petService.uploadPet(CAPTURED, { stabled: false });
    expect(result.kind).toBe('created');
    expect((await petService.getPet(wild.pet_id!))?.wild).toBe(true);
  });

  it('keeps every wild file the game overwrote as its own entry', async () => {
    await petService.uploadPet(WILD);
    await petService.uploadPet(otherGenes(WILD));
    const { items } = await petService.getAllPets();
    expect(items.map((p) => p.wild)).toEqual([true, true]);
  });
});

describe('migration 24', () => {
  beforeEach(async () => {
    await closeDatabase();
    await initDatabase();
  });

  it('adds captured_at to a database that already ran migration 23', async () => {
    await runMigrations(23);
    const { pet_id } = await petService.uploadPet(WILD);
    await runMigrations();
    expect(await getSchemaVersion()).toBe(24);
    expect((await petService.getPet(pet_id!))?.captured_at).toBe('');
  });
});

describe('migration 23', () => {
  beforeEach(async () => {
    await closeDatabase();
    await initDatabase();
  });

  it('marks wild rows imported before it, and names the unrenamed ones apart', async () => {
    await runMigrations(22);
    const db = getDb();
    const insert = (name: string, hash: string, text: string) =>
      db.execute(
        `INSERT INTO pets (name, species, gender, content_hash, genome_text, created_at, updated_at, stabled)
         VALUES ($name, $species, $gender, $content_hash, $genome_text, $created_at, $updated_at, $stabled)`,
        {
          name,
          species: 'Horse',
          gender: 'Male',
          content_hash: hash,
          genome_text: text,
          created_at: '2026-10-01T10:30:00.000Z',
          updated_at: '2026-10-01T10:30:00.000Z',
          stabled: 1,
        },
      );
    await insert('Wild Horse', 'wild', WILD);
    await insert('River mare', 'wild-renamed', otherGenes(WILD));
    await insert('Sample Horse', 'tame', SAMPLE_HORSE);

    await runMigrations();

    const rows = await db.select<Array<{ content_hash: string; name: string; wild: number; stabled: number }>>(
      'SELECT content_hash, name, wild, stabled FROM pets',
    );
    const byHash = Object.fromEntries(rows.map((r) => [r.content_hash, r]));
    expect(byHash.wild).toMatchObject({
      wild: 1,
      stabled: 0,
      name: wildPetName('Wild Horse', new Date('2026-10-01T10:30:00.000Z')),
    });
    expect(byHash['wild-renamed']).toMatchObject({ wild: 1, stabled: 0, name: 'River mare' });
    expect(byHash.tame).toMatchObject({ wild: 0, stabled: 1, name: 'Sample Horse' });
  });
});
