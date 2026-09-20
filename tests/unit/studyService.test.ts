import { beforeEach, describe, expect, it, vi } from 'vitest';

// The catalogue is a network read; stub it so the refresh path can be
// exercised against the real cache table.
vi.mock('$lib/services/shareService.js', () => ({
  listPets: vi.fn(),
  listGenomes: vi.fn(),
}));

import { closeDatabase, getDb, initDatabase } from '$lib/services/database.js';
import * as geneService from '$lib/services/geneService.js';
import { runMigrations } from '$lib/services/migrationService.js';
import * as petService from '$lib/services/petService.js';
import * as shareService from '$lib/services/shareService.js';
import {
  attributeMagnitudesFor,
  clearAttributeMagnitudesCache,
  loadStudyCorpus,
  namesForSubjects,
  peekAttributeMagnitudes,
  refreshStudyCorpus,
  runAttributeStudy,
  STUDYABLE_SPECIES,
  studyCorpusStatus,
} from '$lib/services/studyService.js';
import { coverageOf, EMPTY_MAGNITUDES, hasMagnitudes, magnitudeOf } from '$lib/utils/attributePoints.js';
import { sha256Hex } from '$lib/utils/hash.js';

/**
 * Four horse loci on chromosome 01. `01A1` is generic, `01A4` belongs to
 * Kurbone, so a Paint animal must never be scored against it.
 */
const GENES: Array<[string, { effectDominant?: string; effectRecessive?: string; breed?: string }]> = [
  ['01A1', { effectDominant: 'Temperament+', breed: '' }],
  ['01A2', { effectDominant: 'Temperament-', breed: '' }],
  ['01A3', { effectRecessive: 'Toughness-', breed: '' }],
  ['01A4', { effectDominant: 'Temperament+', breed: 'Kurbone' }],
];

/**
 * A horse genome file. `entity` doubles as the pet name, and the importer
 * reads its attributes from there — which is exactly what eligibility
 * turns on.
 */
function genome(entity: string, genes: string): string {
  return `[Overview]
Format=1.0
Character=Tester
Entity=${entity}
Genome=Horse

[Genes]
1=${genes}
`;
}

async function upload(entity: string, genes: string): Promise<number> {
  const result = await petService.uploadPet(genome(entity, genes));
  const petId = (result as { pet_id?: number }).pet_id;
  if (!petId) throw new Error(`upload failed for ${entity}: ${JSON.stringify(result)}`);
  return petId;
}

/** Name in the structured format: Temperament first, Toughness second. */
function name(breed: string, temperament: number, toughness: number, label = ''): string {
  // Ruggedness, Enthusiasm, Friendliness, Intelligence, Virility are held
  // constant; only the two attributes under test vary.
  return `${breed} F ${temperament} ${toughness} 70 70 70 70 70${label ? ` ${label}` : ''}`;
}

beforeEach(async () => {
  await closeDatabase();
  await initDatabase();
  await runMigrations();
  geneService.clearGeneEffectsCache();
  for (const [gene, data] of GENES) await geneService.upsertGene('horse', '01', gene, data);
});

