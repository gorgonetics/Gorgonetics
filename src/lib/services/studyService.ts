/**
 * Corpus loading for attribute-effect inference.
 *
 * Owns the DB reads, the species scoping and the eligibility rules; all
 * the arithmetic lives in `utils/attributeStudy.js`.
 *
 * ## Why eligibility is a name check
 *
 * An animal only teaches us something if its attributes are *measurements*.
 * They are not always: `importGenomeFile` sets
 * `attrValues = parsed?.attributes ?? defaults`, so when a name does not
 * parse every attribute silently becomes `DEFAULT_ATTRIBUTE_VALUE`. A
 * defaulted 50 is indistinguishable from a real 50 once it is in the
 * column, and it is not a reading — differencing against it manufactures
 * magnitudes out of nothing. In the live catalogue one such animal alone
 * produced 18 contradictory deductions.
 *
 * So `parseStructuredPetName` is the gate: if the name parses, the stored
 * values came from a reading. The *stored* values are then used rather
 * than the re-parsed ones, because a user who edits an attribute afterwards
 * is correcting the name, not contradicting it.
 *
 * ## Why community animals are cached, not imported
 *
 * The study learns from animals; the roster holds animals the player owns.
 * Importing the catalogue to widen the corpus would conflate the two and
 * drop hundreds of other people's horses into My Pets. So community
 * entries live in `study_corpus`, read by the study and by nothing else.
 *
 * They are never checkable: `stabled` means the player can re-read the
 * animal in the game, and they cannot re-read someone else's.
 *
 * Refreshing is explicit. It costs one Firestore read per catalogue entry
 * against a Spark quota, so it happens when the player asks rather than on
 * mount, and the cache persists until they ask again.
 */

import { normalizeSpecies } from '$lib/services/configService.js';
import { buildInClauseParams, getDb, withTransaction } from '$lib/services/database.js';
import { getGeneEffectsCached } from '$lib/services/geneService.js';
import { parseGenome } from '$lib/services/genomeParser.js';
import { parseStructuredPetName } from '$lib/services/nameParser.js';
import { getAllPets } from '$lib/services/petService.js';
import { listGenomes, listPets } from '$lib/services/shareService.js';
import { GeneType, type Pet, type SharedPet } from '$lib/types/index.js';
import {
  type AttributeStudy,
  buildEffectSlots,
  type StudyOptions,
  type StudySubject,
  studyAll,
} from '$lib/utils/attributeStudy.js';
import { loadAllPetLoci, type PetLoci } from '$lib/utils/petLoci.js';
import { ATTRIBUTE_KEYS } from '$lib/utils/sharedPet.js';
import { now } from '$lib/utils/timestamp.js';

/** The breed value for an animal of no single breed; see the exclusion in `loadStudyCorpus`. */
const MIXED_BREED = 'Mixed';

/**
 * Species the study can actually measure.
 *
 * Inference needs attributes it can trust, and the only provenance signal
 * is a structured name — which `parseStructuredPetName` parses for horses
 * alone. Offering a species without one yields a permanently empty study
 * that blames the animals ("attributes never recorded") for a gap in the
 * app. Widening this means giving that species a measurement path first.
 */
export const STUDYABLE_SPECIES: readonly string[] = ['horse'];

/** Why an animal was left out of the corpus. */
export type ExclusionReason =
  /** Name does not parse, so its attributes are defaults rather than readings. */
  | 'unmeasured'
  /** Carries at least one unrevealed locus. */
  | 'unrevealed'
  /** No projected `pet_genes` rows — malformed or unparsed genome. */
  | 'no-genome'
  /** No breed, so it cannot be paired with anything. */
  | 'no-breed'
  /** Mixed breed: which breed-locked genes apply to it is unknowable. */
  | 'mixed-breed'
  /** Genome is missing loci the gene table declares an attribute effect for. */
  | 'incomplete';

export interface StudyCorpus {
  subjects: StudySubject[];
  /** Animals of this species examined, before any exclusion. */
  considered: number;
  /** Exclusion counts, highest first. Always reported — a corpus that
   *  quietly halves itself is worse than one that says why. */
  excluded: Array<{ reason: ExclusionReason; count: number }>;
}

export interface LoadCorpusOptions {
  /**
   * Gene ids the study needs present on every subject.
   *
   * A projection can be short — a truncated genome, a half-written
   * `pet_genes` write, or a locus added in Reference that no stored genome
   * carries. `activeSlots` withdraws such a subject from the affected
   * attribute, which is correct but silent: it would still be counted among
   * the animals studied while contributing nothing. Passing the declared
   * loci lets the shortfall be reported instead of vanishing.
   */
  requiredGenes?: Iterable<string>;
  /**
   * Drop animals carrying any unrevealed locus.
   *
   * On by default. The engine is already safe without it — `activeSlots`
   * withdraws a subject from precisely the attributes a `?` could corrupt
   * and keeps the rest — so turning this off trades nothing for a larger
   * corpus. It defaults on because a mixed-reveal corpus makes the
   * per-attribute contributor counts hard to reason about.
   */
  requireFullGenome?: boolean;
}

