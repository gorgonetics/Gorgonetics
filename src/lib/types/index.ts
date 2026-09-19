/**
 * Core type definitions for Gorgonetics.
 */

// --- Enums ---

export const GeneType = {
  RECESSIVE: 'R',
  DOMINANT: 'D',
  MIXED: 'x',
  UNKNOWN: '?',
} as const;
export type GeneType = (typeof GeneType)[keyof typeof GeneType];

export const Gender = {
  MALE: 'Male',
  FEMALE: 'Female',
} as const;
export type Gender = (typeof Gender)[keyof typeof Gender];

// --- Constants ---

export const DEFAULT_ATTRIBUTE_VALUE = 50;
export const GENOME_FILE_MARKERS = ['[Overview]', 'Genome Type:'];

// --- Gene / Genome types ---

export interface Gene {
  chromosome: string;
  block: string;
  position: number;
  gene_type: GeneType;
}

export interface GeneRecord {
  animal_type: string;
  chromosome: string;
  gene: string;
  effectDominant: string;
  effectRecessive: string;
  appearance: string;
  breed: string;
  notes: string;
}

export interface Genome {
  format_version: string;
  breeder: string;
  name: string;
  genome_type: string;
  genes: Record<string, Gene[]>;
}

// --- Pet types ---

export interface CoreAttributes {
  intelligence: number;
  toughness: number;
  friendliness: number;
  ruggedness: number;
  enthusiasm: number;
  virility: number;
}

export interface BeeWaspAttributes extends CoreAttributes {
  ferocity: number;
}

export interface HorseAttributes extends CoreAttributes {
  temperament: number;
}

export type PetAttributes = CoreAttributes | BeeWaspAttributes | HorseAttributes;

export interface Pet {
  id: number;
  name: string;
  species: string;
  gender: Gender;
  breed: string;
  breeder: string;
  content_hash: string;
  /**
   * Parsed-and-JSON-stringified genome. **Optional on the type because the
   * hot list path omits it:** `getAllPets` SELECTs an explicit column list
   * that excludes the heavy genome columns (issue #254), so pets flowing
   * from the list / `selectedPet` carry `undefined` here. Full-row fetches
   * (`getPet`, `findPetByHash`) still populate it. Gene rendering re-reads
   * from `pet_genes` by id (`loadPetGridFromDb`), so list consumers never
   * need this field.
   */
  genome_data?: string;
  /**
   * Raw `[Overview]` / `[Genes]` text of the genome file, byte-identical to
   * what was uploaded. Used by the community share path: `content_hash` is
   * the SHA-256 of this string, and `genome_data` is the parsed JSON
   * representation (which is lossy w.r.t. whitespace, so its hash would
   * not match `content_hash`). Empty for rows that predate migration v13.
   *
   * Optional for the same reason as `genome_data` — omitted on the list
   * path. The share dialog lazy-fetches it by id via `getPetGenomeText`.
   */
  genome_text?: string;
  notes: string;
  tags: string[];
  created_at: string;
  updated_at: string;
  // Dynamic attribute columns
  intelligence: number;
  toughness: number;
  friendliness: number;
  ruggedness: number;
  enthusiasm: number;
  virility: number;
  ferocity: number;
  temperament: number;
  // Persisted gene-analysis fields (computed at upload time)
  positive_genes: number;
  // User-toggled flags
  starred: boolean;
  stabled: boolean;
  is_pet_quality: boolean;
  // Computed fields (added by service layer)
  readonly?: boolean;
  is_demo?: boolean;
  has_unknown_genes?: boolean;
  total_genes?: number;
  known_genes?: number;
  unknown_genes?: number;
}

// --- Horse breed data ---

export const HORSE_BREEDS: Record<string, string> = {
  Standardbred: 'Sb',
  Kurbone: 'Kb',
  Ilmarian: 'Il',
  'Plateau Pony': 'Po',
  Satincoat: 'Sc',
  Statehelm: 'St',
  Blanketed: 'Bl',
  Leopard: 'Le',
  Paint: 'Pt',
  Calico: 'Cl',
};

export const HORSE_BREED_ABBREVIATIONS: Record<string, string> = Object.fromEntries(
  Object.entries(HORSE_BREEDS).map(([k, v]) => [v, k]),
);

// --- Config display types ---