describe('loadStudyCorpus', () => {
  it('admits an animal whose name carries real readings', async () => {
    await upload(name('Kb', 40, 80), 'RRRR');
    const corpus = await loadStudyCorpus('horse');
    expect(corpus.subjects).toHaveLength(1);
    expect(corpus.subjects[0]).toMatchObject({ breed: 'Kurbone' });
    expect(corpus.subjects[0].attributes.temperament).toBe(40);
    expect(corpus.subjects[0].attributes.toughness).toBe(80);
  });

  it('excludes an animal whose name does not parse, because its attributes are defaults', async () => {
    // `importGenomeFile` falls back to DEFAULT_ATTRIBUTE_VALUE here, so
    // every attribute reads 50 without ever having been measured.
    await upload('Just A Horse', 'RRRR');
    const corpus = await loadStudyCorpus('horse');
    expect(corpus.subjects).toEqual([]);
    expect(corpus.excluded).toContainEqual({ reason: 'unmeasured', count: 1 });
  });

  it('excludes an animal with an unrevealed locus by default', async () => {
    await upload(name('Kb', 40, 80), 'RR?R');
    const corpus = await loadStudyCorpus('horse');
    expect(corpus.subjects).toEqual([]);
    expect(corpus.excluded).toContainEqual({ reason: 'unrevealed', count: 1 });
  });

  it('keeps unrevealed animals when asked, since the engine withdraws them per attribute', async () => {
    await upload(name('Kb', 40, 80), 'RR?R');
    const corpus = await loadStudyCorpus('horse', { requireFullGenome: false });
    expect(corpus.subjects).toHaveLength(1);
  });

  it('reports what it dropped and how many it looked at', async () => {
    await upload(name('Kb', 40, 80), 'RRRR');
    await upload('Unparseable One', 'RRRR');
    await upload('Unparseable Two', 'RRRR');
    const corpus = await loadStudyCorpus('horse');
    expect(corpus.considered).toBe(3);
    expect(corpus.subjects).toHaveLength(1);
    expect(corpus.excluded).toEqual([{ reason: 'unmeasured', count: 2 }]);
  });

  it('excludes a genome missing a locus the gene table declares', async () => {
    // Three loci stored, but the table declares an effect on 01A4 too — a
    // truncated projection, not an unrevealed allele. Silently withdrawing
    // it would still count the animal among those studied.
    await upload(name('Kb', 40, 80, 'Short'), 'RRR');
    // `runAttributeStudy` is what supplies the declared loci; the lower-level
    // loader has no opinion without them.
    const run = await runAttributeStudy('horse');
    expect(run.corpus.subjects).toEqual([]);
    expect(run.corpus.excluded).toContainEqual({ reason: 'incomplete', count: 1 });
  });

  it('does not call a complete genome incomplete', async () => {
    await upload(name('Kb', 40, 80, 'Full'), 'RRRR');
    const corpus = await loadStudyCorpus('horse', {
      requiredGenes: ['01A1', '01A2', '01A3', '01A4'],
    });
    expect(corpus.subjects).toHaveLength(1);
  });

  it('excludes a Mixed-breed animal, whose breed-locked genes are unknowable', async () => {
    // Elsewhere the app lets Mixed pass every breed-locked gene; inference
    // cannot, since that would credit one animal with ten breeds' effects.
    const id = await upload(name('Kb', 40, 80, 'Mongrel'), 'RRRR');
    await petService.updatePet(id, { breed: 'Mixed' });

    const corpus = await loadStudyCorpus('horse');
    expect(corpus.subjects).toEqual([]);
    expect(corpus.excluded).toContainEqual({ reason: 'mixed-breed', count: 1 });
  });

  it('offers only species it can actually measure', async () => {
    // `parseStructuredPetName` parses horses alone, so any other species
    // would give a permanently empty study blaming the animals for it.
    expect([...STUDYABLE_SPECIES]).toEqual(['horse']);
  });

  it('scopes to one species', async () => {
    await upload(name('Kb', 40, 80), 'RRRR');
    const corpus = await loadStudyCorpus('beewasp');
    expect(corpus.subjects).toEqual([]);
    expect(corpus.considered).toBe(0);
  });
});