export interface StudyRun {
  corpus: StudyCorpus;
  studies: AttributeStudy[];
  /** Unknowns across every attribute, and how many are now known. */
  totals: { slots: number; found: number; direct: number; derived: number };
  /**
   * Pooled out-of-sample score — the engine's health. `stabled*` is the
   * same score over pairs the player can re-read, and is the one to quote.
   */
  validation: { tested: number; exact: number; stabledTested: number; stabledExact: number };
}

function subjectFrom(pet: Pet, loci: PetLoci): StudySubject {
  const genes: Record<string, string> = {};
  for (const [geneId, geneType] of loci) genes[geneId] = geneType;
  const attributes: Record<string, number> = {};
  for (const key of ATTRIBUTE_KEYS) {
    const value = (pet as unknown as Record<string, unknown>)[key];
    if (typeof value === 'number') attributes[key] = value;
  }
  // `stabled` is what makes a reading checkable: only a stabled animal can
  // be looked up in the game and its attributes confirmed.
  return { id: String(pet.id), breed: pet.breed, genes, attributes, stabled: pet.stabled === true };
}

/**
 * Build the corpus for one species.
 *
 * Reads every pet of the species and its projected loci in one bulk query
 * apiece, then applies the eligibility rules above.
 */
export async function loadStudyCorpus(species: string, options: LoadCorpusOptions = {}): Promise<StudyCorpus> {
  const requireFullGenome = options.requireFullGenome ?? true;
  const required = options.requiredGenes ? [...options.requiredGenes] : [];
  const normalized = normalizeSpecies(species);
  // The `species` column holds the raw genome header (`Horse`), so a SQL
  // equality against the canonical key silently matches nothing. Scope in
  // JS through `normalizeSpecies`, as the rarity baseline does.
  const { items: all } = await getAllPets();
  const items = all.filter((pet) => normalizeSpecies(pet.species) === normalized);

  const tally = new Map<ExclusionReason, number>();
  const exclude = (reason: ExclusionReason): void => {
    tally.set(reason, (tally.get(reason) ?? 0) + 1);
  };

  // Name and breed are free to check, so filter on them before paying for
  // the locus read.
  const candidates: Pet[] = [];
  for (const pet of items) {
    // Name first: an unparsed name is *why* such a pet also has no breed
    // (`petBreed = parsed?.breed ?? ''`), so checking breed first would
    // report the symptom and hide the cause. `no-breed` then catches only
    // the case this cannot explain — a breed cleared by a later edit.
    if (!parseStructuredPetName(pet.name, pet.species)) {
      exclude('unmeasured');
      continue;
    }
    if (!pet.breed) {
      exclude('no-breed');
      continue;
    }
    // A Mixed horse is not a breed the gene table can be read against.
    // Elsewhere the app lets Mixed pass every breed-locked gene
    // (`isHorseBreedFiltered`), because for scoring an over-count is
    // preferable to hiding a gene the player owns. Inference cannot take
    // that liberty: crediting one animal with all ten breeds' effects
    // invents terms, and crediting it with none erases real ones. Either
    // way its equations would be wrong, so it sits the study out.
    if (pet.breed === MIXED_BREED) {
      exclude('mixed-breed');
      continue;
    }
    candidates.push(pet);
  }

  const lociByPet = await loadAllPetLoci(candidates.map((p) => p.id));

  const subjects: StudySubject[] = [];
  for (const pet of candidates) {
    const loci = lociByPet.get(pet.id);
    if (!loci || loci.size === 0) {
      exclude('no-genome');
      continue;
    }
    if (requireFullGenome) {
      let unrevealed = false;
      for (const geneType of loci.values()) {
        if (geneType === GeneType.UNKNOWN) {
          unrevealed = true;
          break;
        }
      }
      if (unrevealed) {
        exclude('unrevealed');
        continue;
      }
    }
    // An absent locus is not the same as an unrevealed one: `?` is a real
    // stored allele state, this is a row that was never written.
    let short = false;
    for (const gene of required) {
      if (!loci.has(gene)) {
        short = true;
        break;
      }
    }
    if (short) {
      exclude('incomplete');
      continue;
    }
    subjects.push(subjectFrom(pet, loci));
  }

  const community = await cachedSubjects(normalized, new Set(items.map((pet) => pet.content_hash)), required);
  subjects.push(...community.subjects);
  for (const [reason, count] of community.excluded) tally.set(reason, (tally.get(reason) ?? 0) + count);

  return {
    subjects,
    considered: items.length + community.considered,
    excluded: [...tally.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count),
  };
}

