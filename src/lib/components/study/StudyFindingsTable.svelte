<script lang="ts">
import type { StudyFinding } from '$lib/utils/attributeStudy.js';
import { type SortableColumn, sortByColumn } from '$lib/utils/sortColumn.js';

interface Props {
  findings: readonly StudyFinding[];
  /** Subject id to display name, for the evidence column. */
  names: Map<string, string>;
  /**
   * Slots in scope for this attribute.
   *
   * Only the empty state uses it now — the attribute tab above the table
   * already reads "Enthusiasm 59/124", and repeating that over the table
   * cost a row of a pane that was short of them.
   */
  slots: number;
}

const { findings, names, slots }: Props = $props();

let expanded = $state<string | null>(null);

type ColumnId = 'gene' | 'expression' | 'magnitude' | 'tier' | 'support';

/**
 * The columns, and how each one compares.
 *
 * `SortableColumn` is discriminated on `numeric`, so the accessor's return
 * type is tied to the comparison — the same contract the breeding table
 * sorts through, rather than a second comparator that could drift from it.
 *
 * `tier` sorts by certainty rather than alphabetically: `observed` before
 * `derived` before `solved` is the order that means something here, and
 * "derived, observed, solved" would be an accident of spelling.
 */
const TIER_RANK: Record<StudyFinding['tier'], number> = { direct: 0, derived: 1, system: 2 };

const COLUMNS: Array<{ id: ColumnId; label: string; cls: string } & SortableColumn<StudyFinding>> = [
  { id: 'gene', label: 'Gene', cls: 'col-gene', numeric: false, accessor: (f) => f.gene },
  { id: 'expression', label: 'Expressed', cls: 'col-expressed', numeric: false, accessor: (f) => f.expression },
  { id: 'magnitude', label: 'Points', cls: 'numeric col-points', numeric: true, accessor: (f) => f.magnitude },
  { id: 'tier', label: 'How', cls: 'col-how', numeric: true, accessor: (f) => TIER_RANK[f.tier] },
  { id: 'support', label: 'Agreeing', cls: 'numeric col-agreeing', numeric: true, accessor: (f) => f.support },
];

/**
 * `null` means the engine's own order, which is not arbitrary — most certain
 * first, then best supported. That is the right default, so the first click
 * on a header is a deliberate departure from it rather than a return to it.
 */
let sortCol = $state<ColumnId | null>(null);
let sortDir = $state<'asc' | 'desc'>('asc');

const rows = $derived.by(() => {
  const column = COLUMNS.find((c) => c.id === sortCol);
  return column ? sortByColumn([...findings], column, sortDir) : [...findings];
});

function setSort(id: ColumnId): void {
  if (sortCol === id) {
    // Third click returns to the engine's order rather than cycling between
    // two sorts the player may not have wanted either of.
    if (sortDir === 'desc') sortCol = null;
    else sortDir = 'desc';
    return;
  }
  sortCol = id;
  // Numbers descend first: the largest magnitude and the best-supported
  // finding are what anyone opens this table to see.
  sortDir = COLUMNS.find((c) => c.id === id)?.numeric ? 'desc' : 'asc';
}

const indicator = (id: ColumnId) => (sortCol !== id ? '' : sortDir === 'asc' ? ' ▲' : ' ▼');

const key = (f: StudyFinding) => `${f.gene}:${f.expression}`;

function toggle(f: StudyFinding): void {
  expanded = expanded === key(f) ? null : key(f);
}

/** `+5` / `−3`, with a true minus sign rather than a hyphen. */
function signed(n: number): string {
  return n > 0 ? `+${n}` : `−${Math.abs(n)}`;
}

function subject(id: string): string {
  return names.get(id) ?? `#${id}`;
}
</script>

