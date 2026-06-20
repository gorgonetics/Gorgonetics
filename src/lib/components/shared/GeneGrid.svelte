<script lang="ts" module>
/** Effect tone — matches geneGridCells `effectType` + trioGrid `TrioTone`. */
export type GeneTone = 'positive' | 'negative' | 'potential-positive' | 'potential-negative' | 'neutral' | 'unknown';

/** Zygosity / value: Dominant, mixed, Recessive, or unknown. */
export type GeneZygosity = 'D' | 'x' | 'R' | '?';

export interface GeneGridCellVM {
  tone: GeneTone;
  zygosity: GeneZygosity;
  /** Attribute name for filtering (drives the `data-attr` hook). */
  attribute?: string;
  /** Hover text. */
  title?: string;
}

export interface GeneGridRowVM {
  chromosome: string;
  /** Keyed by `${block}${position}`; absent key → empty cell. */
  cells: Record<string, GeneGridCellVM>;
}
</script>

<script lang="ts">
/**
 * The one gene grid for the whole app. Renders a chromosome × (block ×
 * position) grid of square cells with a dual encoding — colour = effect tone,
 * fill = zygosity — under a single compact legend. Replaces the divergent
 * renderings: circles in the pet view (GeneCell), and the squares/segments in
 * the comparison and trio grids. See docs/design/redesign-library-workspace-v1.md.
 *
 * Pure presentation: the caller builds the render model (via the geneGridCells
 * factory / trioGrid) and passes it in. Scoped styles only — it does not touch
 * the legacy global `.gene-cell` rules, so it lands behind the current UI;
 * adoption retires those rules.
 */
interface Props {
  blocks: string[];
  /** 1-based positions present per block, ascending. */
  positionsByBlock: Record<string, number[]>;
  rows: GeneGridRowVM[];
  showLegend?: boolean;
}

const { blocks, positionsByBlock, rows, showLegend = true }: Props = $props();

const EFFECTS: { tone: GeneTone; label: string }[] = [
  { tone: 'positive', label: 'Positive' },
  { tone: 'potential-positive', label: 'Potential +' },
  { tone: 'neutral', label: 'Neutral' },
  { tone: 'potential-negative', label: 'Potential −' },
  { tone: 'negative', label: 'Negative' },
];
const VALUES: { zyg: GeneZygosity; label: string }[] = [
  { zyg: 'D', label: 'Dominant' },
  { zyg: 'R', label: 'Recessive' },
  { zyg: 'x', label: 'Mixed' },
  { zyg: '?', label: 'Unknown' },
];

const zygClass: Record<GeneZygosity, string> = { D: 'zyg-dom', x: 'zyg-mix', R: 'zyg-rec', '?': 'zyg-unk' };
</script>