describe('stabled subjects', () => {
  it('carries the stabled flag, which is what makes a reading checkable', async () => {
    // Every pet inserts with `stabled = 1` (petService), so the distinction
    // only appears once the player releases one.
    const stabled = await upload(name('Kb', 40, 80, 'Stabled'), 'RRRR');
    const loose = await upload(name('Kb', 45, 80, 'Loose'), 'DRRR');
    await petService.updatePet(loose, { stabled: false });

    const corpus = await loadStudyCorpus('horse');
    const byId = new Map(corpus.subjects.map((s) => [s.id, s]));
    expect(byId.get(String(stabled))?.stabled).toBe(true);
    expect(byId.get(String(loose))?.stabled).toBe(false);
  });

  it('flags a contradiction the player can settle', async () => {
    // Two sound carriers, so +5 wins outright; a 2-2 split would leave the
    // slot unresolved and there would be no contradiction to flag.
    await upload(name('Kb', 40, 80, 'A'), 'RRRR');
    await upload(name('Kb', 40, 80, 'B'), 'RRDR');
    await upload(name('Kb', 45, 80, 'C'), 'DRRR');
    // `x` expresses as dominant, so C2 has the same active set as C while
    // being a distinct genome (an identical one would dedupe on hash).
    await upload(name('Kb', 45, 80, 'C2'), 'xRRR');
    const bad = await upload(name('Kb', 90, 80, 'Bad'), 'DRDR');

    const run = await runAttributeStudy('horse');
    const flagged = run.studies.flatMap((s) => s.contradictions).filter((c) => c.subjectId === String(bad));
    expect(flagged.length).toBeGreaterThan(0);
    expect(flagged.every((c) => c.stabled)).toBe(true);
  });
});

describe('runAttributeStudy', () => {
  it('pins a magnitude end-to-end from two uploaded animals', async () => {
    // Identical but for 01A1, five temperament points apart.
    await upload(name('Kb', 45, 80, 'With'), 'DRRR');
    await upload(name('Kb', 40, 80, 'Without'), 'RRRR');

    const run = await runAttributeStudy('horse');
    const temperament = run.studies.find((s) => s.attribute === 'temperament');
    expect(temperament?.findings).toHaveLength(1);
    expect(temperament?.findings[0]).toMatchObject({
      gene: '01A1',
      expression: 'dominant',
      magnitude: 5,
      tier: 'direct',
    });
    expect(run.totals).toMatchObject({ found: 1, direct: 1, derived: 0 });
  });

  it('never scores a Kurbone-only gene against a Paint animal', async () => {
    // Both Paints differ at 01A4, which Paint does not carry. Their equal
    // temperament is therefore consistent, and no finding may be invented.
    await upload(name('Pt', 40, 80, 'One'), 'RRRD');
    await upload(name('Pt', 40, 80, 'Two'), 'RRRR');

    const run = await runAttributeStudy('horse');
    const temperament = run.studies.find((s) => s.attribute === 'temperament');
    expect(temperament?.findings).toEqual([]);
  });

  it('solves each attribute from its own projection of the same pair', async () => {
    // The pair differs at 01A1 (temperament) and 01A3 (toughness) at once.
    // 01A3 is recessive-negative, so B — the one carrying `R` — is the
    // animal that expresses it and takes the point off.
    await upload(name('Kb', 45, 80, 'A'), 'DRDR');
    await upload(name('Kb', 40, 79, 'B'), 'RRRR');

    const run = await runAttributeStudy('horse');
    const byAttribute = new Map(run.studies.map((s) => [s.attribute, s]));
    expect(byAttribute.get('temperament')?.findings[0]).toMatchObject({ gene: '01A1', magnitude: 5 });
    expect(byAttribute.get('toughness')?.findings[0]).toMatchObject({ gene: '01A3', magnitude: -1 });
  });

  it('pools validation across attributes', async () => {
    await upload(name('Kb', 40, 80, 'Base'), 'RRRR');
    await upload(name('Kb', 45, 80, 'A1'), 'DRRR');
    await upload(name('Kb', 37, 80, 'A2'), 'RDRR');
    await upload(name('Kb', 42, 80, 'Both'), 'DDRR');

    const run = await runAttributeStudy('horse');
    expect(run.validation.tested).toBeGreaterThan(0);
    expect(run.validation.exact).toBe(run.validation.tested);
  });

  it('returns a well-formed run on an empty database', async () => {
    const run = await runAttributeStudy('horse');
    expect(run.corpus.subjects).toEqual([]);
    expect(run.totals).toMatchObject({ found: 0, direct: 0, derived: 0 });
    expect(run.totals.slots).toBeGreaterThan(0);
    expect(run.validation).toEqual({ tested: 0, exact: 0, stabledTested: 0, stabledExact: 0 });
  });
});