export interface AttributeInfo {
  key: string;
  name: string;
  icon: string;
  description: string;
}

export interface AppearanceInfo {
  key: string;
  name: string;
  examples: string;
  color_indicator: string;
}

// --- Backup export/import types ---

export interface BackupContents {
  genes: boolean;
  pets: boolean;
  images: boolean;
}

export interface GorgonExportMetadata {
  format: 'gorgonetics-backup';
  format_version: number;
  schema_version: number;
  app_version: string;
  exported_at: string;
  contents?: BackupContents;
  record_counts: { genes: number; pets: number; images?: number };
}

/** v1 legacy format (single JSON file) */
export interface GorgonExport {
  metadata: GorgonExportMetadata;
  data: {
    genes: Record<string, unknown>[];
    pets: Record<string, unknown>[];
  };
}

export type ImportMode = 'replace' | 'merge';

export interface ExportOptions {
  includeGenes: boolean;
  includePets: boolean;
  includeImages: boolean;
}

export interface ImportOptions {
  mode: ImportMode;
  includeGenes: boolean;
  includePets: boolean;
  includeImages: boolean;
}

export interface ExportResult {
  saved: boolean;
  genes: number;
  pets: number;
  images: number;
}

export interface ImportResult {
  genes: number;
  pets: number;
  petsSkipped: number;
  images: number;
  imagesSkipped: number;
}

// --- Pet image types ---

export interface PetImage {
  id: number;
  pet_id: number;
  filename: string;
  original_name: string;
  caption: string;
  tags: string[];
  created_at: string;
  url?: string;
}

// --- Visualization types ---

export interface VisualizationGene {
  gene_id: string;
  chromosome: string;
  block: string;
  position: number;
  gene_type: GeneType;
  effectDominant?: string;
  effectRecessive?: string;
  appearance?: string;
}

export interface PetGenomeVisualization {
  pet_id: number;
  pet_name: string;
  species: string;
  chromosomes: Record<string, VisualizationGene[]>;
}

// --- Breeding types ---

/**
 * Probability distribution over the four possible offspring gene types
 * at a single locus. `D + x + R + unknown == 1` for any non-degenerate
 * distribution. `unknown` carries the mass when at least one parent's
 * allele is `?` — see `offspringDistribution` in `utils/breedingGenetics`.
 */
export interface AlleleDistribution {
  D: number;
  x: number;
  R: number;
  unknown: number;
}

/**
 * What one parent itself expresses, on exactly the loci and breed scope the
 * offspring EV uses — so a parent's figure and the foal's are comparable.
 *
 * Deliberately **not** `pets.positive_genes`, which is scoped to the pet's own
 * breed: comparing that against an offspring EV scoped to the target breed
 * compares two different locus sets and manufactures a difference out of the
 * mismatch.
 *
 * Surfaced per parent, not just as the max/min the improvement integrals use,
 * because the table shows an absolute expected count and a reader cannot tell
 * whether it is good without the two numbers it should be read against.
 */
export interface ParentExpressedProfile {
  positives: number;
  negatives: number;
  /** Positive count keyed by the (capitalized) attribute it lands on. */
  positivesByAttribute: Record<string, number>;
  /**
   * Net attribute points this parent expresses, keyed the same way — the
   * baseline a points improvement is measured against.
   *
   * Absent when no magnitudes are known, which is what makes the scorers
   * fall back to counting. Sums both signs over slots the study has pinned
   * down, so it is a floor on the parent's true attribute total, measured
   * on the same slots the offspring EV uses.
   */
  pointsByAttribute?: Record<string, number>;
}

/**
 * Per-pair scoring output for the Breeding Assistant. `evMixed` covers
 * every locus the parents share (attribute + appearance + selector) and
 * is the predictability metric; `evPositiveByAttribute` is attribute-only
 * and broken down per attribute so the breeder can sort to target one.
 *
 * `evPositiveWeighted` is the pool-gap-aware variant: each positive slot's
 * expected mass is scaled by how well the candidate pool already covers that
 * slot (missing > partial > locked), so a pair that fills a gap nothing else
 * covers outranks one re-covering an already-secured positive. Raw EV stays
 * untouched for display; the weighted figure is a separate "Pool-weighted +"
 * column.
 *
 * **It is not a gain over the parents**, despite an earlier name that said so.
 * It is the same absolute expected count, re-weighted: a positive both parents
 * already breed true still scores, at the lowest `locked` weight. Only
 * `evCapabilityGain` differences against what the stable can already do.
 */
