import { beforeEach, describe, expect, it } from 'vitest';
import { closeDatabase, getDb, initDatabase } from '$lib/services/database.js';
import { runMigrations } from '$lib/services/migrationService.js';
import * as petService from '$lib/services/petService.js';
import { Gender } from '$lib/types/index.js';
import { groupLociByChromosome, loadAllPetLoci, walkPairLoci } from '$lib/utils/petLoci.js';

// `1=${alleles}` is a single chromosome (id 01) carrying one block A
// with as many positions as `alleles` characters. Three-character input
// `'DRx'` lands at gene_ids 01A1=D, 01A2=R, 01A3=x.
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

  it('coerces unrecognised gene_type values to UNKNOWN rather than propagating them', async () => {
    // Direct INSERT bypasses writePetGenes so we can simulate a corrupt
    // row from a legacy backup or an out-of-band write.
    const id = await uploadPet('A', 'DDD');
    await getDb().execute('INSERT INTO pet_genes (pet_id, gene_id, gene_type) VALUES ($pid, $gid, $gt)', {
      pid: id,
      gid: '01Z9',
      gt: 'BOGUS',
    });
    const map = await loadAllPetLoci([id]);
    expect(map.get(id).get('01Z9')).toBe('?');
  });

  it('re-projects pet_genes from genome_data when a legacy pet has no projected rows', async () => {
    // Simulates an un-backfilled pet: row exists in `pets`, genome_data
    // is intact, but pet_genes is empty. Without the fallback the pet
    // would be silently absent from the result and downstream comparison
    // / breeding would treat it as missing.
    const id = await uploadPet('A', 'DRx');
    await getDb().execute('DELETE FROM pet_genes WHERE pet_id = $id', { id });

    const map = await loadAllPetLoci([id]);
    expect(map.has(id)).toBe(true);
    expect(map.get(id).size).toBe(3);
    expect(map.get(id).get('01A1')).toBe('D');

    // Side effect: the projection is now persisted, subsequent reads
    // skip the fallback path.
    const rows = await getDb().select('SELECT COUNT(*) as n FROM pet_genes WHERE pet_id = $id', { id });
    expect(rows[0].n).toBeGreaterThan(0);
  });

  it('still omits pet ids that have no `pets` row at all', async () => {
    // Fallback can't manufacture data — a truly absent id stays absent.
    const map = await loadAllPetLoci([999_999]);
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

describe('groupLociByChromosome', () => {
  it('groups loci by chromosome with positional sort within each block', () => {
    const loci = new Map([
      ['02B2', 'D'],
      ['01A2', 'R'],
      ['01A1', 'D'],
      ['02B1', 'x'],
    ]);
    const grouped = groupLociByChromosome(loci);

    expect([...grouped.keys()].sort()).toEqual(['01', '02']);
    expect(grouped.get('01').map((g) => g.id)).toEqual(['01A1', '01A2']);
    expect(grouped.get('02').map((g) => g.id)).toEqual(['02B1', '02B2']);
  });

  it('orders blocks shorter-first then lex within length (A < Z < AA)', () => {
    // Insert in non-canonical order; the helper must sort to A, B, ..., Z, AA, AB, ...
    const loci = new Map([
      ['01AA1', 'D'],
      ['01B1', 'R'],
      ['01A1', 'x'],
      ['01Z1', 'D'],
      ['01AB1', 'R'],
    ]);
    const grouped = groupLociByChromosome(loci);
    expect(grouped.get('01').map((g) => g.block)).toEqual(['A', 'B', 'Z', 'AA', 'AB']);
  });

  it('returns each locus with id, type, block, and position metadata', () => {
    const loci = new Map([['01A3', 'x']]);
    const grouped = groupLociByChromosome(loci);
    const [g] = grouped.get('01');
    expect(g).toEqual({ id: '01A3', type: 'x', block: 'A', position: 3 });
  });

  it('drops gene IDs that do not match the canonical pattern', () => {
    const loci = new Map([
      ['01A1', 'D'],
      ['nonsense', 'R'],
      ['', 'x'],
    ]);
    const grouped = groupLociByChromosome(loci);
    expect(grouped.size).toBe(1);
    expect(grouped.get('01').map((g) => g.id)).toEqual(['01A1']);
  });

  it('returns an empty map for an empty PetLoci', () => {
    const grouped = groupLociByChromosome(new Map());
    expect(grouped.size).toBe(0);
  });
});