describe('attributeMagnitudesFor', () => {
  beforeEach(() => clearAttributeMagnitudesCache());

  it('hands the scorers the magnitudes the study found, with coverage', async () => {
    await upload(name('Kb', 45, 80, 'With'), 'DRRR');
    await upload(name('Kb', 40, 80, 'Without'), 'RRRR');

    const magnitudes = await attributeMagnitudesFor('horse');
    expect(magnitudeOf(magnitudes, '01A1', 'dominant')).toBe(5);
    expect(coverageOf(magnitudes, 'Temperament')).toMatchObject({ known: 1 });
    expect(coverageOf(magnitudes, 'Temperament').total).toBeGreaterThan(1);
  });

  it('memoises per species, and drops the memo when the corpus is refreshed', async () => {
    await upload(name('Kb', 45, 80, 'With'), 'DRRR');
    await upload(name('Kb', 40, 80, 'Without'), 'RRRR');

    const first = await attributeMagnitudesFor('horse');
    expect(await attributeMagnitudesFor('Horse')).toBe(first);

    // A third animal pins a second magnitude — 01A3 is recessive-negative,
    // so the one *not* carrying `R` is the tougher of the two. The memo is
    // what the scorers read, though, until something invalidates it.
    await upload(name('Kb', 40, 83, 'ToughA'), 'RRDR');
    expect(await attributeMagnitudesFor('horse')).toBe(first);

    clearAttributeMagnitudesCache('horse');
    const second = await attributeMagnitudesFor('horse');
    expect(second).not.toBe(first);
    expect(magnitudeOf(second, '01A3', 'recessive')).toBeDefined();
  });

  it('is empty for a species with no measurement path, without touching the corpus', async () => {
    const magnitudes = await attributeMagnitudesFor('beewasp');
    expect(magnitudes).toBe(EMPTY_MAGNITUDES);
    expect(hasMagnitudes(magnitudes)).toBe(false);
  });

  it('re-solves after a local edit, which revises a reading rather than adding one', async () => {
    await upload(name('Kb', 45, 80, 'With'), 'DRRR');
    const withoutId = await upload(name('Kb', 40, 80, 'Without'), 'RRRR');

    const first = await attributeMagnitudesFor('horse');
    expect(magnitudeOf(first, '01A1', 'dominant')).toBe(5);

    // Correcting a reading does not add an equation — it replaces the one
    // this animal already supplied. The gap widens from 5 to 9, and the memo
    // has to follow or the Breeding tab keeps scoring against the old value.
    await petService.updatePet(withoutId, { attributes: { temperament: 36 } });

    const second = await attributeMagnitudesFor('horse');
    expect(second).not.toBe(first);
    expect(magnitudeOf(second, '01A1', 'dominant')).toBe(9);
  });

  it('re-solves after a rename, which is what decides whether an animal is a subject at all', async () => {
    await upload(name('Kb', 45, 80, 'With'), 'DRRR');
    const withoutId = await upload(name('Kb', 40, 80, 'Without'), 'RRRR');

    const first = await attributeMagnitudesFor('horse');
    expect(magnitudeOf(first, '01A1', 'dominant')).toBe(5);

    // Eligibility turns on the name parsing, so a rename out of the
    // structured format withdraws the animal — and with it the only
    // equation the magnitude rested on.
    await petService.updatePet(withoutId, { name: 'Dobbin' });

    const second = await attributeMagnitudesFor('horse');
    expect(second).not.toBe(first);
    expect(magnitudeOf(second, '01A1', 'dominant')).toBeUndefined();
  });

  it('re-solves after a delete, which withdraws the equations that animal supported', async () => {
    await upload(name('Kb', 45, 80, 'With'), 'DRRR');
    const withoutId = await upload(name('Kb', 40, 80, 'Without'), 'RRRR');

    const first = await attributeMagnitudesFor('horse');
    expect(magnitudeOf(first, '01A1', 'dominant')).toBe(5);

    await petService.deletePet(withoutId);

    const second = await attributeMagnitudesFor('horse');
    expect(second).not.toBe(first);
    expect(magnitudeOf(second, '01A1', 'dominant')).toBeUndefined();
  });
});