/**
 * Community animals from the local cache, as study subjects.
 *
 * `ownedHashes` drops any entry the player also owns: the same genome
 * appearing twice would pair with itself, and if the two records disagree
 * about an attribute it would read as a contradiction between an animal
 * and itself. The local copy wins, because it is the one that can be
 * stabled and therefore re-read.
 */
async function cachedSubjects(
  normalized: string,
  ownedHashes: ReadonlySet<string>,
  required: readonly string[],
): Promise<{ subjects: StudySubject[]; considered: number; excluded: Map<ExclusionReason, number> }> {
  const rows = await getDb().select<CachedRow[]>(
    'SELECT content_hash, breed, name, attributes, genome_text FROM study_corpus WHERE species = $species',
    { species: normalized },
  );
  const subjects: StudySubject[] = [];
  const excluded = new Map<ExclusionReason, number>();
  const drop = (reason: ExclusionReason): void => {
    excluded.set(reason, (excluded.get(reason) ?? 0) + 1);
  };
  let considered = 0;
  for (const row of rows) {
    if (ownedHashes.has(row.content_hash)) continue;
    considered++;
    // Same rule as a local animal: which breed-locked genes apply to a
    // Mixed horse is unknowable, so its equations would be wrong either way.
    if (row.breed === MIXED_BREED) {
      drop('mixed-breed');
      continue;
    }
    let genes: Record<string, string>;
    try {
      const parsed = parseGenome(row.genome_text);
      genes = {};
      for (const [chromosome, list] of Object.entries(parsed.genes))
        for (const gene of list) genes[`${chromosome}${gene.block}${gene.position}`] = gene.gene_type;
    } catch {
      drop('no-genome');
      continue;
    }
    if (Object.values(genes).includes(GeneType.UNKNOWN)) {
      drop('unrevealed');
      continue;
    }
    if (required.some((gene) => genes[gene] === undefined)) {
      drop('incomplete');
      continue;
    }
    let attributes: Record<string, number>;
    try {
      attributes = JSON.parse(row.attributes) as Record<string, number>;
    } catch {
      drop('unmeasured');
      continue;
    }
    subjects.push({
      id: `${SHARED_ID_PREFIX}${row.content_hash}`,
      breed: row.breed,
      genes,
      attributes,
      // Someone else's animal: it can raise a disagreement but never settle one.
      stabled: false,
    });
  }
  return { subjects, considered, excluded };
}

/** Load the corpus and solve every attribute for one species. */
export async function runAttributeStudy(
  species: string,
  options: LoadCorpusOptions & StudyOptions = {},
): Promise<StudyRun> {
  // Effects first: the declared loci are what makes a genome "complete"
  // for this study, so the corpus load needs them.
  const effects = await getGeneEffectsCached(species);
  const slots = buildEffectSlots(effects?.effects ?? {});
  const corpus = await loadStudyCorpus(species, {
    ...options,
    requiredGenes: options.requiredGenes ?? new Set(slots.map((slot) => slot.gene)),
  });
  const studies = studyAll(corpus.subjects, slots, options);

  const totals = { slots: 0, found: 0, direct: 0, derived: 0 };
  const validation = { tested: 0, exact: 0, stabledTested: 0, stabledExact: 0 };
  for (const study of studies) {
    totals.slots += study.slots;
    totals.found += study.findings.length;
    for (const finding of study.findings) {
      if (finding.tier === 'direct') totals.direct++;
      else totals.derived++;
    }
    validation.tested += study.validation.tested;
    validation.exact += study.validation.exact;
    validation.stabledTested += study.validation.stabledTested;
    validation.stabledExact += study.validation.stabledExact;
  }

  return { corpus, studies, totals, validation };
}

export interface RefreshResult {
  /** Catalogue entries examined. */
  considered: number;
  /** Entries now cached and usable by the study. */
  cached: number;
  /** Entries skipped because they would teach nothing. */
  skipped: number;
}

/** Marks a subject id as a cached community animal rather than a `pets` row. */
const SHARED_ID_PREFIX = 'shared:';

/** A cached community animal, as the study consumes it. */
interface CachedRow {
  content_hash: string;
  breed: string;
  name: string;
  attributes: string;
  genome_text: string;
}

/**
 * Whether a catalogue entry can teach the study anything.
 *
 * The same bar local animals must clear — a name that parses, so the
 * attributes are readings rather than defaults, and a breed to pair
 * within. Applied before caching so the table holds only usable evidence.
 */
