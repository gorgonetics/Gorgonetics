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
  genome_data: string;
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
