/**
 * Wild animals: genomes analysed before capture (#367).
 *
 * The game writes a wild animal's gene file in the same format as a stabled
 * one, and names it by kind instead of by pet: `Entity=Wild Horse`. That line
 * is the only marker, so detection reads it and nothing else — the genome of a
 * wild animal can look like anything a stabled one can.
 */

import { parseGenomeFileHeader } from '#lib/services/genomeParser.js';

/** `Entity` values the game writes for an uncaptured animal. Only horses are confirmed. */
export const WILD_ENTITY_NAMES: ReadonlySet<string> = new Set(['Wild Horse']);

/** The wild entity a genome file names, or `null` for a named (captured) animal. */
export function wildEntity(content: string): string | null {
  const entity = parseGenomeFileHeader(content).name;
  return WILD_ENTITY_NAMES.has(entity) ? entity : null;
}

/**
 * A name that tells wild animals apart. Every wild file carries the same
 * entity, so the import time is what distinguishes them; the player can
 * rename it, and capture replaces it with the pet's name.
 */
export function wildPetName(entity: string, at: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const date = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
  return `${entity} ${date} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
}