function usableSharedPet(pet: SharedPet, genome: string): boolean {
  return genome.length > 0 && !!pet.breed && !!pet.attributes && parseStructuredPetName(pet.name, pet.species) !== null;
}

/**
 * Pull the catalogue into the local study cache.
 *
 * Two collection scans rather than a fetch per animal: the metadata and
 * the genome blobs are paged separately and joined on the content hash.
 */
export async function refreshStudyCorpus(species: string): Promise<RefreshResult> {
  const normalized = normalizeSpecies(species);

  const metadata = new Map<string, SharedPet>();
  let cursor: unknown = null;
  do {
    const page = await listPets(cursor ? { after: cursor } : {});
    for (const pet of page.pets) metadata.set(pet.contentHash, pet);
    cursor = page.pets.length > 0 ? page.cursor : null;
  } while (cursor);

  const genomes = new Map<string, string>();
  cursor = null;
  do {
    const page = await listGenomes(cursor ? { after: cursor } : {});
    for (const g of page.genomes) genomes.set(g.contentHash, g.genomeData);
    cursor = page.genomes.length > 0 ? page.cursor : null;
  } while (cursor);

  const ts = now();
  let cached = 0;
  const rows: CachedRow[] = [];
  for (const [hash, pet] of metadata) {
    if (normalizeSpecies(pet.species) !== normalized) continue;
    const genome = genomes.get(hash) ?? '';
    if (!usableSharedPet(pet, genome)) continue;
    rows.push({
      content_hash: hash,
      breed: pet.breed,
      name: pet.name,
      attributes: JSON.stringify(pet.attributes ?? {}),
      genome_text: genome,
    });
  }

  const db = getDb();
  await withTransaction(async () => {
    for (const row of rows) {
      await db.execute(
        `INSERT OR REPLACE INTO study_corpus
         (content_hash, species, breed, name, attributes, genome_text, fetched_at)
         VALUES ($hash, $species, $breed, $name, $attributes, $genome, $ts)`,
        {
          hash: row.content_hash,
          species: normalized,
          breed: row.breed,
          name: row.name,
          attributes: row.attributes,
          genome: row.genome_text,
          ts,
        },
      );
      cached++;
    }
  });

  const considered = [...metadata.values()].filter((p) => normalizeSpecies(p.species) === normalized).length;
  return { considered, cached, skipped: considered - cached };
}

/** How much community evidence is cached, and when it was last pulled. */
export async function studyCorpusStatus(species: string): Promise<{ cached: number; fetchedAt: string | null }> {
  const rows = await getDb().select<Array<{ content_hash: string; fetched_at: string }>>(
    'SELECT content_hash, fetched_at FROM study_corpus WHERE species = $species',
    { species: normalizeSpecies(species) },
  );
  let latest: string | null = null;
  for (const row of rows) if (latest === null || row.fetched_at > latest) latest = row.fetched_at;
  return { cached: rows.length, fetchedAt: latest };
}

/** Drop every cached community animal for a species. */
export async function clearStudyCorpus(species: string): Promise<void> {
  await getDb().execute('DELETE FROM study_corpus WHERE species = $species', {
    species: normalizeSpecies(species),
  });
}

/**
 * Resolve subject ids back to display names.
 *
 * Findings and contradictions carry `pets.id` as a string, because that is
 * the only stable handle — names are neither unique nor immutable. The view
 * layer needs names, and asking for them by id keeps the engine free of
 * presentation concerns.
 */
export async function namesForSubjects(ids: readonly string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const db = getDb();

  const numeric = ids.map((id) => Number.parseInt(id, 10)).filter(Number.isInteger);
  if (numeric.length > 0) {
    const { placeholders, params } = buildInClauseParams(numeric, 'id');
    const rows = await db.select<Array<{ id: number; name: string }>>(
      `SELECT id, name FROM pets WHERE id IN (${placeholders})`,
      params,
    );
    for (const row of rows) names.set(String(row.id), row.name);
  }

  // Cached community animals are keyed `shared:<hash>` rather than by a
  // `pets` row id, since they are deliberately not in that table.
  const hashes = ids.filter((id) => id.startsWith(SHARED_ID_PREFIX)).map((id) => id.slice(SHARED_ID_PREFIX.length));
  if (hashes.length > 0) {
    const { placeholders, params } = buildInClauseParams(hashes, 'hash');
    const rows = await db.select<Array<{ content_hash: string; name: string }>>(
      `SELECT content_hash, name FROM study_corpus WHERE content_hash IN (${placeholders})`,
      params,
    );
    for (const row of rows) names.set(`${SHARED_ID_PREFIX}${row.content_hash}`, row.name);
  }

  return names;
}
