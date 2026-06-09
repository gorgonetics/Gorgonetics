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
 * Per-pair scoring output for the Breeding Assistant. `evMixed` covers
 * every locus the parents share (attribute + appearance + selector) and
 * is the predictability metric; `evPositiveByAttribute` is attribute-only
 * and broken down per attribute so the breeder can sort to target one.
 */
export interface BreedingPairResult {
  male: Pet;
  female: Pet;
  evMixed: number;
  evPositiveByAttribute: Record<string, number>;
  evPositiveTotal: number;
  evUnknown: number;
  totalLoci: number;
}

// --- Comparison types ---

export interface AttributeComparisonResult {
  key: string;
  name: string;
  icon: string;
  petAValue: number;
  petBValue: number;
  diff: number;
  winner: 'a' | 'b' | 'tie';
}

export interface GeneStatsEntry {
  positive: number;
  negative: number;
  dominant: number;
  recessive: number;
  mixed: number;
}

export interface GeneStatsComparisonResult {
  key: string;
  name: string;
  icon: string;
  petA: GeneStatsEntry;
  petB: GeneStatsEntry;
}

export interface GeneDiffEntry {
  geneId: string;
  block: string;
  position: number;
  petAType: GeneType | null;
  petBType: GeneType | null;
  isDifferent: boolean;
  petAEffect?: string;
  petBEffect?: string;
}

export interface ChromosomeDiff {
  chromosome: string;
  totalGenes: number;
  identicalGenes: number;
  differentGenes: number;
  genes: GeneDiffEntry[];
}

export interface ComparisonResult {
  petA: Pet;
  petB: Pet;
  species: string;
  attributes: AttributeComparisonResult[];
  geneStats: GeneStatsComparisonResult[];
  genomeDiff: ChromosomeDiff[];
  summary: {
    totalGenes: number;
    identicalGenes: number;
    differentGenes: number;
    similarityPercent: number;
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
  schemaVersion: number;
  appVersion: string;
  genomeData?: string;
  uploadedAt: Date;
  uploaderUid: string | null;
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