describe('peekAttributeMagnitudes', () => {
  beforeEach(() => clearAttributeMagnitudesCache());

  it('is undefined until the study has solved, so a caller can render without waiting', async () => {
    await upload(name('Kb', 45, 80, 'With'), 'DRRR');
    await upload(name('Kb', 40, 80, 'Without'), 'RRRR');

    expect(peekAttributeMagnitudes('horse')).toBeUndefined();

    const solved = await attributeMagnitudesFor('horse');
    expect(peekAttributeMagnitudes('horse')).toBe(solved);
    // Case-insensitive on the species, exactly as the memo is.
    expect(peekAttributeMagnitudes('Horse')).toBe(solved);
  });

  it('goes back to undefined once a local edit has invalidated the memo', async () => {
    await upload(name('Kb', 45, 80, 'With'), 'DRRR');
    const withoutId = await upload(name('Kb', 40, 80, 'Without'), 'RRRR');
    await attributeMagnitudesFor('horse');
    expect(peekAttributeMagnitudes('horse')).toBeDefined();

    await petService.updatePet(withoutId, { attributes: { temperament: 36 } });
    expect(peekAttributeMagnitudes('horse')).toBeUndefined();
  });

  it('is the empty table, not undefined, for a species that can never be measured', () => {
    // "Not ready" and "nothing to know" are different answers: a caller that
    // confused them would keep waiting for a solve that will never run.
    expect(peekAttributeMagnitudes('beewasp')).toBe(EMPTY_MAGNITUDES);
  });
});

describe('namesForSubjects', () => {
  it('resolves subject ids back to pet names', async () => {
    const id = await upload(name('Kb', 40, 80, 'Named'), 'RRRR');
    const names = await namesForSubjects([String(id)]);
    expect(names.get(String(id))).toBe(name('Kb', 40, 80, 'Named'));
  });

  it('is empty rather than throwing on ids that are not numbers', async () => {
    expect(await namesForSubjects(['not-an-id'])).toEqual(new Map());
  });
});