<div class="gene-grid" data-testid="gene-grid">
  {#if showLegend}
    <div class="gg-legend" data-testid="gene-grid-legend">
      <div class="gg-leg-grp">
        <span class="gg-leg-label">Effect</span>
        {#each EFFECTS as e (e.tone)}
          <span class="gg-leg-item"><span class="gg-leg-sq tone-{e.tone} zyg-dom"></span>{e.label}</span>
        {/each}
      </div>
      <div class="gg-leg-grp">
        <span class="gg-leg-label">Value</span>
        {#each VALUES as v (v.zyg)}
          <span class="gg-leg-item"><span class="gg-leg-sq tone-neutral {zygClass[v.zyg]}"></span>{v.label}</span>
        {/each}
      </div>
    </div>
  {/if}

  {#if rows.length > 0}
    <div class="gg-scroll">
      <table class="gg-table">
        <thead>
          <tr>
            <th class="gg-chr-head">Chr</th>
            {#each blocks as block (block)}
              {#each positionsByBlock[block] as pos (pos)}
                <th class="gg-pos-head {pos === 1 ? 'gg-block-start' : ''}">{pos === 1 ? block : ''}</th>
              {/each}
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each rows as row (row.chromosome)}
            <tr>
              <td class="gg-chr">{row.chromosome}</td>
              {#each blocks as block (block)}
                {#each positionsByBlock[block] as pos (pos)}
                  {@const cell = row.cells[`${block}${pos}`]}
                  <td class="gg-td {pos === 1 ? 'gg-block-start' : ''}">
                    {#if cell}
                      <div
                        class="gg-cell tone-{cell.tone} {zygClass[cell.zygosity]}"
                        data-attr={cell.attribute ?? ''}
                        data-zyg={cell.zygosity}
                        title={cell.title ?? ''}
                      >
                        {#if cell.zygosity === '?'}<span class="gg-unk" aria-hidden="true">?</span>{/if}
                      </div>
                    {/if}
                  </td>
                {/each}
              {/each}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>

<style>
  .gene-grid { width: 100%; }

  /* One compact legend, both encodings. */
  .gg-legend {
    display: flex;
    flex-wrap: wrap;
    gap: 14px 24px;
    align-items: center;
    margin-bottom: 14px;
    padding: 10px 14px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-primary);
    border-radius: 9px;
  }
  .gg-leg-grp { display: flex; align-items: center; gap: 8px; }
  .gg-leg-label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-tertiary); }
  .gg-leg-item { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; color: var(--text-secondary); }
  .gg-leg-sq { width: 13px; height: 13px; }

  .gg-scroll {
    overflow: auto;
    border: 1px solid var(--border-primary);
    border-radius: 6px;
    background: var(--bg-secondary);
  }
  .gg-table { border-collapse: collapse; table-layout: fixed; }
  .gg-table th {
    position: sticky;
    top: 0;
    z-index: 1;
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border-primary);
    padding: 2px 4px;
    font-size: 9px;
    font-weight: normal;
    color: var(--text-secondary);
    text-align: center;
    white-space: nowrap;
  }
  .gg-chr-head { position: sticky; left: 0; z-index: 2; width: 28px; min-width: 28px; font-weight: 700; }
  .gg-pos-head { width: 22px; min-width: 22px; max-width: 22px; }
  .gg-block-start { padding-left: 8px; }
  .gg-pos-head.gg-block-start { font-weight: 700; }

  .gg-chr {
    position: sticky;
    left: 0;
    z-index: 1;
    background: var(--bg-secondary);
    font-size: 10px;
    font-weight: 700;
    color: var(--text-secondary);
    text-align: center;
    border-right: 1px solid var(--border-primary);
  }
  .gg-td { padding: 1px; text-align: center; vertical-align: middle; }
  .gg-td.gg-block-start { padding-left: 8px; }

  /* The square cell — colour from tone (--c), fill from zygosity. */
  .gg-cell {
    width: 15px;
    height: 15px;
    margin: 0 auto;
    border-radius: 3px;
    box-sizing: border-box;
    color: var(--c, var(--gene-neutral));
    display: grid;
    place-items: center;
  }

  .tone-positive { --c: var(--gene-positive); }
  .tone-negative { --c: var(--gene-negative); }
  .tone-potential-positive { --c: var(--gene-potential-positive); }
  .tone-potential-negative { --c: var(--gene-potential-negative); }
  .tone-neutral { --c: var(--gene-neutral); }
  .tone-unknown { --c: var(--gene-neutral); }

  .zyg-dom { background: var(--c); border: 1px solid var(--c); }
  .zyg-rec { background: transparent; border: 2px solid var(--c); }
  .zyg-mix { background: linear-gradient(135deg, var(--c) 50%, transparent 50%); border: 1px solid var(--c); }
  .zyg-unk {
    background: repeating-linear-gradient(45deg, var(--gene-neutral) 0 2px, transparent 2px 4px);
    border: 1px dashed var(--border-secondary);
  }
  .gg-unk { font-size: 9px; font-weight: 700; color: var(--text-muted); }
</style>