export interface BreedingPairResult {
  male: Pet;
  female: Pet;
  evMixed: number;
  evPositiveByAttribute: Record<string, number>;
  evPositiveTotal: number;
  evPositiveWeighted: number;
  /**
   * Expected capability the foal adds to the stable — the Genetic Quality
   * Score's measure run forward (see `docs/design/genetic-quality-score-v1.md`).
   * Unlike `evPositiveWeighted` it cannot credit an allele nothing in the
   * pool carries, because a foal only realises what its parents supply, so
   * the inert `missing` tier of `GAP_WEIGHT` cannot arise.
   *
   * Deliberately coarse: it takes 17 distinct values across a 234-pair
   * stable, 64 of them zero. Sort by it first and break ties on
   * `evPositiveTotal`, which takes 108 — the pair is near-totally ordered
   * where neither is alone.
   *
   * **Not additive across a plan** — two pairs that secure the same allele
   * add it once, not twice. See `breedingPlan.ts`, where plans are summed
   * and the size of the overcount is recorded.
   */
  evCapabilityGain: number;
  /**
   * `E[max(0, offspring positives - better parent's positives)]`.
   *
   * The improvement metric, and the tie-break for `evCapabilityGain`.
   * `evPositiveTotal` is an absolute level, so ranking by it rewards
   * breeding the two best animals together — measured on a real stable,
   * three of its top six pairings produce offspring almost certain to be
   * *worse* than a parent. Scoring improvement instead points breeding at
   * ground the stable has not already taken.
   *
   * Baseline is the **better** parent, deliberately: beating the weaker one
   * is not progress.
   */
  evPositiveImprovement: number;
  /**
   * `E[max(0, offspring positives - weaker parent's positives)]` — the
   * value of a foal that cannot beat the better parent but can replace the
   * weaker one, giving a stronger pair next generation.
   *
   * Reported beside `evPositiveImprovement`, never blended into it: they
   * are different strategies. One raises the ceiling, this raises the
   * floor. On a real stable 113 of 234 pairings score near-zero frontier
   * improvement yet a substantial pair upgrade — value that a
   * better-parent baseline alone makes invisible.
   *
   * **Reads high for lopsided pairings by construction** (correlation 0.75
   * with the gap between the parents), because a weak baseline is easy to
   * clear. That is an honest description of the strategy — pairing your
   * best with your worst really does upgrade the worst slot — not a defect,
   * but it means the column must not be read as overall pair quality.
   */
  evPairUpgrade: number;
  /**
   * The better parent's own positive-effect count, on the same locus basis
   * and breed scope as `evPositiveTotal` — so the two are comparable.
   * Deliberately not `pets.positive_genes`, which is scoped to each pet's
   * own breed rather than the offspring's.
   */
  betterParentPositives: number;
  /** The weaker parent's own count, same basis. Baseline for `evPairUpgrade`. */
  weakerParentPositives: number;
  /**
   * Per-attribute expected improvement, each measured against the better
   * parent **on that attribute**.
   *
   * The fifth breeding purpose: lifting one trait that is lagging. The
   * absolute `evPositiveByAttribute` cannot express it — a pairing can lead
   * the field on Intelligence while being unable to improve on either
   * parent's Intelligence, which is the local maximum again, per attribute.
   */
  evAttributeImprovement: Record<string, number>;
  /**
   * The same two figures in attribute *points* rather than effect counts,
   * present only when `attributeStudy` has pinned down at least one
   * magnitude (see `attributePoints.ts`).
   *
   * `evPointsByAttribute` is the offspring's expected net change on each
   * attribute — both signs, summed over the slots whose magnitude is known
   * — and `evAttributePointImprovement` is that measured against the better
   * parent on that attribute, exactly as `evAttributeImprovement` is.
   *
   * Two fields rather than a replacement, because they are in different
   * units and a player who has run no study still has the counts. The
   * per-attribute objectives prefer points where they exist, so which one
   * ranks a pairing follows the corpus rather than a setting.
   *
   * Partial coverage makes these a *floor*: an attribute with 7 of 9 slots
   * known is scored over those 7 for every pair. The comparison between
   * pairs stays fair; the absolute number is not the game's. The UI is
   * expected to show the coverage beside it.
   */
  evPointsByAttribute?: Record<string, number>;
  evAttributePointImprovement?: Record<string, number>;
  /** Expected number of negative effects the offspring expresses. */
  evNegativeTotal: number;
  /**
   * `E[max(0, cleaner parent's negatives - offspring negatives)]` — the
   * fourth breeding purpose, and the one none of the others can express.
   *
   * A pairing can be worth making purely to drop a negative the line has
   * been carrying, even when the foal is worse than both parents on
   * positive count. Ranking by any positive-side measure hides those
   * pairings entirely.
   *
   * Baseline is the parent with *fewer* negatives, so the measure asks
   * whether the line gets cleaner than its cleanest member — the mirror of
   * `evPositiveImprovement`, not of `evPairUpgrade`.
   */
  evLiabilityReduction: number;
  /** The cleaner parent's own negative count. Baseline for the above. */
  cleanerParentNegatives: number;
  /**
   * Each parent's own expressed profile, same locus basis as the offspring EV.
   *
   * `betterParentPositives` and friends are the baselines the improvement
   * integrals ran against; these are what the reader needs to interpret the
   * absolute columns, which carry no baseline of their own.
   */
  maleProfile: ParentExpressedProfile;
  femaleProfile: ParentExpressedProfile;
  /**
   * Standard deviation of the offspring's positive count — the spread
   * `evPositiveImprovement` and `evPairUpgrade` integrate over.
   *
   * Surfaced because those two are `E[max(0, X - baseline)]`, a function of
   * mean, spread *and* baseline together. Without the spread the trio view
   * could only restate the score, never show what produced it: two pairs
   * with the same mean and baseline can rank differently, and the spread is
   * the whole reason.
   */
  positiveSd: number;
  /** Spread of the offspring's negative count. Baseline for `evLiabilityReduction`. */
  negativeSd: number;
  evUnknown: number;
  totalLoci: number;
}