describe('cached community animals', () => {
  /** Insert straight into the cache; the fetch itself is exercised elsewhere. */
  async function cache(hash: string, entity: string, genes: string, attrs: Record<string, number>) {
    // Every value is a named placeholder: the in-memory adapter binds an
    // INSERT's params by position, so mixing literals into VALUES shifts
    // every later column onto the wrong param.
    await getDb().execute(
      `INSERT OR REPLACE INTO study_corpus
       (content_hash, species, breed, name, attributes, genome_text, fetched_at)
       VALUES ($hash, $species, $breed, $name, $attributes, $genome, $fetched)`,
      {
        hash,
        species: 'horse',
        breed: 'Kurbone',
        name: entity,
        attributes: JSON.stringify(attrs),
        genome: genome(entity, genes),
        fetched: '2026-09-19T00:00:00Z',
      },
    );
  }

  const attrs = (temperament: number, toughness: number) => ({
    temperament,
    toughness,
    ruggedness: 70,
    enthusiasm: 70,
    friendliness: 70,
    intelligence: 70,
    virility: 70,
  });

  it('studies a cached animal without putting it in the roster', async () => {
    await cache('h1', name('Kb', 40, 80, 'Shared'), 'RRRR', attrs(40, 80));
    const corpus = await loadStudyCorpus('horse');
    expect(corpus.subjects).toHaveLength(1);
    expect(corpus.subjects[0].id).toMatch(/^shared:/);
    const { items } = await petService.getAllPets();
    expect(items).toEqual([]);
  });

  it('never marks a community animal checkable', async () => {
    // You cannot re-read someone else's animal in the game.
    await cache('h1', name('Kb', 40, 80, 'Shared'), 'RRRR', attrs(40, 80));
    const corpus = await loadStudyCorpus('horse');
    expect(corpus.subjects[0].stabled).toBe(false);
  });

  it('drops a cached copy of an animal the player already owns', async () => {
    // The same genome twice would pair with itself, and two records that
    // disagree would read as a contradiction between an animal and itself.
    const id = await upload(name('Kb', 40, 80, 'Mine'), 'RRRR');
    const pet = await petService.getPet(id);
    await cache(pet?.content_hash ?? 'x', name('Kb', 99, 80, 'Theirs'), 'RRRR', attrs(99, 80));

    const corpus = await loadStudyCorpus('horse');
    expect(corpus.subjects).toHaveLength(1);
    expect(corpus.subjects[0].attributes.temperament).toBe(40);
  });

  it('pairs a cached animal with a local one to pin a magnitude', async () => {
    await upload(name('Kb', 40, 80, 'Local'), 'RRRR');
    await cache('h2', name('Kb', 45, 80, 'Shared'), 'DRRR', attrs(45, 80));

    const run = await runAttributeStudy('horse');
    const temperament = run.studies.find((s) => s.attribute === 'temperament');
    expect(temperament?.findings[0]).toMatchObject({ gene: '01A1', magnitude: 5 });
    // Mixed local/community pair: not something the player can settle.
    expect(run.validation.stabledTested).toBe(0);
  });

  it('scopes the cache by species and reports its freshness', async () => {
    await cache('h1', name('Kb', 40, 80, 'Shared'), 'RRRR', attrs(40, 80));
    expect(await studyCorpusStatus('horse')).toMatchObject({ cached: 1 });
    expect((await studyCorpusStatus('beewasp')).cached).toBe(0);
  });

  it('resolves a cached animal back to its name for the evidence panel', async () => {
    await cache('h1', name('Kb', 40, 80, 'Shared'), 'RRRR', attrs(40, 80));
    const names = await namesForSubjects(['shared:h1']);
    expect(names.get('shared:h1')).toBe(name('Kb', 40, 80, 'Shared'));
  });
});

