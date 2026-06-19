/**
 * Pure stat-accumulation for the gene grid (`GeneVisualizer`).
 *
 * `initializeStats` builds the empty per-view stats map and `updateStats`
 * folds a single analysed gene into it. Both were component methods that read
 * reactive state directly; lifted here with the view and resolved attribute
 * names passed in so the accumulation can be characterised by unit tests.
 */

/** Per-attribute breakdown in the attribute view. */
export interface AttrStatEntry {
  positive: number;
  negative: number;
  dominant: number;
  recessive: number;
  mixed: number;
}

/** Stats map: scalar counters plus per-attribute entries (attribute view). */
export type StatsMap = Record<string, AttrStatEntry | number>;

type GeneView = 'attribute' | 'appearance';

interface StatsGeneAnalysis {
  type: string;
  attribute: string | null;
}

/**
 * Build the empty stats map for a view. `attrNames` is the resolved attribute
 * list — capitalised attribute names in the attribute view, appearance keys in
 * the appearance view — so this stays free of config lookups.
 */
export function initializeStats(view: GeneView, attrNames: string[]): StatsMap {
  if (view === 'attribute') {
    const emptyAttr = (): AttrStatEntry => ({ positive: 0, negative: 0, dominant: 0, recessive: 0, mixed: 0 });
    const stats: StatsMap = {
      positive: 0,
      negative: 0,
      neutral: 0,
      'potential-positive': 0,
      'potential-negative': 0,
      'inactive-breed': 0,
      // Global gene-type counters (unique genes, not per-attribute)
      _dominant: 0,
      _recessive: 0,
      _mixed: 0,
    };
    for (const attr of attrNames) {
      stats[attr] = emptyAttr();
    }
    return stats;
  }

  const stats: StatsMap = { 'appearance-neutral': 0, 'inactive-breed': 0 };
  for (const attr of attrNames) {
    stats[attr] = 0;
  }
  return stats;
}

/** Fold a single analysed gene into the stats map (mutates `stats`). */
export function updateStats(stats: StatsMap, geneAnalysis: StatsGeneAnalysis, geneType: string, view: GeneView): void {
  // Skip inactive-breed genes from all stats
  if (geneAnalysis.type === 'inactive-breed') {
    (stats['inactive-breed'] as number)++;
    return;
  }

  if (view === 'attribute') {
    const typeVal = stats[geneAnalysis.type];
    if (typeof typeVal === 'number') stats[geneAnalysis.type] = typeVal + 1;

    // Global gene-type counters (one per unique gene)
    if (geneType === 'D') (stats._dominant as number)++;
    else if (geneType === 'R') (stats._recessive as number)++;
    else if (geneType === 'x') (stats._mixed as number)++;

    if (geneAnalysis.attribute) {
      const attrStats = stats[geneAnalysis.attribute];
      if (attrStats && typeof attrStats === 'object') {
        const as = attrStats as AttrStatEntry;
        // Track gene type (D/R/x)
        if (geneType === 'D') as.dominant++;
        else if (geneType === 'R') as.recessive++;
        else if (geneType === 'x') as.mixed++;

        // Only count confirmed positive/negative effects (not potential)
        if (geneAnalysis.type === 'positive' || geneAnalysis.type === 'negative') {
          as[geneAnalysis.type]++;
        }
      }
    }
  } else {
    const typeVal = stats[geneAnalysis.type];
    if (typeof typeVal === 'number') stats[geneAnalysis.type] = typeVal + 1;
  }
}
