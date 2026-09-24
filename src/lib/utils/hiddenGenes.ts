/**
 * Hidden genes: loci a pet's genome shows as `?` because it was studied at a
 * Genetics level too low to reveal them. Reveal depth is frozen per pet at
 * study time, so animals in one stable can disagree about which loci are
 * known.
 *
 * Every breeding score counts a hidden locus as carrying nothing. That is
 * the only honest number, but it is not neutral: an animal can rank as free
 * to release while being the only carrier of something its genome hides, and
 * a pair can rank low for material nobody has seen yet. The panels built on
 * these scores warn with these helpers.
 */

import type { Pet } from '$lib/types/index.js';

/** Hidden loci in a pet's genome; 0 when fully revealed. */
export function hiddenGeneCount(pet: Pick<Pet, 'unknown_genes' | 'has_unknown_genes'>): number {
  if (typeof pet.unknown_genes === 'number') return pet.unknown_genes;
  return pet.has_unknown_genes ? 1 : 0;
}

/** The pets with at least one hidden locus, in input order. */
export function petsWithHiddenGenes<P extends Pick<Pet, 'unknown_genes' | 'has_unknown_genes'>>(
  pets: readonly P[],
): P[] {
  return pets.filter((pet) => hiddenGeneCount(pet) > 0);
}
