import { beforeEach, describe, expect, it, vi } from 'vitest';

// The catalogue is a network read; stub it so the refresh path can be
// exercised against the real cache table.
vi.mock('$lib/services/shareService.js', () => ({
  listPets: vi.fn(),
  listGenomes: vi.fn(),
}));

import { closeDatabase, getDb, initDatabase } from '$lib/services/database.js';
import * as geneService from '$lib/services/geneService.js';
import { parseGenome } from '$lib/services/genomeParser.js';
import { runMigrations } from '$lib/services/migrationService.js';
import * as petService from '$lib/services/petService.js';
import * as shareService from '$lib/services/shareService.js';
import {
  attributeMagnitudesFor,
  clearAttributeMagnitudesCache,
  confirmGeneDeclaration,
  listExcludedSubjects,
  liveGeneConfirmations,
  loadStudyCorpus,
  namesForSubjects,
  peekAttributeMagnitudes,
  type RefreshProgress,
  refreshStudyCorpus,
  runAttributeStudy,
  STUDYABLE_SPECIES,
  setUseForStudies,
  studyCorpusStatus,
  withdrawGeneConfirmation,
} from '$lib/services/studyService.js';
import { coverageOf, EMPTY_MAGNITUDES, hasMagnitudes, magnitudeOf } from '$lib/utils/attributePoints.js';
import { buildEffectSlots } from '$lib/utils/attributeStudy.js';
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

  it('keeps an animal renamed out of the structured format, whose readings are stored', async () => {
    // The name is how the readings were recorded, not where they live. A
    // player renaming a horse used to drop it from the corpus (#526).
    const petId = await upload(name('Kb', 40, 80), 'RRRR');
    await petService.updatePet(petId, { name: 'Dobbin' });

    const corpus = await loadStudyCorpus('horse');
    expect(corpus.subjects).toHaveLength(1);
    expect(corpus.subjects[0].attributes.temperament).toBe(40);
  });

  it('admits an animal whose attributes were typed in by hand', async () => {
    // Imported under a name that does not parse, so every attribute was the
    // importer's default. Entering the real values in the editor makes them
    // readings — which is what the player sees, and used to be told was
    // "attributes never recorded" (#526).
    const petId = await upload('Just A Horse', 'RRRR');
    expect((await loadStudyCorpus('horse')).subjects).toEqual([]);

    await petService.updatePet(petId, {
      breed: 'Kurbone',
      attributes: { temperament: 40, toughness: 80 },
    });

    const corpus = await loadStudyCorpus('horse');
    expect(corpus.subjects).toHaveLength(1);
    expect(corpus.subjects[0]).toMatchObject({ breed: 'Kurbone' });
    expect(corpus.subjects[0].attributes.temperament).toBe(40);
  });

  it('takes a caller at its word when it says the values it wrote are not readings', async () => {
    // The shape `importCommunityPet` writes: someone else's attribute
    // columns, copied wholesale, which are that player's defaults when they
    // never measured either. The write is not evidence of a reading here and
    // the caller says so, or the corpus fills with 50s dressed as data.
    const petId = await upload('Just A Horse', 'RRRR');
    await petService.updatePet(petId, {
      breed: 'Kurbone',
      attributes: { temperament: 50, toughness: 50 },
      attributes_measured: false,
    });

    const corpus = await loadStudyCorpus('horse');
    expect(corpus.subjects).toEqual([]);
    expect(corpus.excluded).toContainEqual({ reason: 'unmeasured', count: 1 });
  });

  it('does not call an animal measured because some other field was edited', async () => {
    // Only an attribute write is evidence of a reading. A rename, a star or
    // a tag says nothing about the eight 50s this animal was imported with.
    const petId = await upload('Just A Horse', 'RRRR');
    await petService.updatePet(petId, { breed: 'Kurbone', starred: true, name: 'Dobbin' });

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

  it('offers every species with a measurement path', async () => {
    // Stored provenance, not the horse-only name parser, is the gate since
    // #527, so a beewasp measured by hand or through the catalogue counts.
    expect([...STUDYABLE_SPECIES]).toEqual(['horse', 'beewasp']);
  });

  it('scopes to one species', async () => {
    await upload(name('Kb', 40, 80), 'RRRR');
    const corpus = await loadStudyCorpus('beewasp');
    expect(corpus.subjects).toEqual([]);
    expect(corpus.considered).toBe(0);
  });
});