<div class="findings" data-testid="study-findings">
	{#if findings.length === 0}
		<p class="empty">
			None of this attribute's {slots} effects is pinned yet. A magnitude is only known once two animals
			differ at exactly one of its genes — or once every other gene in a wider pair is already known.
		</p>
	{:else}
		<div class="scroll">
		<table>
			<thead>
				<tr>
					{#each COLUMNS as col (col.id)}
						<th
							scope="col"
							class={col.cls}
							class:active={sortCol === col.id}
							aria-sort={sortCol !== col.id ? 'none' : sortDir === 'asc' ? 'ascending' : 'descending'}
						>
							<button
								type="button"
								class="sort-btn"
								data-testid="study-sort-{col.id}"
								onclick={() => setSort(col.id)}
							>
								{col.label}{indicator(col.id)}
							</button>
						</th>
					{/each}
					<th scope="col"><span class="sr-only">Evidence</span></th>
				</tr>
			</thead>
			<tbody>
				{#each rows as finding (key(finding))}
					<tr class:open={expanded === key(finding)}>
						<td class="gene">{finding.gene}</td>
						<td class="expression">{finding.expression}</td>
						<td class="numeric points" class:up={finding.magnitude > 0} class:down={finding.magnitude < 0}>
							{signed(finding.magnitude)}
						</td>
						<td>
							<!-- A direct finding is read straight off a pair; a derived one
							     sits at the end of a substitution chain and inherits every
							     error in it; a system one is forced by several equations at
							     once, no one of which isolates it. The three must not look
							     alike. -->
							{#if finding.tier === 'direct'}
								<span class="tier direct">observed</span>
							{:else if finding.tier === 'system'}
								<span
									class="tier system"
									title="No single pair isolates this gene, but {finding.support} equations together leave only one value it can take."
								>
									solved
								</span>
							{:else}
								<span class="tier derived" title="Reached by substituting {finding.depth} round{finding.depth === 1 ? '' : 's'} of already-known magnitudes.">
									derived · {finding.depth}
								</span>
							{/if}
						</td>
						<td class="numeric">
							<!-- For direct and derived rows this is a count of independent
							     agreements. For a system row it is not: those equations pin
							     the slot jointly and none of them confirms it alone, so the
							     figure is marked rather than left to read as agreement. -->
							{finding.support}{#if finding.tier === 'system'}<span
									class="joint"
									title="These equations determine the value together. None of them agrees on it independently."
								>&nbsp;joint</span
								>{/if}{#if finding.dissent > 0}<span
									class="dissent"
									title="{finding.dissent} pair{finding.dissent === 1 ? '' : 's'} implied a different value. The majority is shown; the animals responsible are listed under Suspect readings."
								>&nbsp;/&nbsp;{finding.dissent}</span
								>{/if}
						</td>
						<td class="evidence-cell">
							<button type="button" class="evidence-btn" onclick={() => toggle(finding)}>
								{expanded === key(finding) ? 'Hide' : 'Show'} work
							</button>
						</td>
					</tr>
					{#if expanded === key(finding)}
						<tr class="evidence">
							<td colspan="6">
								<p class="evidence-lead">
									{#if finding.tier === 'direct'}
										These pairs match on every other {finding.attribute} gene, so the whole gap is this one.
									{:else if finding.tier === 'system'}
										No one of these pairs pins this gene on its own. Taken together they leave it only one
										possible value.
									{:else}
										Every other {finding.attribute} gene in these pairs was already known, leaving this one.
									{/if}
								</p>
								<ul>
									{#each finding.witnesses as [left, right] (`${left}-${right}`)}
										<li><span>{subject(left)}</span> <span class="vs">vs</span> <span>{subject(right)}</span></li>
									{/each}
								</ul>
							</td>
						</tr>
					{/if}
				{/each}
			</tbody>
		</table>
		</div>
	{/if}
</div>

<style>
	.findings {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}



	.empty {
		margin: 0;
		padding: var(--space-md);
		font-size: 13px;
		line-height: 1.5;
		color: var(--text-tertiary);
		max-width: 60ch;
	}

	/* The scroller must be the block box, not the table: a `display: block`
	   table shrink-wraps its content and ignores `width: 100%`, which left
	   the findings jammed into the left third of the pane. */
	.scroll {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
	}

	/* Five of six columns are fixed-width (below), so the table fills
	   whatever width its column has rather than leaving a gap beside its
	   neighbour — StudyView now puts evidence there instead of empty space. */
	table {
		border-collapse: collapse;
		width: 100%;
		font-size: 13px;
	}

	th:first-child,
	td:first-child {
		padding-left: var(--space-md);
	}

	.col-gene {
		width: 5rem;
	}
	.col-expressed {
		width: 7rem;
	}
	.col-points {
		width: 5rem;
	}
	.col-how {
		width: 7.5rem;
	}
	.col-agreeing {
		width: 6rem;
	}

	.sort-btn {
		width: 100%;
		padding: var(--space-2xs) var(--space-sm);
		margin: calc(-1 * var(--space-2xs)) calc(-1 * var(--space-sm));
		background: transparent;
		border: none;
		color: inherit;
		font: inherit;
		cursor: pointer;
		text-align: inherit;
		white-space: nowrap;
	}
	.sort-btn:hover {
		background: var(--bg-tertiary);
	}
	thead th.active {
		color: var(--text-secondary);
	}

	thead th {
		position: sticky;
		top: 0;
		z-index: 1;
		background: var(--bg-secondary);
		text-align: left;
		font-weight: 600;
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-tertiary);
		padding: var(--space-2xs) var(--space-sm);
		border-bottom: 1px solid var(--border-primary);
	}

	td {
		padding: var(--space-2xs) var(--space-sm);
		border-bottom: 1px solid var(--border-primary);
		color: var(--text-secondary);
	}

	tr.open td {
		border-bottom-color: transparent;
	}

	.numeric {
		text-align: right;
		font-variant-numeric: tabular-nums;
	}

	.gene {
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		color: var(--text-secondary);
	}

	.expression {
		color: var(--text-tertiary);
		font-size: 12px;
	}

	.points {
		font-weight: 600;
	}
	.points.up {
		color: var(--gene-positive);
	}
	.points.down {
		color: var(--gene-negative);
	}

	.tier {
		display: inline-block;
		padding: 1px var(--space-2xs);
		border-radius: 3px;
		font-size: 11px;
		white-space: nowrap;
	}
	.tier.direct {
		background: var(--bg-tertiary);
		color: var(--text-secondary);
	}
	.tier.derived {
		background: transparent;
		border: 1px solid var(--border-primary);
		color: var(--text-tertiary);
	}
	/* Entailed like `direct`, but by several equations rather than one pair —
	   so it reads as solid as `observed`, with a dashed edge saying the
	   evidence is joint. */
	.tier.system {
		background: transparent;
		border: 1px dashed var(--border-primary);
		color: var(--text-secondary);
	}

	.joint {
		font-size: 11px;
		color: var(--text-tertiary);
	}

	.dissent {
		color: var(--gene-negative);
	}

	.evidence-cell {
		text-align: right;
	}

	.evidence-btn {
		background: none;
		border: none;
		padding: 0;
		font-size: 12px;
		color: var(--accent);
		cursor: pointer;
	}
	.evidence-btn:hover {
		text-decoration: underline;
	}

	tr.evidence td {
		background: var(--bg-secondary);
		padding-top: 0;
	}

	.evidence-lead {
		margin: 0 0 var(--space-2xs);
		font-size: 12px;
		color: var(--text-tertiary);
	}

	tr.evidence ul {
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: var(--space-3xs);
	}

	tr.evidence li {
		font-size: 12px;
		color: var(--text-secondary);
	}

	.vs {
		color: var(--text-tertiary);
		padding: 0 var(--space-2xs);
	}
</style>
