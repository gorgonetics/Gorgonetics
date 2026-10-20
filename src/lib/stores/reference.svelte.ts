/**
 * Reactive state for the Reference view.
 *
 * Lives at module scope so the species pick survives destination switches:
 * the view unmounts when the player navigates away, but this state persists
 * for the session.
 */
export const referenceView = $state({
  /**
   * Gene-table animal type the player picked (e.g. `horse`). '' means "not
   * chosen yet" — ReferenceView then derives a default (the most-populated
   * species) instead of showing an empty prompt.
   */
  animalType: '' as string,
  /** Which genome-map lens is showing. */
  lens: 'rarity' as 'rarity' | 'impact' | 'never',
  /** Never-seen lens: hide chromosome rows with no never-seen allele. */
  hideSeenChromosomes: false,
  /** Never-seen lens: hide never-seen alleles with no declared effect. */
  hideNoEffect: false,
});
