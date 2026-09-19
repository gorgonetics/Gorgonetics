import { beforeEach, describe, expect, it } from 'vitest';
import { closeDatabase, getDb, initDatabase } from '$lib/services/database.js';
import * as geneService from '$lib/services/geneService.js';
import { runMigrations } from '$lib/services/migrationService.js';
import * as petService from '$lib/services/petService.js';
import {
  clearStudyCorpus,
  loadStudyCorpus,
  namesForSubjects,
  runAttributeStudy,
  studyCorpusStatus,
} from '$lib/services/studyService.js';

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
    await upload(name('Kb', 40, 80, 'A'), 'RRRR');
    await upload(name('Kb', 40, 80, 'B'), 'RRDR');
    await upload(name('Kb', 45, 80, 'C'), 'DRRR');
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

    await clearStudyCorpus('horse');
    expect((await studyCorpusStatus('horse')).cached).toBe(0);
  });

  it('resolves a cached animal back to its name for the evidence panel', async () => {
    await cache('h1', name('Kb', 40, 80, 'Shared'), 'RRRR', attrs(40, 80));
    const names = await namesForSubjects(['shared:h1']);
    expect(names.get('shared:h1')).toBe(name('Kb', 40, 80, 'Shared'));
  });
});