// --- Comparison types ---

export interface GeneStatsEntry {
  positive: number;
  negative: number;
  dominant: number;
  recessive: number;
  mixed: number;
}

/** Aggregate counts for a two-pet genome diff, shared across the comparison UI. */
export interface GenomeDiffSummary {
  totalGenes: number;
  identicalGenes: number;
  differentGenes: number;
  similarityPercent: number;
}

// --- Offspring trio types ---

/**
 * Per-locus verdict for the trio (Father / Offspring / Mother) view.
 *  - `gain`: offspring can express a positive neither parent expresses,
 *    or lock in a positive both parents share (consolidated in the offspring).
 *  - `risk`: offspring can express a negative neither parent expresses.
 *  - `neutral`: no expression change worth flagging.
 */
export type TrioVerdict = 'gain' | 'risk' | 'neutral';

/**
 * The offspring's Punnett outcome at one locus, split by how it compares
 * with the parents. Every field is a probability mass (0–1, multiples of
 * 0.25 for known loci); they sum to 1.
 *  - `newPositive`: expresses a positive **neither** parent expresses.
 *  - `clarifiedPositive`: keeps a positive a parent has **and** clears a mixed
 *    gene to homozygous (dominant or recessive) — the community "Clarification"
 *    outcome. Same expressed effect as a mixed parent, but breeds true, so
 *    future breeding is less random.
 *  - `keepPositive`: keeps a positive a parent has, still mixed (no clarification).
 *  - `neutral`: no effect either way, unchanged.
 *  - `keepNegative`: keeps a negative a parent has.
 *  - `loss`: a new negative neither parent has, or losing a positive a parent had.
 *  - `unknown`: parent allele unknowable (skill-gated) → outcome unprojectable.
 * `newPositive` and `clarifiedPositive` stay separate so the view can toggle
 * which one it highlights as the gain (see `TrioGainMode`).
 */
export interface OffspringOutcomeBuckets {
  newPositive: number;
  clarifiedPositive: number;
  keepPositive: number;
  neutral: number;
  keepNegative: number;
  loss: number;
  unknown: number;
}

