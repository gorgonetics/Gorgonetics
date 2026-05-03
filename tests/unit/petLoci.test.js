import { beforeEach, describe, expect, it } from 'vitest';
import { closeDatabase, initDatabase } from '$lib/services/database.js';
import { runMigrations } from '$lib/services/migrationService.js';
import * as petService from '$lib/services/petService.js';
import { Gender } from '$lib/types/index.js';
import { loadAllPetLoci, walkPairLoci } from '$lib/utils/petLoci.js';

const MINIMAL_GENOME = (name, alleles) => `[Overview]
Format=1.0
Character=Tester
Entity=${name}
Genome=BeeWasp

[Genes]
1=${alleles}
`;

async function reset() {
  await closeDatabase();
  await initDatabase();
  await runMigrations();
}

async function uploadPet(name, alleles) {
  const result = await petService.uploadPet(MINIMAL_GENOME(name, alleles), { name, gender: Gender.MALE });
  expect(result.status).toBe('success');
  return result.pet_id;
}

describe('loadAllPetLoci', () => {
  beforeEach(reset);

  it('returns an empty map when given no pet ids', async () => {
    const map = await loadAllPetLoci([]);
    expect(map.size).toBe(0);
  });

  it('returns one entry per pet, keyed by id, with gene_id → gene_type', async () => {
    const id1 = await uploadPet('A', 'DRx');
    const id2 = await uploadPet('B', 'xR?');
    const map = await loadAllPetLoci([id1, id2]);

    expect(map.size).toBe(2);
    const a = map.get(id1);
    const b = map.get(id2);
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(a.size).toBe(3);
    expect(a.get('01A1')).toBe('D');
    expect(a.get('01A2')).toBe('R');
    expect(a.get('01A3')).toBe('x');
    expect(b.get('01A1')).toBe('x');
    expect(b.get('01A2')).toBe('R');
    expect(b.get('01A3')).toBe('?');
  });

  it('omits pets that have no projected loci rather than mapping them to empty', async () => {
    const id1 = await uploadPet('A', 'DDD');
    const map = await loadAllPetLoci([id1, 999_999]);
    expect(map.has(id1)).toBe(true);
    expect(map.has(999_999)).toBe(false);
  });
});

describe('walkPairLoci', () => {
  function locus(entries) {
    return new Map(entries);
  }

  it('calls the callback once per locus when both maps share keys', () => {
    const a = locus([
      ['01A1', 'D'],
      ['01A2', 'R'],
    ]);
    const b = locus([
      ['01A1', 'x'],
      ['01A2', 'D'],
    ]);
    const seen = [];
    walkPairLoci(a, b, (geneId, ta, tb) => seen.push([geneId, ta, tb]));

    expect(seen).toEqual([
      ['01A1', 'D', 'x'],
      ['01A2', 'R', 'D'],
    ]);
  });

  it('passes UNKNOWN for the missing side when only one map has a locus', () => {
    const a = locus([['01A1', 'D']]);
    const b = locus([['01A2', 'R']]);
    const seen = [];
    walkPairLoci(a, b, (geneId, ta, tb) => seen.push([geneId, ta, tb]));

    expect(seen).toEqual([
      ['01A1', 'D', '?'],
      ['01A2', '?', 'R'],
    ]);
  });

  it('does nothing when both maps are empty', () => {
    const seen = [];
    walkPairLoci(new Map(), new Map(), (...args) => seen.push(args));
    expect(seen).toEqual([]);
  });

  it('walks `a` first (in insertion order), then loci that exist only in `b`', () => {
    const a = locus([
      ['01A2', 'D'],
      ['01A1', 'R'],
    ]);
    const b = locus([
      ['01A1', 'x'],
      ['01A3', 'D'],
    ]);
    const seenIds = [];
    walkPairLoci(a, b, (geneId) => seenIds.push(geneId));
    expect(seenIds).toEqual(['01A2', '01A1', '01A3']);
  });

  it('does not double-count loci present in both', () => {
    const a = locus([['01A1', 'D']]);
    const b = locus([['01A1', 'R']]);
    let count = 0;
    walkPairLoci(a, b, () => {
      count++;
    });
    expect(count).toBe(1);
  });
});
