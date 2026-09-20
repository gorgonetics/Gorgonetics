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
import { geneDeclarationsRevision, getGeneEffectsCached } from '$lib/services/geneService.js';
import { parseGenome } from '$lib/services/genomeParser.js';
import { parseStructuredPetName } from '$lib/services/nameParser.js';
import { getAllPets, localPetsRevision } from '$lib/services/petService.js';
import { listGenomes, listPets } from '$lib/services/shareService.js';
import { GeneType, type Pet, type SharedPet } from '$lib/types/index.js';
import { type AttributeMagnitudes, buildAttributeMagnitudes, EMPTY_MAGNITUDES } from '$lib/utils/attributePoints.js';
import {
  type AttributeStudy,
  buildEffectSlots,
  type EffectSlot,
  type Expression,
  type StudyOptions,
  type StudySubject,
  slotKey,
  studyAll,
  type ValidationSuspect,
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
  | 'incomplete'
  /** The player has turned `use_for_studies` off — a record judged mis-recorded. */
  | 'excluded';

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
  totals: { slots: number; found: number; direct: number; derived: number; system: number };
  /**
   * Pooled out-of-sample score — the engine's health. `stabled*` is the
   * same score over pairs the player can re-read, and is the one to quote.
   */
  validation: { tested: number; exact: number; stabledTested: number; stabledExact: number };
  /**
   * Animals implicated in failed predictions, pooled across attributes and
   * worst first.
   *
   * The score alone says the corpus is imperfect; this says who, which is
   * the only part anyone can act on. One mis-typed attribute shifts an
   * animal by a constant, so a high `offsetShare` is the signature to look
   * for — and on the live corpus twelve animals of 457 carried every
   * failure.
   */
  suspects: ValidationSuspect[];
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
    // The player has judged this animal's record untrustworthy. Checked
    // before the genome load, so an excluded pet costs nothing to skip.
    if (pet.use_for_studies === false) {
      exclude('excluded');
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
    `SELECT content_hash, breed, name, attributes, genome_text, use_for_studies
       FROM study_corpus WHERE species = $species`,
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
    if (Number(row.use_for_studies ?? 1) === 0) {
      drop('excluded');
      continue;
    }
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
  const studies = studyAll(corpus.subjects, slots, {
    ...options,
    confirmedSlots: options.confirmedSlots ?? (await liveGeneConfirmations(species, slots)),
  });

  const totals = { slots: 0, found: 0, direct: 0, derived: 0, system: 0 };
  const validation = { tested: 0, exact: 0, stabledTested: 0, stabledExact: 0 };
  /** Per subject, how often each error size was seen across every attribute. */
  const pooled = new Map<string, Map<number, number>>();
  for (const study of studies) {
    totals.slots += study.slots;
    totals.found += study.findings.length;
    for (const finding of study.findings) {
      if (finding.tier === 'direct') totals.direct++;
      else if (finding.tier === 'system') totals.system++;
      else totals.derived++;
    }
    validation.tested += study.validation.tested;
    validation.exact += study.validation.exact;
    validation.stabledTested += study.validation.stabledTested;
    validation.stabledExact += study.validation.stabledExact;
    for (const suspect of study.validation.suspects) {
      const seen = pooled.get(suspect.subjectId) ?? new Map<number, number>();
      for (const [error, count] of suspect.offsets) seen.set(error, (seen.get(error) ?? 0) + count);
      pooled.set(suspect.subjectId, seen);
    }
  }
  // Recomputed from the pooled counts, not copied from one attribute: the
  // share has to be a share of the same total the row displays.
  const suspects: ValidationSuspect[] = [...pooled].map(([subjectId, byError]) => {
    let failures = 0;
    let offset = 0;
    let best = 0;
    for (const [error, count] of byError) {
      failures += count;
      if (count > best) {
        best = count;
        offset = error;
      }
    }
    return { subjectId, failures, offset, offsetShare: best / failures, offsets: [...byError] };
  });
  suspects.sort((a, b) => b.failures - a.failures || b.offsetShare - a.offsetShare);

  return { corpus, studies, totals, validation, suspects };
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
  /** Absent on the write path, which sets it explicitly; 1 when unset. */
  use_for_studies?: number;
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
/**
 * Where a refresh has got to.
 *
 * The work is four phases over a few hundred entries, and the slow two are
 * paged network reads. Without this the button says "Fetching…" for as long
 * as it takes and the player cannot tell a working fetch from a hung one.
 *
 * `total` is 0 while it is still unknown: the catalogue's size is only
 * discovered by paging to the end of it, so the first phase can report how
 * much it has found but not how much is left.
 */
export interface RefreshProgress {
  phase: 'catalogue' | 'genomes' | 'checking' | 'saving';
  done: number;
  total: number;
}

/** Let the browser paint. `await` alone only drains microtasks. */
const yieldToRender = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

export async function refreshStudyCorpus(
  species: string,
  onProgress?: (progress: RefreshProgress) => void,
): Promise<RefreshResult> {
  const normalized = normalizeSpecies(species);
  const report = async (progress: RefreshProgress): Promise<void> => {
    if (!onProgress) return;
    onProgress(progress);
    await yieldToRender();
  };

  // The catalogue is add-only: a correction is a second document for the
  // same hash. `listPets` pages newest-first, so keeping the last one seen
  // would keep the *oldest* — caching the very attributes an uploader
  // published a correction to fix. `dedupeLatest` keeps the newest and
  // rebinds identity fields to the first-share entry, which matters here
  // because `breed` drives pairing and `name` is the measurement gate.
  const pages: SharedPet[] = [];
  let cursor: unknown = null;
  await report({ phase: 'catalogue', done: 0, total: 0 });
  do {
    const page = await listPets(cursor ? { after: cursor } : {});
    pages.push(...page.pets);
    cursor = page.pets.length > 0 ? page.cursor : null;
    await report({ phase: 'catalogue', done: pages.length, total: 0 });
  } while (cursor);
  const metadata = new Map<string, SharedPet>(dedupeLatest(pages).map((pet) => [pet.contentHash, pet]));

  const genomes = new Map<string, string>();
  cursor = null;
  // The catalogue is paged, so its size is known now and the genome fetch
  // can be counted against it.
  await report({ phase: 'genomes', done: 0, total: metadata.size });
  do {
    const page = await listGenomes(cursor ? { after: cursor } : {});
    for (const g of page.genomes) genomes.set(g.contentHash, g.genomeData);
    cursor = page.genomes.length > 0 ? page.cursor : null;
    await report({ phase: 'genomes', done: genomes.size, total: metadata.size });
  } while (cursor);

  const ts = now();
  let cached = 0;
  let unverified = 0;
  const rows: CachedRow[] = [];
  let checked = 0;
  await report({ phase: 'checking', done: 0, total: metadata.size });
  for (const [hash, pet] of metadata) {
    checked++;
    // Hashing and parsing a few hundred genomes is the one phase that is
    // this app's own work rather than the network's, and it is the phase
    // that looks hung. Report in batches: every entry would cost more in
    // repaints than the work itself.
    // The last entry always reports, whatever the batch size: a corpus of
    // twelve would otherwise sit at zero throughout, and a partial final
    // batch would stop short of the total and read as a stall.
    if (checked % 25 === 0 || checked === metadata.size) {
      await report({ phase: 'checking', done: checked, total: metadata.size });
    }
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
  // The refresh replaces this species' rows wholesale, so anything the
  // player has judged about them has to be carried across or a refresh would
  // silently re-admit every record they excluded.
  const previouslyExcluded = new Set(
    (
      await getDb().select<Array<{ content_hash: string }>>(
        'SELECT content_hash FROM study_corpus WHERE species = $species AND use_for_studies = $off',
        { species: normalized, off: 0 },
      )
    ).map((r) => r.content_hash),
  );

  await report({ phase: 'saving', done: 0, total: rows.length });
  const statements: TxStatement[] = [
    { sql: 'DELETE FROM study_corpus WHERE species = $species', params: { species: normalized } },
    ...rows.map((row) => ({
      sql: `INSERT OR REPLACE INTO study_corpus
            (content_hash, species, breed, name, attributes, genome_text, fetched_at, use_for_studies)
            VALUES ($hash, $species, $breed, $name, $attributes, $genome, $ts, $use_for_studies)`,
      params: {
        hash: row.content_hash,
        species: normalized,
        breed: row.breed,
        name: row.name,
        attributes: row.attributes,
        genome: row.genome_text,
        ts,
        use_for_studies: previouslyExcluded.has(row.content_hash) ? 0 : 1,
      },
    })),
  ];
  await getDb().transaction(statements);
  cached = rows.length;
  // The corpus just changed under the memoised magnitudes, and a refresh is
  // the one event that can *revise* a finding rather than only add one: an
  // uploader's correction replaces the reading a magnitude was deduced from.
  clearAttributeMagnitudesCache(normalized);

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

/** Animals currently excluded from inference, so the choice can be undone. */
export async function listExcludedSubjects(species: string): Promise<Array<{ subjectId: string; name: string }>> {
  const normalized = normalizeSpecies(species);
  const db = getDb();
  const cached = await db.select<Array<{ content_hash: string; name: string }>>(
    'SELECT content_hash, name FROM study_corpus WHERE species = $species AND use_for_studies = $off',
    { species: normalized, off: 0 },
  );
  const local = (
    await db.select<Array<{ id: number; name: string; species: string }>>(
      'SELECT id, name, species FROM pets WHERE use_for_studies = $off',
      { off: 0 },
    )
  ).filter((r) => normalizeSpecies(r.species) === normalized);
  return [
    ...local.map((r) => ({ subjectId: String(r.id), name: r.name })),
    ...cached.map((r) => ({ subjectId: `${SHARED_ID_PREFIX}${r.content_hash}`, name: r.name })),
  ];
}

/**
 * Turn inference on or off for one animal.
 *
 * `subjectId` is what the study calls it: a pet id for a local animal,
 * `shared:<content_hash>` for a cached community one. Both are addressed
 * here because the study reads both and most bad records are community
 * animals, which have no other surface in the app.
 */
export async function setUseForStudies(species: string, subjectId: string, use: boolean): Promise<void> {
  const db = getDb();
  const flag = use ? 1 : 0;
  // Whatever happens below changes the corpus, and a memoised magnitude
  // table derived from the old one would keep feeding the breeding scores an
  // excluded animal's readings for the rest of the session — the Study tab
  // re-solves directly and would silently disagree with the Breed tab.
  clearAttributeMagnitudesCache(species);
  if (subjectId.startsWith(SHARED_ID_PREFIX)) {
    const result = await db.execute(
      'UPDATE study_corpus SET use_for_studies = $flag WHERE species = $species AND content_hash = $hash',
      { flag, species: normalizeSpecies(species), hash: subjectId.slice(SHARED_ID_PREFIX.length) },
    );
    // A hash this species does not hold updates nothing. Reporting success
    // would have the view re-solve and show no change, with nothing to say why.
    if ((result.rowsAffected ?? 0) === 0) {
      throw new Error(`setUseForStudies: no cached ${species} animal for ${subjectId}`);
    }
    return;
  }
  const id = Number(subjectId);
  // `Number('')` is 0, which is an integer and would update `id = 0` — a
  // no-op the caller cannot distinguish from success.
  if (!/^\d+$/.test(subjectId) || !Number.isInteger(id)) {
    throw new Error(`setUseForStudies: not a subject id: ${subjectId}`);
  }
  const result = await db.execute('UPDATE pets SET use_for_studies = $flag WHERE id = $id', { flag, id });
  if ((result.rowsAffected ?? 0) === 0) throw new Error(`setUseForStudies: no pet with id ${id}`);
}

/**
 * Record that the player checked this gene in the game and the declared
 * effect was right.
 *
 * A doubt names two suspects — the hand-entered gene table, or an animal's
 * record — and the engine cannot choose between them. This is the answer
 * coming back, and it is the *commoner* answer: most of the time the table
 * is fine and a pet's attributes were typed wrong.
 *
 * The declaration is stored alongside the slot, not just the slot id,
 * because what was confirmed is a specific claim. Re-declaring the gene in
 * Reference makes the confirmation describe something nobody checked.
 */
export async function confirmGeneDeclaration(
  species: string,
  gene: string,
  expression: Expression,
  attribute: string,
  sign: 1 | -1,
): Promise<void> {
  await getDb().execute(
    `INSERT OR REPLACE INTO gene_confirmations
       (species, gene, expression, attribute, sign, confirmed_at)
     VALUES ($species, $gene, $expression, $attribute, $sign, $confirmed_at)`,
    {
      species: normalizeSpecies(species),
      gene,
      expression,
      attribute,
      sign,
      confirmed_at: now(),
    },
  );
}

/** Forget a confirmation, so the gene can be recommended for checking again. */
export async function withdrawGeneConfirmation(species: string, gene: string, expression: Expression): Promise<void> {
  await getDb().execute(
    'DELETE FROM gene_confirmations WHERE species = $species AND gene = $gene AND expression = $expression',
    { species: normalizeSpecies(species), gene, expression },
  );
}

/**
 * Confirmations that still describe what the gene table currently declares.
 *
 * A confirmation is about a claim, not a slot. If the gene has since been
 * re-declared — a different attribute, or the other direction — then what
 * the player verified is no longer what the app believes, and the slot goes
 * back to being an open question. Stale rows are left in place rather than
 * deleted: re-declaring a gene back to what it was should bring the old
 * confirmation back with it, since the player really did check that claim.
 */
export async function liveGeneConfirmations(
  species: string,
  slots: readonly EffectSlot[],
): Promise<ReadonlySet<string>> {
  const normalized = normalizeSpecies(species);
  const rows = await getDb().select<Array<{ gene: string; expression: string; attribute: string; sign: number }>>(
    'SELECT gene, expression, attribute, sign FROM gene_confirmations WHERE species = $species',
    { species: normalized },
  );
  const confirmed = new Map(rows.map((r) => [`${r.gene}:${r.expression}`, r]));
  const live = new Set<string>();
  for (const slot of slots) {
    const key = slotKey(slot);
    const row = confirmed.get(key);
    if (row && row.attribute === slot.attribute && row.sign === slot.sign) live.add(key);
  }
  return live;
}

/**
 * A durable fingerprint of everything the solve depends on.
 *
 * The in-memory revisions (`localPetsRevision`, `geneDeclarationsRevision`)
 * are counters that reset when the app restarts, so they cannot key a cache
 * that outlives the session. This reads the inputs themselves instead.
 *
 * Deliberately cheap: small per-row summaries, never the genomes themselves.
 * A cached animal's `content_hash` is its genome's digest, so that half is
 * exact. A local animal's is not: `content_hash` is set at upload and
 * `updatePet` never recomputes it, so a direct `genome_data` rewrite is
 * covered only by the gene counts it does recompute — `positive_genes` and
 * the total/known/unknown trio.
 *
 * **The one gap that leaves**: a genome rewritten through `updatePet` into a
 * different genome with identical counts, name, breed and readings would
 * fingerprint the same. No UI path passes `genome_data` to `updatePet` today,
 * so it is unreachable; a path that added one should move `content_hash`
 * with it, which would make this exact again.
 *
 * Errs towards re-solving: any input this misses would be a stale table, so
 * everything the corpus load and the solver read is represented here.
 */
async function studyFingerprint(species: string): Promise<string> {
  const db = getDb();
  const normalized = normalizeSpecies(species);
  // Plain selects, summarised in JS. The in-memory adapter used by the tests
  // implements a small subset of SQL — no aggregates, no subqueries, and it
  // drops a `WHERE` it cannot parse rather than failing — so a fingerprint
  // built by the database would be constant there and silently serve a stale
  // table to every test.
  const [pets, cached, genes, confirmations] = await Promise.all([
    db.select<Array<Record<string, unknown>>>(
      `SELECT id, species, name, breed, content_hash, use_for_studies, stabled,
              positive_genes, total_genes, known_genes, unknown_genes, ${ATTRIBUTE_KEYS.join(', ')} FROM pets`,
    ),
    db.select<Array<Record<string, unknown>>>(
      'SELECT content_hash, species, name, breed, attributes, use_for_studies FROM study_corpus',
    ),
    db.select<Array<Record<string, unknown>>>(
      `SELECT animal_type, gene, dominant_attribute, dominant_sign, recessive_attribute, recessive_sign, breed
         FROM genes`,
    ),
    db.select<Array<Record<string, unknown>>>(
      'SELECT species, gene, expression, attribute, sign FROM gene_confirmations',
    ),
  ]);

  const line = (row: Record<string, unknown>, keys: readonly string[]) =>
    keys.map((k) => String(row[k] ?? '')).join(':');
  const summarise = (rows: Array<Record<string, unknown>>, speciesKey: string, keys: readonly string[]) =>
    rows
      .filter((r) => normalizeSpecies(String(r[speciesKey] ?? '')) === normalized)
      .map((r) => line(r, keys))
      .sort()
      .join(',');

  return sha256Hex(
    [
      // The inputs themselves rather than `updated_at`: a rename and an
      // attribute correction are both study inputs, and a timestamp is only
      // as good as its resolution — two edits inside one tick would collide.
      summarise(pets, 'species', [
        'id',
        'name',
        'breed',
        'content_hash',
        'use_for_studies',
        'stabled',
        // Recomputed by `updatePet` whenever the genome is rewritten, which
        // is the only way `pet_genes` changes without a fresh upload. See the
        // caveat in this function's doc.
        'positive_genes',
        'total_genes',
        'known_genes',
        'unknown_genes',
        ...ATTRIBUTE_KEYS,
      ]),
      summarise(cached, 'species', ['content_hash', 'name', 'breed', 'attributes', 'use_for_studies']),
      summarise(genes, 'animal_type', [
        'gene',
        'dominant_attribute',
        'dominant_sign',
        'recessive_attribute',
        'recessive_sign',
        'breed',
      ]),
      summarise(confirmations, 'species', ['gene', 'expression', 'attribute', 'sign']),
    ].join('|'),
  );
}

/** Read the persisted table, if it was solved from exactly these inputs. */
async function loadPersistedMagnitudes(species: string, fingerprint: string): Promise<AttributeMagnitudes | undefined> {
  const rows = await getDb().select<Array<{ fingerprint: string; points: string; coverage: string }>>(
    'SELECT fingerprint, points, coverage FROM study_magnitudes WHERE species = $species',
    { species: normalizeSpecies(species) },
  );
  const row = rows[0];
  if (!row || row.fingerprint !== fingerprint) return undefined;
  try {
    const points: unknown = JSON.parse(row.points);
    const coverage: unknown = JSON.parse(row.coverage);
    // `JSON.parse('null')` does not throw and `new Map(null)` is a legal
    // empty map, so without this a null column would read as "nothing is
    // known" and silently drop every scorer back to counting.
    if (!Array.isArray(points) || !Array.isArray(coverage)) return undefined;
    return {
      points: new Map(points as Array<[string, number]>),
      coverage: new Map(coverage as Array<[string, { known: number; total: number }]>),
    };
  } catch {
    // A row that will not parse is worse than no row: re-solve rather than
    // serve half a table.
    return undefined;
  }
}

async function persistMagnitudes(species: string, fingerprint: string, table: AttributeMagnitudes): Promise<void> {
  await getDb().execute(
    `INSERT OR REPLACE INTO study_magnitudes (species, fingerprint, points, coverage, computed_at)
     VALUES ($species, $fingerprint, $points, $coverage, $computed_at)`,
    {
      species: normalizeSpecies(species),
      fingerprint,
      points: JSON.stringify([...table.points]),
      coverage: JSON.stringify([...table.coverage]),
      computed_at: now(),
    },
  );
}

/**
 * Known effect sizes for a species, memoised for the session.
 *
 * The breeding scorers need the magnitudes, not the study around them, and
 * they need them on every re-rank — a species switch, a breed change, a pet
 * edit. Solving the corpus again each time would pay for the whole study to
 * answer a question whose answer has not changed, so the table is computed
 * once per species and kept.
 *
 * **Staleness is cheap in one direction and wrong in the other.** Adding
 * animals only adds findings, and a table that is merely short costs
 * coverage rather than correctness, because an unknown slot scores nothing
 * rather than an estimate — so an import does not invalidate. Two things
 * *revise* a finding, and both must. A community refresh replaces a reading
 * an uploader corrected, which `refreshStudyCorpus` clears explicitly. A
 * local edit does the same thing more quietly: attribute readings are parsed
 * from the pet's name, so renaming a stabled animal revises every magnitude
 * deduced from it, and deleting one withdraws its equations. Editing the gene
 * table is the third case and the sharpest, because it revises the question
 * rather than the answer — see `stamp`. Those last two are what the cached
 * revision below is compared against; without it the Study tab and the
 * Breeding tab can disagree for a whole session.
 *
 * Species without a measurement path (`STUDYABLE_SPECIES`) return the empty
 * table without touching the DB, which is what makes every scorer fall back
 * to counting for them.
 */
interface MagnitudeEntry {
  /** `stamp()` when the study was started. */
  revision: string;
  value: Promise<AttributeMagnitudes>;
  /** The resolved table, once it is in. Read by `peekAttributeMagnitudes`. */
  settled?: AttributeMagnitudes;
}

/**
 * What the memoised table was solved against: the roster it read, and the
 * gene declarations it read them through.
 *
 * Both matter, for different reasons. A roster edit revises a *reading*, so
 * the same slot gets a new magnitude. A gene-table edit revises the
 * *question*: findings are keyed by `gene:expression`, and the attribute a
 * slot belongs to is re-derived from the declarations at scoring time, so a
 * magnitude solved before a slot was re-pointed would be applied to whatever
 * attribute that slot names now — a wrong number, not a missing one.
 */
const stamp = () => `${localPetsRevision()}:${geneDeclarationsRevision()}`;

const magnitudeCache = new Map<string, MagnitudeEntry>();

export async function attributeMagnitudesFor(species: string): Promise<AttributeMagnitudes> {
  const normalized = normalizeSpecies(species);
  if (!STUDYABLE_SPECIES.includes(normalized)) return EMPTY_MAGNITUDES;
  const revision = stamp();
  const existing = magnitudeCache.get(normalized);
  if (existing && existing.revision === revision) return existing.value;

  // Declared before it is built because both callbacks close over it: they
  // run after `entry` is assigned below, never before. Folding the assignment
  // into the initialiser would leave no way to identify this entry from
  // inside its own handlers, which is what the catch turns on.
  let entry: MagnitudeEntry;
  const value = (async () => {
    // The persisted table first: solving is quadratic in corpus size, and
    // nothing about it changes between sessions unless an input does.
    const fingerprint = await studyFingerprint(normalized);
    const stored = await loadPersistedMagnitudes(normalized, fingerprint);
    if (stored) return stored;
    const run = await runAttributeStudy(normalized);
    const built = buildAttributeMagnitudes(run.studies);
    // The solve is deliberately slow, and an input can move while it runs —
    // an exclusion toggled and toggled back, say. Storing it under the
    // fingerprint taken beforehand would tag this table with inputs it was
    // not solved from, and every later session would trust the match.
    const after = await studyFingerprint(normalized);
    if (after === fingerprint) {
      // Best-effort: a table that could not be written is a slow next
      // session, not a wrong one, and must not fail the ranking that just
      // succeeded.
      await persistMagnitudes(normalized, fingerprint, built).catch((error: unknown) =>
        console.warn('study_magnitudes: could not persist', error),
      );
    }
    return built;
  })()
    .then((built) => {
      entry.settled = built;
      return built;
    })
    .catch((error: unknown) => {
      // A failed study must not poison the session: drop the entry so the
      // next re-rank retries, and rank by counts meanwhile. Only if it is
      // still *this* entry — an unconditional delete would discard a newer
      // one that a rename or an explicit clear had already put in its place.
      if (magnitudeCache.get(normalized) === entry) magnitudeCache.delete(normalized);
      console.error('attributeMagnitudesFor failed', error);
      return EMPTY_MAGNITUDES;
    });
  entry = { revision, value };
  magnitudeCache.set(normalized, entry);
  return value;
}

/**
 * The memoised table, but only if it is already solved and still current.
 *
 * The study is the expensive half of a ranking and its cost is quadratic in
 * corpus size, so a view that awaits it unconditionally holds itself shut on
 * the first open of a session. With this, a caller can render immediately
 * from counts and upgrade to points when the solve lands, and pay nothing
 * extra on every later open — by then the table is in hand.
 *
 * `undefined` means "not ready", never "nothing known": a species with no
 * measurement path returns the empty table, which *is* its final answer.
 */
export function peekAttributeMagnitudes(species: string): AttributeMagnitudes | undefined {
  const normalized = normalizeSpecies(species);
  if (!STUDYABLE_SPECIES.includes(normalized)) return EMPTY_MAGNITUDES;
  const entry = magnitudeCache.get(normalized);
  if (!entry || entry.revision !== stamp()) return undefined;
  return entry.settled;
}

/** Drop the memoised magnitudes for a species, or all of them. */
export function clearAttributeMagnitudesCache(species?: string): void {
  if (species) magnitudeCache.delete(normalizeSpecies(species));
  else magnitudeCache.clear();
}