describe('a species without breeds', () => {
  const BEE_GENES: Array<[string, { effectDominant?: string; effectRecessive?: string }]> = [
    ['01A1', { effectDominant: 'Ferocity+' }],
    ['01A2', {}],
    ['01A3', {}],
    ['01A4', {}],
  ];

  function beeGenome(entity: string, genes: string): string {
    return genome(entity, genes).replace('Genome=Horse', 'Genome=BeeWasp');
  }

  async function bee(entity: string, genes: string, ferocity: number, breed = ''): Promise<number> {
    const result = await petService.uploadPet(beeGenome(entity, genes));
    const petId = (result as { pet_id?: number }).pet_id;
    if (!petId) throw new Error(`upload failed for ${entity}: ${JSON.stringify(result)}`);
    // No structured-name rule exists for beewasps, so readings arrive by hand.
    await petService.updatePet(petId, { breed, attributes: { ferocity } });
    return petId;
  }

  beforeEach(async () => {
    for (const [gene, data] of BEE_GENES) await geneService.upsertGene('beewasp', '01', gene, { ...data, breed: '' });
  });

  it('admits a hand-measured animal with no breed', async () => {
    await bee('Buzz', 'RRRR', 40);
    const corpus = await loadStudyCorpus('beewasp');
    expect(corpus.subjects).toHaveLength(1);
    expect(corpus.subjects[0]).toMatchObject({ breed: '' });
    expect(corpus.subjects[0].attributes.ferocity).toBe(40);
  });

  it('pairs every animal in one pool, whatever its breed field says', async () => {
    // Nothing in the beewasp gene table is breed-locked, so a Bee and a Wasp
    // share the attribute base and their difference isolates the locus.
    await bee('Low', 'RRRR', 40, 'Bee');
    await bee('High', 'DRRR', 45, 'Wasp');
    const run = await runAttributeStudy('beewasp');
    const ferocity = run.studies.find((study) => study.attribute === 'ferocity');
    expect(ferocity?.findings[0]).toMatchObject({ gene: '01A1', expression: 'dominant', magnitude: 5 });
  });

  it('still requires a breed where the gene table is breed-scoped', async () => {
    const petId = await upload('Just A Horse', 'RRRR');
    await petService.updatePet(petId, { attributes: { temperament: 40 } });
    const corpus = await loadStudyCorpus('horse');
    expect(corpus.subjects).toEqual([]);
    expect(corpus.excluded).toContainEqual({ reason: 'no-breed', count: 1 });
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
    const magnitudes = await attributeMagnitudesFor('dragon');
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

  it('keeps its answer through a rename, which is not a study input', async () => {
    await upload(name('Kb', 45, 80, 'With'), 'DRRR');
    const withoutId = await upload(name('Kb', 40, 80, 'Without'), 'RRRR');

    const first = await attributeMagnitudesFor('horse');
    expect(magnitudeOf(first, '01A1', 'dominant')).toBe(5);

    // The name recorded the readings at import; the readings themselves are
    // in the columns now. Renaming used to withdraw the animal and take the
    // magnitude with it (#526).
    await petService.updatePet(withoutId, { name: 'Dobbin' });

    expect(magnitudeOf(await attributeMagnitudesFor('horse'), '01A1', 'dominant')).toBe(5);
  });

  it('re-solves after a gene-table edit, which revises the question rather than the answer', async () => {
    await upload(name('Kb', 45, 80, 'With'), 'DRRR');
    await upload(name('Kb', 40, 80, 'Without'), 'RRRR');

    const first = await attributeMagnitudesFor('horse');
    expect(magnitudeOf(first, '01A1', 'dominant')).toBe(5);
    expect(coverageOf(first, 'Temperament').known).toBe(1);

    // Findings are keyed by `gene:expression`, and which attribute a slot
    // belongs to is re-derived from the declarations at scoring time. Re-point
    // 01A1's dominant slot and the old magnitude would be applied to
    // Toughness — a wrong number, not a missing one.
    await geneService.upsertGene('horse', '01', '01A1', { effectDominant: 'Toughness+', breed: '' });
    geneService.clearGeneEffectsCache('horse');

    const second = await attributeMagnitudesFor('horse');
    expect(second).not.toBe(first);
    expect(coverageOf(second, 'Temperament').known).toBe(0);
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

describe('persisted magnitudes', () => {
  beforeEach(() => clearAttributeMagnitudesCache());

  /** A new session: the in-memory memo is gone, the database is not. */
  const newSession = () => clearAttributeMagnitudesCache();

  it('survives a session, so the solve is paid for once', async () => {
    await upload(name('Kb', 45, 80, 'With'), 'DRRR');
    await upload(name('Kb', 40, 80, 'Without'), 'RRRR');
    const first = await attributeMagnitudesFor('horse');
    expect(magnitudeOf(first, '01A1', 'dominant')).toBe(5);

    newSession();
    const second = await attributeMagnitudesFor('horse');
    // A different object — it came back through JSON — carrying the same
    // answer, which is the whole point of persisting it.
    expect(second).not.toBe(first);
    expect(magnitudeOf(second, '01A1', 'dominant')).toBe(5);
    expect(coverageOf(second, 'Temperament')).toEqual(coverageOf(first, 'Temperament'));
  });

  it('re-solves when a reading changes, across sessions', async () => {
    await upload(name('Kb', 45, 80, 'With'), 'DRRR');
    const withoutId = await upload(name('Kb', 40, 80, 'Without'), 'RRRR');
    expect(magnitudeOf(await attributeMagnitudesFor('horse'), '01A1', 'dominant')).toBe(5);

    await petService.updatePet(withoutId, { attributes: { temperament: 36 } });
    newSession();
    // The in-memory revision counters reset with the session, so only the
    // fingerprint can catch this — which is the reason it exists.
    expect(magnitudeOf(await attributeMagnitudesFor('horse'), '01A1', 'dominant')).toBe(9);
  });

  it('re-solves when the gene table changes, across sessions', async () => {
    await upload(name('Kb', 45, 80, 'With'), 'DRRR');
    await upload(name('Kb', 40, 80, 'Without'), 'RRRR');
    expect(coverageOf(await attributeMagnitudesFor('horse'), 'Temperament').known).toBe(1);

    await geneService.upsertGene('horse', '01', '01A1', { effectDominant: 'Toughness+', breed: '' });
    geneService.clearGeneEffectsCache('horse');
    newSession();
    expect(coverageOf(await attributeMagnitudesFor('horse'), 'Temperament').known).toBe(0);
  });

  it('re-solves when an animal is excluded, across sessions', async () => {
    await upload(name('Kb', 45, 80, 'With'), 'DRRR');
    const withoutId = await upload(name('Kb', 40, 80, 'Without'), 'RRRR');
    expect(magnitudeOf(await attributeMagnitudesFor('horse'), '01A1', 'dominant')).toBe(5);

    await setUseForStudies('horse', String(withoutId), false);
    newSession();
    expect(magnitudeOf(await attributeMagnitudesFor('horse'), '01A1', 'dominant')).toBeUndefined();
  });

  it('keeps one row per species however many times it re-solves', async () => {
    await upload(name('Kb', 45, 80, 'With'), 'DRRR');
    const withoutId = await upload(name('Kb', 40, 80, 'Without'), 'RRRR');

    for (const temperament of [40, 36, 32, 30]) {
      await petService.updatePet(withoutId, { attributes: { temperament } });
      newSession();
      await attributeMagnitudesFor('horse');
    }

    // `INSERT OR REPLACE` only replaces if the adapter knows what identifies
    // a row. Without that it appends, `rows[0]` stays the oldest forever, and
    // the cache silently stops hitting while the table grows per solve.
    const rows = await getDb().select<Array<Record<string, unknown>>>('SELECT species FROM study_magnitudes');
    expect(rows.length).toBe(1);
  });

  it('re-solves when the genome changes, though the name and readings do not', async () => {
    await upload(name('Kb', 45, 80, 'With'), 'DRRR');
    const withoutId = await upload(name('Kb', 40, 80, 'Without'), 'RRRR');
    expect(magnitudeOf(await attributeMagnitudesFor('horse'), '01A1', 'dominant')).toBe(5);

    // Same name, same attributes, different alleles. `genome_data` holds the
    // *parsed* genome — handed the raw text, `updatePet` fails to parse it
    // and rewrites nothing, which is what an earlier version of this test
    // did and why it proved nothing.
    await petService.updatePet(withoutId, {
      genome_data: parseGenome(genome(name('Kb', 40, 80, 'Without'), 'DRRR')),
    });
    newSession();
    expect(magnitudeOf(await attributeMagnitudesFor('horse'), '01A1', 'dominant')).not.toBe(5);
  });

  it('re-solves when a genome rewrite leaves every gene count where it was', async () => {
    const withId = await upload(name('Kb', 45, 80, 'With'), 'DRRR');
    await upload(name('Kb', 40, 80, 'Without'), 'RRRR');
    expect(magnitudeOf(await attributeMagnitudesFor('horse'), '01A1', 'dominant')).toBe(5);

    const counts = async () =>
      (
        await getDb().select<Array<Record<string, unknown>>>(
          'SELECT positive_genes, total_genes, known_genes, unknown_genes FROM pets WHERE id = $id',
          { id: withId },
        )
      )[0];
    const before = await counts();

    // `RRRD` for `DRRR`: one `+` locus either way, four revealed genes
    // either way. `01A4` is Kurbone-locked and this animal is Kurbone, so
    // the swap moves the magnitude rather than dropping it. Nothing the
    // gene-count columns can see has moved — only the projection — so a
    // fingerprint built on those counts would serve the stale table.
    await petService.updatePet(withId, {
      genome_data: parseGenome(genome(name('Kb', 45, 80, 'With'), 'RRRD')),
    });
    expect(await counts()).toEqual(before);

    newSession();
    const after = await attributeMagnitudesFor('horse');
    expect(magnitudeOf(after, '01A1', 'dominant')).toBeUndefined();
    expect(magnitudeOf(after, '01A4', 'dominant')).toBe(5);
  });

  /**
   * Make one of the cache's own reads fail, and count the failures so the
   * test cannot pass by matching nothing if a query is later reworded.
   */
  const breakSelect = (match: RegExp) => {
    const db = getDb();
    const real = db.select.bind(db);
    let threw = 0;
    const spy = vi.spyOn(db, 'select').mockImplementation(async (query: string, bindValues?: unknown) => {
      if (match.test(query)) {
        threw++;
        throw new Error('database is locked');
      }
      return real(query, bindValues as never);
    });
    return { restore: () => spy.mockRestore(), count: () => threw };
  };

  it('solves anyway when the persisted table cannot be read', async () => {
    await upload(name('Kb', 45, 80, 'With'), 'DRRR');
    await upload(name('Kb', 40, 80, 'Without'), 'RRRR');

    // A part-applied migration leaves `study_magnitudes` missing. That must
    // cost a solve, not the whole feature: before this was guarded the error
    // reached the outer catch and every scorer ranked by counts for the rest
    // of the session.
    const broken = breakSelect(/study_magnitudes/i);
    try {
      expect(magnitudeOf(await attributeMagnitudesFor('horse'), '01A1', 'dominant')).toBe(5);
      expect(broken.count()).toBeGreaterThan(0);
    } finally {
      broken.restore();
    }
  });

  it('solves anyway when the fingerprint itself cannot be taken', async () => {
    await upload(name('Kb', 45, 80, 'With'), 'DRRR');
    await upload(name('Kb', 40, 80, 'Without'), 'RRRR');

    // Only the fingerprint's own unscoped projection read — the solver reads
    // `pet_genes` too, and breaking that would prove nothing.
    const broken = breakSelect(/^SELECT pet_id, gene_id, gene_type FROM pet_genes$/);
    try {
      expect(magnitudeOf(await attributeMagnitudesFor('horse'), '01A1', 'dominant')).toBe(5);
      expect(broken.count()).toBeGreaterThan(0);
    } finally {
      broken.restore();
    }

    // Nothing was written under a fingerprint that could not be taken.
    const rows = await getDb().select<Array<Record<string, unknown>>>('SELECT species FROM study_magnitudes');
    expect(rows).toEqual([]);
  });

  it('refuses a row whose columns parse to null rather than reading it as empty', async () => {
    await upload(name('Kb', 45, 80, 'With'), 'DRRR');
    await upload(name('Kb', 40, 80, 'Without'), 'RRRR');
    await attributeMagnitudesFor('horse');

    // `new Map(null)` is a legal empty map, so this would otherwise read as
    // "nothing is known" and drop every scorer back to counting.
    await getDb().execute("UPDATE study_magnitudes SET points = $bad WHERE species = 'horse'", { bad: 'null' });
    newSession();
    expect(magnitudeOf(await attributeMagnitudesFor('horse'), '01A1', 'dominant')).toBe(5);
  });

  it('re-solves rather than serving a row it cannot parse', async () => {
    await upload(name('Kb', 45, 80, 'With'), 'DRRR');
    await upload(name('Kb', 40, 80, 'Without'), 'RRRR');
    await attributeMagnitudesFor('horse');

    await getDb().execute("UPDATE study_magnitudes SET points = $bad WHERE species = 'horse'", { bad: 'not json' });
    newSession();
    // Half a table is worse than none, so a corrupt row is ignored outright.
    expect(magnitudeOf(await attributeMagnitudesFor('horse'), '01A1', 'dominant')).toBe(5);
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

  it('goes back to undefined once the gene table has changed under it', async () => {
    await upload(name('Kb', 45, 80, 'With'), 'DRRR');
    await upload(name('Kb', 40, 80, 'Without'), 'RRRR');
    await attributeMagnitudesFor('horse');
    expect(peekAttributeMagnitudes('horse')).toBeDefined();

    geneService.clearGeneEffectsCache('horse');
    expect(peekAttributeMagnitudes('horse')).toBeUndefined();
  });

  it('is the empty table, not undefined, for a species that can never be measured', () => {
    // "Not ready" and "nothing to know" are different answers: a caller that
    // confused them would keep waiting for a solve that will never run.
    expect(peekAttributeMagnitudes('dragon')).toBe(EMPTY_MAGNITUDES);
  });
});

describe('gene confirmations', () => {
  /**
   * Four animals in two pairs, each differing only at `01A1`, where carrying
   * the gene reads 5 points *lower* against a declared `Temperament+`.
   *
   * Two pairs sharing no animal, because one bad animal is never enough to
   * raise a doubt — `needsTwoMistakes` requires that no single record could
   * account for the whole disagreement.
   */
  async function disputed(): Promise<void> {
    await upload(name('Kb', 50, 80, 'PlainA'), 'RRRR');
    await upload(name('Kb', 45, 80, 'CarrierA'), 'DRRR');
    await upload(name('Kb', 60, 80, 'PlainB'), 'RRRR');
    await upload(name('Kb', 55, 80, 'CarrierB'), 'DRRR');
  }

  it('recommends the gene for checking while nobody has checked it', async () => {
    await disputed();
    const run = await runAttributeStudy('horse');
    expect(run.studies.flatMap((s) => s.geneDoubts).some((d) => d.gene === '01A1')).toBe(true);
  });

  it('stops recommending a gene the player confirmed, and blames the animals instead', async () => {
    await disputed();
    await confirmGeneDeclaration('horse', '01A1', 'dominant', 'temperament', 1);

    const run = await runAttributeStudy('horse');
    expect(run.studies.flatMap((s) => s.geneDoubts).some((d) => d.gene === '01A1')).toBe(false);
    // The declaration is now a fact, so the animals contradicting it are the
    // ones to go and re-read.
    expect(run.studies.flatMap((s) => s.contradictions).length).toBeGreaterThan(0);
  });

  it('does not publish a magnitude just because the declaration was confirmed', async () => {
    await disputed();
    await confirmGeneDeclaration('horse', '01A1', 'dominant', 'temperament', 1);
    const run = await runAttributeStudy('horse');
    // Confirming says who is at fault; the arithmetic still disagrees, so
    // nothing here is known.
    expect(run.studies.flatMap((s) => s.findings).some((f) => f.gene === '01A1')).toBe(false);
  });

  it('drops a confirmation once the gene is re-declared as something else', async () => {
    await disputed();
    await confirmGeneDeclaration('horse', '01A1', 'dominant', 'temperament', 1);
    expect([
      ...(await liveGeneConfirmations(
        'horse',
        buildEffectSlots((await geneService.getGeneEffectsCached('horse'))?.effects ?? {}),
      )),
    ]).toContain('01A1:dominant');

    // Re-declared the other way: what the player checked is no longer what
    // the app claims, so the confirmation no longer describes anything.
    await geneService.upsertGene('horse', '01', '01A1', { effectDominant: 'Temperament-', breed: '' });
    geneService.clearGeneEffectsCache('horse');
    const slots = buildEffectSlots((await geneService.getGeneEffectsCached('horse'))?.effects ?? {});
    expect([...(await liveGeneConfirmations('horse', slots))]).not.toContain('01A1:dominant');
  });

  it('can be withdrawn, which puts the gene back on the list', async () => {
    await disputed();
    await confirmGeneDeclaration('horse', '01A1', 'dominant', 'temperament', 1);
    await withdrawGeneConfirmation('horse', '01A1', 'dominant');

    const run = await runAttributeStudy('horse');
    expect(run.studies.flatMap((s) => s.geneDoubts).some((d) => d.gene === '01A1')).toBe(true);
  });
});

describe('use_for_studies', () => {
  /** Four animals; `Bad` carries a temperament reading 7 points out. */
  async function corpusWithOneBadRow(): Promise<number> {
    await upload(name('Kb', 50, 80, 'PlainA'), 'RRRR');
    await upload(name('Kb', 55, 80, 'CarrierA'), 'DRRR');
    await upload(name('Kb', 60, 80, 'PlainB'), 'RRRR');
    return upload(name('Kb', 72, 80, 'Bad'), 'DRRR');
  }

  it('implicates nobody when every prediction lands', async () => {
    await corpusWithOneBadRow();
    const run = await runAttributeStudy('horse');
    // Which animals get named is exercised against hand-built equations in
    // the engine's own suite; here the run just has to carry the field.
    expect(Array.isArray(run.suspects)).toBe(true);
    expect(run.suspects.every((s) => s.failures > 0)).toBe(true);
  });

  it('drops an excluded animal from the corpus and says why', async () => {
    const badId = await corpusWithOneBadRow();
    await setUseForStudies('horse', String(badId), false);

    const run = await runAttributeStudy('horse');
    expect(run.corpus.subjects.some((s) => s.id === String(badId))).toBe(false);
    // Counted, not silently vanished — a corpus that halves itself without
    // saying so is worse than one that explains.
    expect(run.corpus.excluded.find((e) => e.reason === 'excluded')?.count).toBe(1);
  });

  it('drops the memoised magnitudes, so breeding does not keep using the animal', async () => {
    const badId = await corpusWithOneBadRow();
    const before = await attributeMagnitudesFor('horse');
    expect(peekAttributeMagnitudes('horse')).toBe(before);

    await setUseForStudies('horse', String(badId), false);

    // The Study tab re-solves directly; without this the Breed tab would go
    // on scoring from magnitudes derived from the excluded animal.
    expect(peekAttributeMagnitudes('horse')).toBeUndefined();
    expect(await attributeMagnitudesFor('horse')).not.toBe(before);
  });

  it('refuses a subject nothing matched, rather than reporting a silent no-op', async () => {
    // The id is well-formed but names nothing here. An UPDATE that touches no
    // row would otherwise look exactly like success, and the view would
    // re-solve and show no change with nothing to say why.
    await expect(setUseForStudies('horse', '999999', false)).rejects.toThrow(/no pet/);
    await expect(setUseForStudies('horse', 'shared:deadbeef', false)).rejects.toThrow(/no cached/);
  });

  it('refuses a subject id that is neither a pet nor a cached animal', async () => {
    // `Number('')` is 0 and an integer, which would update `id = 0` — a
    // no-op the caller would report to the player as success.
    await expect(setUseForStudies('horse', '', false)).rejects.toThrow();
    await expect(setUseForStudies('horse', 'nonsense', false)).rejects.toThrow();
  });

  it('lists what is excluded so the choice can be undone', async () => {
    const badId = await corpusWithOneBadRow();
    await setUseForStudies('horse', String(badId), false);
    expect((await listExcludedSubjects('horse')).map((e) => e.subjectId)).toContain(String(badId));

    await setUseForStudies('horse', String(badId), true);
    expect(await listExcludedSubjects('horse')).toEqual([]);
    const run = await runAttributeStudy('horse');
    expect(run.corpus.subjects.some((s) => s.id === String(badId))).toBe(true);
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

  it('studies a cached animal whose name is not the structured format', async () => {
    // Its values are the provenance here: one off the default is proof the
    // uploader measured it, whatever they chose to call it.
    await cache('h9', 'Thunderhoof', 'RRRR', attrs(40, 80));
    expect((await loadStudyCorpus('horse')).subjects).toHaveLength(1);
  });

  it('drops a cached animal whose attributes are all the default and whose name carries none', async () => {
    const defaults = Object.fromEntries(Object.keys(attrs(0, 0)).map((k) => [k, 50]));
    await cache('h10', 'Untouched', 'RRRR', defaults);
    const corpus = await loadStudyCorpus('horse');
    expect(corpus.subjects).toEqual([]);
    expect(corpus.excluded).toContainEqual({ reason: 'unmeasured', count: 1 });
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

  it('reports what it is doing, in order, so a long fetch is not a hang', async () => {
    const a = await entry('A', 'DRRR');
    const b = await entry('B', 'RRRR');
    mockCatalogue([shared(a.hash), shared(b.hash)], { [a.hash]: a.text, [b.hash]: b.text });

    const seen: RefreshProgress[] = [];
    await refreshStudyCorpus('horse', (p) => seen.push(p));

    // The phases are what the player is waiting through, and they only make
    // sense in this order.
    expect(seen.map((p) => p.phase).filter((phase, i, all) => phase !== all[i - 1])).toEqual([
      'catalogue',
      'genomes',
      'checking',
      'saving',
    ]);
    // The catalogue's size is discovered by paging to the end, so nothing can
    // report a total until that finishes.
    expect(seen.find((p) => p.phase === 'catalogue')?.total).toBe(0);
    expect(seen.findLast((p) => p.phase === 'genomes')?.total).toBe(2);
  });

  it('reports the last entry even when the batch does not land on it', async () => {
    // Two entries, reported in batches of 25: without a final report the
    // verify phase would sit at zero and read as a stall.
    const a = await entry('A', 'DRRR');
    const b = await entry('B', 'RRRR');
    mockCatalogue([shared(a.hash), shared(b.hash)], { [a.hash]: a.text, [b.hash]: b.text });

    const seen: RefreshProgress[] = [];
    await refreshStudyCorpus('horse', (p) => seen.push(p));

    const checking = seen.filter((p) => p.phase === 'checking');
    expect(checking.at(-1)).toMatchObject({ done: 2, total: 2 });
  });

  it('runs without a progress callback, which most callers do not want', async () => {
    const a = await entry('A', 'DRRR');
    mockCatalogue([shared(a.hash)], { [a.hash]: a.text });
    await expect(refreshStudyCorpus('horse')).resolves.toMatchObject({ cached: 1 });
  });

  it('keeps an exclusion across a catalogue refresh, which replaces every cached row', async () => {
    const a = await entry('A', 'DRRR');
    mockCatalogue([shared(a.hash)], { [a.hash]: a.text });
    await refreshStudyCorpus('horse');

    const cachedId = `shared:${a.hash}`;
    await setUseForStudies('horse', cachedId, false);
    expect((await listExcludedSubjects('horse')).map((e) => e.subjectId)).toContain(cachedId);

    // The refresh deletes and re-inserts the species' rows. Without carrying
    // the flag across, every excluded record would quietly come back.
    await refreshStudyCorpus('horse');
    expect((await listExcludedSubjects('horse')).map((e) => e.subjectId)).toContain(cachedId);
  });

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
    // Attributes are present and well-formed, and every one of them is the
    // untouched default — the uploader's importer wrote them, nobody read
    // them off an animal.
    const wild = await entry('Wild Horse', 'RRRR');
    const ok = await entry(name('Kb', 41, 80, 'ok'), 'DRRR');
    const defaults = Object.fromEntries(Object.keys(ATTRS).map((k) => [k, 50]));
    mockCatalogue(
      [
        shared(wild.hash, { name: 'Wild Horse', attributes: defaults }),
        shared(ok.hash, { name: name('Kb', 41, 80, 'ok') }),
      ],
      { [wild.hash]: wild.text, [ok.hash]: ok.text },
    );
    const result = await refreshStudyCorpus('horse');
    expect(result).toMatchObject({ cached: 1, skipped: 1 });
  });

  it('caches an entry from a player who does not use the structured name', async () => {
    // The name format is one player's labelling convention; the catalogue is
    // full of animals named normally whose published attributes are real.
    // Gating on the name threw all of them away (#526).
    const theirs = await entry('Thunderhoof', 'DRRR');
    mockCatalogue([shared(theirs.hash, { name: 'Thunderhoof' })], { [theirs.hash]: theirs.text });
    const result = await refreshStudyCorpus('horse');
    expect(result).toMatchObject({ cached: 1, skipped: 0 });
  });

  it("reads a community entry's attributes from its name when none were published", async () => {
    const g = await entry(name('Kb', 40, 80, 'Named'), 'RRRR');
    mockCatalogue([shared(g.hash, { name: name('Kb', 40, 80, 'Named'), attributes: {} })], { [g.hash]: g.text });
    expect(await refreshStudyCorpus('horse')).toMatchObject({ cached: 1 });

    const [subject] = (await loadStudyCorpus('horse')).subjects;
    expect(subject.attributes.temperament).toBe(40);
    expect(subject.attributes.toughness).toBe(80);
  });

  it('prefers published readings over the name', async () => {
    const g = await entry(name('Kb', 40, 80, 'Stale'), 'RRRR');
    mockCatalogue([shared(g.hash, { name: name('Kb', 40, 80, 'Stale'), attributes: { ...ATTRS, temperament: 45 } })], {
      [g.hash]: g.text,
    });
    await refreshStudyCorpus('horse');
    expect((await loadStudyCorpus('horse')).subjects[0].attributes.temperament).toBe(45);
  });

  it('still skips an entry with neither published readings nor a structured name', async () => {
    const g = await entry('Thunderhoof', 'RRRR');
    mockCatalogue([shared(g.hash, { name: 'Thunderhoof', attributes: {} })], { [g.hash]: g.text });
    expect(await refreshStudyCorpus('horse')).toMatchObject({ cached: 0, skipped: 1 });
  });

  it('caches a community beewasp that has no breed', async () => {
    const g = await entry('Stinger', 'DRRR');
    const text = g.text.replace('Genome=Horse', 'Genome=BeeWasp');
    const hash = await sha256Hex(text);
    mockCatalogue([shared(hash, { species: 'BeeWasp', breed: '', name: 'Stinger', attributes: { ferocity: 45 } })], {
      [hash]: text,
    });
    const result = await refreshStudyCorpus('beewasp');
    expect(result).toMatchObject({ considered: 1, cached: 1 });
    expect((await loadStudyCorpus('beewasp')).subjects).toHaveLength(1);
  });

  it('caches nothing for a species with no entries', async () => {
    const g = await entry(name('Kb', 40, 80, 'x'), 'RRRR');
    mockCatalogue([shared(g.hash, { species: 'BeeWasp' })], { [g.hash]: g.text });
    const result = await refreshStudyCorpus('horse');
    expect(result).toMatchObject({ considered: 0, cached: 0 });
  });
});
