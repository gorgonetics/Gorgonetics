/**
 * Pure visibility predicate for the gene grid (`GeneVisualizer`).
 *
 * `isGeneVisible` used to be a closure inside the component that read its
 * reactive state and effect helpers directly, so it was unreachable by unit
 * tests — and the TS migration (#306) silently flipped the appearance-view
 * attribute filter without any test catching it (fixed in #309). Extracted
 * here as a pure function taking explicit `state` and an injected
 * `effectLookup`, so the truth table can be characterised directly.
 *
 * Behaviour is byte-for-byte identical to the original closure; only the
 * inputs are now explicit instead of captured.
 */

/** The filter state the predicate reads, lifted out of the component. */
export interface GeneFilterState {
  selectedChromosomes: string[];
  hiddenChromosomes: string[];
  selectedAttributes: string[];
  hiddenAttributes: string[];
  currentEffectFilter: string[];
  hiddenEffectFilters: string[];
  currentValueFilter: string[];
  hiddenValueFilters: string[];
  currentView: 'attribute' | 'appearance';
}

/**
 * Effect-database-backed helpers, injected so the predicate stays pure. The
 * component binds these to the loaded `effectsDB` and the current species; the
 * tests supply trivial stubs.
 */
export interface GeneEffectLookup {
  /** Whether either allele of `geneId` could affect any of `selectedAttributes` (attribute view). */
  affectsSelectedAttributes(geneId: string, selectedAttributes: string[]): boolean;
  /** Whether a `neutral`-typed gene has a latent D/R effect (drives the neutral→potential promotion). */
  hasAnyPotentialEffect(geneId: string): boolean;
  /** The promoted potential type for a neutral gene, or null when neither allele is signed. */
  potentialEffectType(geneId: string): string | null;
}

interface FilterGene {
  id: string;
  type: string;
}

interface FilterGeneAnalysis {
  type: string;
  attribute: string | null;
}

/** The `gene-<zygosity>` class used by the value filters. */
function zygosityClass(geneType: string): string {
  const zygosity =
    geneType === 'D'
      ? 'dominant'
      : geneType === 'R'
        ? 'recessive'
        : geneType === 'x'
          ? 'mixed'
          : geneType === '?'
            ? 'unknown'
            : 'recessive';
  return `gene-${zygosity}`;
}

/**
 * Resolve a gene's effect type for the effect filters, promoting a `neutral`
 * gene to its latent potential type when it has one.
 */
function resolveEffectType(geneId: string, baseType: string, effectLookup: GeneEffectLookup): string {
  if (baseType === 'neutral' && effectLookup.hasAnyPotentialEffect(geneId)) {
    const potentialType = effectLookup.potentialEffectType(geneId);
    if (potentialType) return potentialType;
  }
  return baseType;
}

/** Whether a gene cell should be visible given the active filters. */
export function isGeneVisible(
  chromosome: string,
  gene: FilterGene,
  geneAnalysis: FilterGeneAnalysis,
  state: GeneFilterState,
  effectLookup: GeneEffectLookup,
): boolean {
  // Chromosome filter
  if (state.selectedChromosomes.length > 0 && !state.selectedChromosomes.includes(chromosome)) {
    return false;
  }

  // Hidden chromosomes
  if (state.hiddenChromosomes.includes(chromosome)) {
    return false;
  }

  // Attribute filter
  if (state.currentView === 'attribute') {
    if (
      state.selectedAttributes.length > 0 &&
      !effectLookup.affectsSelectedAttributes(gene.id, state.selectedAttributes)
    ) {
      return false;
    }
  } else {
    // Coerce a null attribute to '' (never a selected value) so that a gene
    // with no attribute is filtered out when a specific attribute is selected.
    if (state.selectedAttributes.length > 0 && !state.selectedAttributes.includes(geneAnalysis.attribute ?? '')) {
      return false;
    }
  }

  // Hidden attributes
  if (geneAnalysis.attribute && state.hiddenAttributes.includes(geneAnalysis.attribute)) {
    return false;
  }

  // Effect filter
  if (state.currentEffectFilter.length > 0) {
    const effectType = resolveEffectType(gene.id, geneAnalysis.type, effectLookup);
    if (!state.currentEffectFilter.includes(effectType)) return false;
  }

  // Hidden effects
  if (state.hiddenEffectFilters.length > 0) {
    const effectType = resolveEffectType(gene.id, geneAnalysis.type, effectLookup);
    if (state.hiddenEffectFilters.includes(effectType)) return false;
  }

  // Value filter
  if (state.currentValueFilter.length > 0) {
    const geneTypeClass = zygosityClass(gene.type);
    if (!state.currentValueFilter.some((value) => geneTypeClass.includes(value))) return false;
  }

  // Hidden values
  if (state.hiddenValueFilters.length > 0) {
    const geneTypeClass = zygosityClass(gene.type);
    if (state.hiddenValueFilters.some((value) => geneTypeClass.includes(value))) return false;
  }

  return true;
}
