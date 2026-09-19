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
import { buildInClauseParams, getDb, type TxStatement } from '$lib/services/database.js';
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
import { sha256Hex } from '$lib/utils/hash.js';
import { loadAllPetLoci, type PetLoci } from '$lib/utils/petLoci.js';
import { ATTRIBUTE_KEYS, dedupeLatest } from '$lib/utils/sharedPet.js';
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

/**
 * The genome, as eligibility needs to see it.
 *
 * A local animal's loci arrive as a `Map` and a cached one's as a plain
 * object; both answer these three questions, so neither has to be copied
 * into the other's shape to be checked.
 */
interface GenomeView {
  readonly size: number;
  has(gene: string): boolean;
  values(): Iterable<string>;
}

/** Wrap a plain gene map so it can be checked without copying. */
function viewOf(genes: Record<string, string>): GenomeView {
  return {
    get size() {
      return Object.keys(genes).length;
    },
    has: (gene) => genes[gene] !== undefined,
    values: () => Object.values(genes),
  };
}

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

  // Name and breed are free to check, so settle those before paying for the
  // locus read; the genome gates run below once the loci are in hand.
  const candidates: Pet[] = [];
  for (const pet of items) {
    const reason = eligibility(pet, null, [], false);
    if (reason) {
      exclude(reason);
      continue;
    }
    candidates.push(pet);
  }

  const lociByPet = await loadAllPetLoci(candidates.map((p) => p.id));

  const subjects: StudySubject[] = [];
  for (const pet of candidates) {
    const loci = lociByPet.get(pet.id);
    if (!loci) {
      exclude('no-genome');
      continue;
    }
    const reason = eligibility(pet, loci, required, requireFullGenome);
    if (reason) {
      exclude(reason);
      continue;
    }
    subjects.push(subjectFrom(pet, loci));
  }

  const community = await cachedSubjects(
    normalized,
    new Set(items.map((pet) => pet.content_hash)),
    required,
    requireFullGenome,
  );
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
  requireFullGenome: boolean,
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
    // Gates re-run at read time even though `usableSharedPet` checked some
    // before caching: a row can outlive the gate that admitted it, written
    // by an older build or restored from a backup.
    const genes: Record<string, string> = {};
    for (const [chromosome, list] of Object.entries(parseGenome(row.genome_text).genes))
      for (const gene of list) genes[`${chromosome}${gene.block}${gene.position}`] = gene.gene_type;

    const reason = eligibility(
      { name: row.name, species: normalized, breed: row.breed },
      viewOf(genes),
      required,
      requireFullGenome,
    );
    if (reason) {
      drop(reason);
      continue;
    }

    let attributes: Record<string, number>;
    try {
      const raw = JSON.parse(row.attributes) as Record<string, unknown>;
      attributes = {};
      for (const [key, value] of Object.entries(raw)) if (typeof value === 'number') attributes[key] = value;
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

/**
 * Whether an animal can teach the study anything, and if not, why.
 *
 * Both corpus sources run this, in this order. The rules used to be written
 * out twice — once per source — and drifted: the cached path was admitting
 * Mixed-breed animals the local path excluded, and skipping its name and
 * breed gates entirely because they had been applied at write time. A rule
 * that lives in one place cannot disagree with itself.
 *
 * Pass `null` for the genome to check only what an animal's own fields can
 * answer — the local path does this to reject what it can before paying for
 * the locus read, then calls again with the loci.
 *
 * Returns null when the animal is usable.
 */
function eligibility(
  animal: { name: string; species: string; breed: string },
  genome: GenomeView | null,
  required: readonly string[],
  requireFullGenome: boolean,
): ExclusionReason | null {
  // Name first: an unparsed name is *why* such an animal also has no breed,
  // so checking breed first would report the symptom and hide the cause.
  if (!parseStructuredPetName(animal.name, animal.species)) return 'unmeasured';
  if (!animal.breed) return 'no-breed';
  if (animal.breed === MIXED_BREED) return 'mixed-breed';
  if (!genome) return null;
  // Empty rather than throwing: `parseGenome` yields no loci for a junk
  // blob, and a pet row can simply have no projection yet.
  if (genome.size === 0) return 'no-genome';
  if (requireFullGenome) {
    for (const geneType of genome.values()) if (geneType === GeneType.UNKNOWN) return 'unrevealed';
  }
  for (const gene of required) if (!genome.has(gene)) return 'incomplete';
  return null;
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
  /** Entries whose genome did not hash to the id it was filed under. */
  unverified: number;
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
 * Runs the same `eligibility` rules the read path does, so the cache never
 * fills with rows that will always be rejected on the way out — a Mixed
 * horse has a truthy breed and used to be cached, then excluded on every
 * read, inflating the "N cached" figure with unusable evidence.
 *
 * Deliberately permissive on two of them: `requiredGenes` is empty and
 * `requireFullGenome` is off, because those depend on the gene table and on
 * caller options that can change between refreshes. Filtering those at read
 * time keeps the cache useful when they do.
 */
function usableSharedPet(pet: SharedPet, genes: Record<string, string>): boolean {
  if (!pet.attributes) return false;
  return eligibility({ name: pet.name, species: pet.species, breed: pet.breed }, viewOf(genes), [], false) === null;
}

/**
 * Pull the catalogue into the local study cache.
 *
 * Two collection scans rather than a fetch per animal: the metadata and
 * the genome blobs are paged separately and joined on the content hash.
 */
export async function refreshStudyCorpus(species: string): Promise<RefreshResult> {
  const normalized = normalizeSpecies(species);

  // The catalogue is add-only: a correction is a second document for the
  // same hash. `listPets` pages newest-first, so keeping the last one seen
  // would keep the *oldest* — caching the very attributes an uploader
  // published a correction to fix. `dedupeLatest` keeps the newest and
  // rebinds identity fields to the first-share entry, which matters here
  // because `breed` drives pairing and `name` is the measurement gate.
  const pages: SharedPet[] = [];
  let cursor: unknown = null;
  do {
    const page = await listPets(cursor ? { after: cursor } : {});
    pages.push(...page.pets);
    cursor = page.pets.length > 0 ? page.cursor : null;
  } while (cursor);
  const metadata = new Map<string, SharedPet>(dedupeLatest(pages).map((pet) => [pet.contentHash, pet]));

  const genomes = new Map<string, string>();
  cursor = null;
  do {
    const page = await listGenomes(cursor ? { after: cursor } : {});
    for (const g of page.genomes) genomes.set(g.contentHash, g.genomeData);
    cursor = page.genomes.length > 0 ? page.cursor : null;
  } while (cursor);

  const ts = now();
  let cached = 0;
  let unverified = 0;
  const rows: CachedRow[] = [];
  for (const [hash, pet] of metadata) {
    if (normalizeSpecies(pet.species) !== normalized) continue;
    const genome = genomes.get(hash) ?? '';
    if (genome.length === 0) continue;

    // The catalogue takes unauthenticated writes and `firestore.rules`
    // cannot compute a digest, so nothing server-side guarantees that a
    // `/genomes/{id}` blob actually hashes to the id it is filed under.
    // `importCommunityPet` verifies for exactly this reason; the study
    // must too, or a blob written under someone else's hash is joined to
    // their metadata and every deduction drawn from it is corrupt.
    if ((await sha256Hex(genome)) !== hash) {
      unverified++;
      continue;
    }

    const genes: Record<string, string> = {};
    for (const [chromosome, list] of Object.entries(parseGenome(genome).genes))
      for (const gene of list) genes[`${chromosome}${gene.block}${gene.position}`] = gene.gene_type;
    if (!usableSharedPet(pet, genes)) continue;

    rows.push({
      content_hash: hash,
      breed: pet.breed,
      name: pet.name,
      attributes: JSON.stringify(pet.attributes ?? {}),
      genome_text: genome,
    });
  }

  // One real transaction, not `withTransaction`: that helper no-ops
  // BEGIN/COMMIT on the Tauri path (see its own doc), so a per-statement
  // loop would be several hundred round trips that leave a half-written
  // cache if one fails. Replacing the species' rows wholesale also drops
  // entries the catalogue no longer serves, or that no longer pass the
  // gate — an add-only cache would keep feeding them to the study forever.
  const statements: TxStatement[] = [
    { sql: 'DELETE FROM study_corpus WHERE species = $species', params: { species: normalized } },
    ...rows.map((row) => ({
      sql: `INSERT OR REPLACE INTO study_corpus
            (content_hash, species, breed, name, attributes, genome_text, fetched_at)
            VALUES ($hash, $species, $breed, $name, $attributes, $genome, $ts)`,
      params: {
        hash: row.content_hash,
        species: normalized,
        breed: row.breed,
        name: row.name,
        attributes: row.attributes,
        genome: row.genome_text,
        ts,
      },
    })),
  ];
  await getDb().transaction(statements);
  cached = rows.length;

  const considered = [...metadata.values()].filter((p) => normalizeSpecies(p.species) === normalized).length;
  return { considered, cached, skipped: considered - cached, unverified };
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
