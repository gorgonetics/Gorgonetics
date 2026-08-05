/**
 * Build the injected stylesheet for the gene rarity lens (#368).
 *
 * Same mechanism the filters already use: cells are built once and never
 * re-rendered, so switching into the rarity view or changing the population
 * only rewrites the text of one `<style>` element. Nothing here touches the
 * grid, its cell sizing, or the `ResizeObserver` — that is the §4 non-goal,
 * and coupling rarity to the build cycle is what derailed the first attempt.
 *
 * See `docs/design/gene-rarity-lens-v1.md` §4.
 */

import { GeneType } from '$lib/types/index.js';
import { RARITY_BUCKET_NEVER, RARITY_LEVELS } from '$lib/utils/geneFrequency.js';

/** The scoping selector. Matches the container class the view toggles on. */
const SCOPE = '.view-rarity.gene-grid-container';

/**
 * Minimal view of a baseline. `RarityLookup` satisfies this structurally, so
 * this module never imports the service and stays unit-testable with a stub.
 */
export interface RarityBucketSource {
  bucketOf(geneId: string, allele: typeof GeneType.DOMINANT | typeof GeneType.RECESSIVE): number | null;
}

/** One rendered cell: which locus, and which allele(s) the pet carries there. */
export interface RarityCell {
  geneId: string;
  type: GeneType;
}

export interface RarityCSSInput {
  cells: Iterable<RarityCell>;
  lookup: RarityBucketSource;
}

function selectorList(geneIds: readonly string[]): string {
  return geneIds.map((id) => `${SCOPE} .gene-cell[data-gene-id="${id}"]`).join(',\n');
}

/**
 * Same list, one class heavier.
 *
 * The bucket rules only set custom properties, so they feed the static
 * zygosity rules rather than competing with them. The missing-data rule sets
 * `background` directly and would otherwise tie those rules at (0,4,0),
 * leaving source order — the injected `<style>` versus the bundled sheet — to
 * decide the winner. Repeating `.gene-cell` makes it (0,5,0) and settles it.
 */
function missingSelectorList(geneIds: readonly string[]): string {
  return geneIds.map((id) => `${SCOPE} .gene-cell.gene-cell[data-gene-id="${id}"]`).join(',\n');
}

/**
 * Emit **two independent partitions** over the rendered gene ids — one per
 * allele arm — plus a never-seen set and an explicit missing-data set.
 *
 * Six buckets per arm is 12 rules, not 36: the arms never need to be
 * crossed, because a cell reads `--rarity-dom` and `--rarity-rec`
 * independently. A `D` cell receives only the dominant property, an `R` cell
 * only the recessive, and an `x` cell both — which is what makes its diagonal
 * split show one arm against the other.
 *
 * The missing-data set is listed **explicitly** rather than selected with a
 * `:not()`. It is the complement of the union of the buckets, and it cannot
 * be derived in CSS: `--rarity-dom` is applied by this stylesheet, not by an
 * inline `style` attribute, so an attribute-substring match on `style` would
 * never fire. `?` cells already carry `gene-unknown` and would coincidentally
 * look right; cells below `minKnown` do not, which is exactly why the list is
 * required.
 */
export function buildRarityCSS({ cells, lookup }: RarityCSSInput): string {
  const dom: string[][] = Array.from({ length: RARITY_LEVELS }, () => []);
  const rec: string[][] = Array.from({ length: RARITY_LEVELS }, () => []);
  const missing: string[] = [];
  // Cells holding an allele nobody carries. A second channel on top of the pure
  // hue, because the two complementary arms cannot both be never-seen, so one
  // border per cell is unambiguous about which half is lit.
  const never: string[] = [];

  for (const { geneId, type } of cells) {
    if (type === GeneType.UNKNOWN) {
      // Already dashed via `gene-unknown`; no rarity signal exists for it.
      continue;
    }
    const carriesD = type === GeneType.DOMINANT || type === GeneType.MIXED;
    const carriesR = type === GeneType.RECESSIVE || type === GeneType.MIXED;

    const dBucket = carriesD ? lookup.bucketOf(geneId, GeneType.DOMINANT) : null;
    const rBucket = carriesR ? lookup.bucketOf(geneId, GeneType.RECESSIVE) : null;

    // `null` from every arm the cell actually carries means the locus is below
    // the minimum sample — render it as missing data, not as bucket 0.
    if ((carriesD ? dBucket === null : true) && (carriesR ? rBucket === null : true)) {
      missing.push(geneId);
      continue;
    }
    if (dBucket !== null) dom[dBucket].push(geneId);
    if (rBucket !== null) rec[rBucket].push(geneId);
    if (dBucket === RARITY_BUCKET_NEVER || rBucket === RARITY_BUCKET_NEVER) never.push(geneId);
  }

  const out: string[] = [];
  for (let b = 0; b < RARITY_LEVELS; b++) {
    if (dom[b].length > 0) out.push(`${selectorList(dom[b])} { --rarity-dom: var(--rarity-d-${b}); }`);
    if (rec[b].length > 0) out.push(`${selectorList(rec[b])} { --rarity-rec: var(--rarity-r-${b}); }`);
  }
  if (never.length > 0) {
    out.push(`${selectorList(never)} { --rarity-edge: var(--rarity-never-edge); }`);
  }
  if (missing.length > 0) {
    out.push(
      `${missingSelectorList(missing)} { background: var(--rarity-missing-bg); border-color: var(--rarity-missing-border); border-style: dashed; }`,
    );
  }
  return out.join('\n');
}