describe('refreshStudyCorpus', () => {
  const ATTRS = {
    temperament: 40,
    toughness: 80,
    ruggedness: 70,
    enthusiasm: 70,
    friendliness: 70,
    intelligence: 70,
    virility: 70,
  };

  /** A catalogue entry as `listPets` would return it. */
  function shared(hash: string, over: Record<string, unknown> = {}) {
    return {
      contentHash: hash,
      name: name('Kb', 40, 80, hash),
      character: 'Tester',
      species: 'Horse',
      gender: 'Female',
      breed: 'Kurbone',
      breeder: 'Tester',
      notes: '',
      tags: [],
      attributes: { ...ATTRS },
      schemaVersion: 1,
      appVersion: '1.0',
      uploadedAt: new Date('2026-09-19T00:00:00Z'),
      uploaderUid: null,
      ...over,
    };
  }

  function mockCatalogue(pets: unknown[], genomes: Record<string, string>) {
    vi.mocked(shareService.listPets).mockResolvedValue({ pets, cursor: null } as never);
    vi.mocked(shareService.listGenomes).mockResolvedValue({
      genomes: Object.entries(genomes).map(([contentHash, genomeData]) => ({ contentHash, genomeData })),
      cursor: null,
    } as never);
  }

  /**
   * A genome and the hash it is actually filed under. The refresh verifies
   * the digest — nothing server-side can — so a fixture with a made-up hash
   * is rejected exactly as a tampered blob would be.
   */
  async function entry(entityName: string, genes: string): Promise<{ hash: string; text: string }> {
    const text = genome(entityName, genes);
    return { hash: await sha256Hex(text), text };
  }

  it('keeps the correction, not the entry it supersedes', async () => {
    // The catalogue is add-only and paged newest-first, so the correction
    // arrives before the base. Keeping the last one seen would cache the
    // very attributes the uploader published a correction to fix.
    const g = await entry(name('Kb', 40, 80, 'Fixed'), 'RRRR');
    const correction = shared(g.hash, {
      attributes: { ...ATTRS, temperament: 40 },
      name: name('Kb', 40, 80, 'Fixed'),
      isCorrection: true,
    });
    const base = shared(g.hash, { attributes: { ...ATTRS, temperament: 90 }, name: name('Kb', 90, 80, 'Typo') });
    mockCatalogue([correction, base], { [g.hash]: g.text });

    await refreshStudyCorpus('horse');

    const corpus = await loadStudyCorpus('horse');
    expect(corpus.subjects).toHaveLength(1);
    expect(corpus.subjects[0].attributes.temperament).toBe(40);
  });

  it('drops entries the catalogue no longer serves', async () => {
    const a = await entry(name('Kb', 40, 80, 'a'), 'RRRR');
    const b = await entry(name('Kb', 41, 80, 'b'), 'DRRR');
    mockCatalogue(
      [shared(a.hash, { name: name('Kb', 40, 80, 'a') }), shared(b.hash, { name: name('Kb', 41, 80, 'b') })],
      {
        [a.hash]: a.text,
        [b.hash]: b.text,
      },
    );
    await refreshStudyCorpus('horse');
    expect((await studyCorpusStatus('horse')).cached).toBe(2);

    // b withdrawn upstream: an insert-only refresh would keep feeding it.
    mockCatalogue([shared(a.hash, { name: name('Kb', 40, 80, 'a') })], { [a.hash]: a.text });
    await refreshStudyCorpus('horse');
    expect((await studyCorpusStatus('horse')).cached).toBe(1);
  });

  it('refuses a genome that does not hash to the id it is filed under', async () => {
    // Nothing server-side can check this: `/genomes/{id}` takes
    // unauthenticated writes and Firestore rules cannot compute a digest.
    const good = await entry(name('Kb', 40, 80, 'good'), 'RRRR');
    const tampered = await entry(name('Kb', 41, 80, 'other'), 'DRRR');
    mockCatalogue(
      [
        shared(good.hash, { name: name('Kb', 40, 80, 'good') }),
        shared(tampered.hash, { name: name('Kb', 41, 80, 'other') }),
      ],
      { [good.hash]: good.text, [tampered.hash]: good.text }, // second blob filed under the wrong hash
    );

    const result = await refreshStudyCorpus('horse');
    expect(result).toMatchObject({ cached: 1, unverified: 1 });
  });

  it('skips an entry whose attributes were never measured', async () => {
    // Attributes are present and well-formed; the name is what betrays them
    // as the importer's defaults rather than readings.
    const wild = await entry('Wild Horse', 'RRRR');
    const ok = await entry(name('Kb', 41, 80, 'ok'), 'DRRR');
    mockCatalogue([shared(wild.hash, { name: 'Wild Horse' }), shared(ok.hash, { name: name('Kb', 41, 80, 'ok') })], {
      [wild.hash]: wild.text,
      [ok.hash]: ok.text,
    });
    const result = await refreshStudyCorpus('horse');
    expect(result).toMatchObject({ cached: 1, skipped: 1 });
  });

  it('caches nothing for a species with no entries', async () => {
    const g = await entry(name('Kb', 40, 80, 'x'), 'RRRR');
    mockCatalogue([shared(g.hash, { species: 'BeeWasp' })], { [g.hash]: g.text });
    const result = await refreshStudyCorpus('horse');
    expect(result).toMatchObject({ considered: 0, cached: 0 });
  });
});
