/**
 * Core type definitions for Gorgonetics.
 * Ported from Python: constants.py, models.py
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
  'Standardbred': 'Sb',
  'Kurbone': 'Kb',
  'Ilmarian': 'Il',
  'Plateau Pony': 'Po',
  'Satincoat': 'Sc',
  'Statehelm': 'St',
  'Blanketed': 'Bl',
  'Leopard': 'Le',
  'Paint': 'Pt',
  'Calico': 'Cl',
};

export const HORSE_BREED_ABBREVIATIONS: Record<string, string> = Object.fromEntries(
  Object.entries(HORSE_BREEDS).map(([k, v]) => [v, k])
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