/**
 * Which improvement the trio offspring cell highlights as the (vivid) gain:
 *  - `attributes`: expressing a new positive effect.
 *  - `clarification`: clearing a mixed gene to homozygous (breeds true).
 * The other collapses into the muted "keep" shade. The classification itself
 * is mode-independent; the mode only remaps colours.
 */
export type TrioGainMode = 'attributes' | 'clarification';

/**
 * One locus's share of the pair scores that are a plain sum over loci.
 *
 * **Only the additive scores appear here, and that is the point.** `Quality`
 * (`evCapabilityGain`), `Pool-weighted +` (`evPositiveWeighted`) and `Total +`
 * (`evPositiveTotal`) are accumulated locus by locus in `scorePair`, so each
 * locus has an exact, extractable contribution that sums back to the column
 * the breeding table shows.
 *
 * `Ceiling`, `Floor` and `Cleanup` deliberately have no field here. They are
 * `E[max(0, X - baseline)]` evaluated *after* the loop, from three scalars
 * (mean, spread, baseline); a locus reaches them only through the first two.
 * The gradient of that integral with respect to the mean is a single
 * constant across the whole genome, so any honest per-locus attribution for
 * Ceiling collapses to `pPositive` scaled by that constant — identical to
 * Floor's, and identical in ranking to `Total +`. Offering them as distinct
 * lenses would draw a distinction the arithmetic does not make, so the trio
 * explains those three with the score panel instead.
 */
export interface TrioLocusContributions {
  /** Share of `evPositiveTotal` — p(offspring expresses a positive here). */
  positive: number;
  /**
   * Share of `evPositiveWeighted` (Pool-weighted +): the positive mass scaled by
   * `GAP_WEIGHT` for how well the pool already covers each slot. Zero when
   * the trio was built without a candidate pool — coverage is a fact about
   * the pool, not the pair, so it cannot be recovered from two parents.
   */
  poolGain: number;
  /**
   * Share of `evCapabilityGain` (Quality), breed-reach weighted. Zero
   * without a candidate pool, for the same reason: capability is measured
   * against what the rest of the stable can already breed true.
   */
  capability: number;
}

/**
 * Which additive score the trio's offspring cells are tinted by, or `off`
 * for the default outcome-bucket rendering.
 */
export type TrioContributionMode = 'off' | 'capability' | 'poolGain' | 'positive';

/**
 * One locus in the trio view. `dist` is the offspring's probabilistic
 * outcome (the middle row); `fatherType`/`motherType` are the parents'
 * concrete alleles. `source` attributes the beneficial (gain) or
 * dangerous (risk) allele to the contributing parent(s). `buckets` is the
 * outcome split vs the parents that drives the offspring cell's rendering.
 */
export interface GeneTrioEntry {
  geneId: string;
  block: string;
  position: number;
  fatherType: GeneType | null;
  motherType: GeneType | null;
  dist: AlleleDistribution;
  /** Offspring outcome split vs the parents; drives the offspring cell render. */
  buckets: OffspringOutcomeBuckets;
  verdict: TrioVerdict;
  /** Which parent carries the allele driving the verdict; null for neutral/unknown. */
  source: 'father' | 'mother' | 'both' | null;
  /** A `gain` where both parents share the positive, consolidating it in the offspring (homozygous dominant or recessive). */
  lockedIn: boolean;
  /** Probability the offspring expresses a positive / negative effect at this locus. */
  pPositive: number;
  pNegative: number;
  /** This locus's additive share of the pair-level scores it can be attributed to. */
  contributions: TrioLocusContributions;
  /** Display metadata (attribute name and human effect string), when known. */
  attribute?: string;
  fatherEffect?: string;
  motherEffect?: string;
}

export interface ChromosomeTrio {
  chromosome: string;
  totalGenes: number;
  gains: number;
  risks: number;
  genes: GeneTrioEntry[];
}

export interface OffspringTrioResult {
  chromosomes: ChromosomeTrio[];
  summary: {
    totalGenes: number;
    gains: number;
    risks: number;
    lockedIn: number;
    unknownLoci: number;
    /**
     * Whether a candidate pool was supplied, so `capability` and `poolGain`
     * contributions are real rather than zero. Both are measured against the
     * rest of the stable, so without a pool the view must offer neither
     * rather than show a column of zeroes that reads as "contributes
     * nothing".
     */
    poolScored: boolean;
  };
}

// --- Shared UI status types ---

/**
 * Status variants surfaced via the shared `<StatusBanner>` component.
 * Used by share/import dialogs to communicate the outcome of an
 * asynchronous action. `imported` / `already-imported` are
 * community-specific aliases for green/blue used when the message
 * mentions a pet's transition into the local stable.
 */
export type StatusType = 'success' | 'info' | 'warn' | 'error' | 'imported' | 'already-imported';

/**
 * Standard shape for the `onResult` callback used by modal dialogs
 * (ExportDialog, ImportDialog, SharePetDialog, etc.). Surfaces the
 * outcome to the parent component as a toast / banner.
 */
export interface DialogResult {
  type: StatusType;
  message: string;
}

// --- Public pet sharing (Community) types ---

/**
 * One document in the public `/pets` Firestore collection. Mirrors the
 * upload schema enforced by firestore.rules. See
 * docs/design/public-pet-sharing-v1.md §3 for field-by-field rationale.
 *
 * `contentHash` is **not** stored as a field on the document — it is the
 * Firestore document ID. The service layer (`listPets` / `getSharedPet`,
 * PR 2) populates this property from `docSnapshot.id` after fetching, so
 * UI callers can treat `SharedPet` as a flat record. Storing it as a
 * field too would duplicate the doc ID for no gain and is intentionally
 * excluded from the upload schema in `firestore.rules`.
 *
 * `uploadedAt` is a JS `Date` here — the service layer is responsible
 * for converting the wire-level Firestore `Timestamp` via `toDate()`
 * before handing documents to the UI.
 *
 * `tags` is typed `string[]` for the convenience of UI callers, but the
 * service layer must coerce/filter on read: `firestore.rules` enforces
 * per-element string-ness up to a 30-tag cap (see `isValidTagList`), and
 * any document predating that rule version, or any field tampered with
 * via the console, may contain non-string entries that must be dropped
 * before returning the record to the UI.
 *
 * `genomeData` is **optional** because the catalogue is split into two
 * Firestore collections: `/pets/{hash}` (metadata only) and
 * `/genomes/{hash}` (the genome blob). `listPets` returns metadata-only
 * `SharedPet`s with `genomeData === undefined`; `getSharedPet` fetches
 * both halves and returns the combined record. The import / verify paths
 * require `genomeData` and throw if it's missing.
 */
export interface SharedPet {
  contentHash: string;
  name: string;
  character: string;
  species: string;
  gender: Gender;
  breed: string;
  breeder: string;
  notes: string;
  tags: string[];
  /**
   * Corrected attribute values (0–100), keyed by the eight attribute
   * columns. Present on entries shared by app versions that publish
   * attributes; `undefined` on legacy entries, whose attributes the
   * importer re-derives from the genome/name as before. Because the
   * catalogue is add-only, a user correcting attributes publishes a new
   * entry for the same content hash — reads resolve to the latest.
   */
  attributes?: Record<string, number>;
  schemaVersion: number;
  appVersion: string;
  genomeData?: string;
  uploadedAt: Date;
  uploaderUid: string | null;
  /**
   * True when this entry was read from a correction doc (auto-ID, carries
   * a `contentHash` field) rather than the first-share doc (whose ID *is*
   * the hash). The read path uses it to resolve identity fields
   * (name/character/species/gender/breed/breeder) from the first-share
   * entry — corrections may only alter attributes/tags/notes, and this
   * flag lets the client enforce that even for pre-rule poisoned docs.
   */
  isCorrection?: boolean;
}

/**
 * One page of community-catalogue rows plus an opaque cursor for the
 * next call. The cursor is the Firestore `QueryDocumentSnapshot` for the
 * last row — opaque to UI callers because passing it back to `listPets`
 * is the only valid operation. Using a snapshot avoids the
 * Date-millisecond precision loss + missing doc-ID tiebreaker that a
 * `Timestamp.fromDate(date)` cursor would suffer.
 */
export interface SharedPetsPage {
  pets: SharedPet[];
  cursor: unknown | null;
}

/** Cursor-based pagination options for `listPets`. */
export interface ListPetsOpts {
  limit?: number;
  /** Opaque cursor from the previous page's `SharedPetsPage.cursor`. */
  after?: unknown;
}
