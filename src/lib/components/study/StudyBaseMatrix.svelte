<script lang="ts">
import type { AttributeStudy } from '$lib/utils/attributeStudy.js';
import {
  type BaseCell,
  baseText,
  breedLabel,
  buildBaseMatrix,
  gapText,
  isConflict,
  isExactBase,
  lumpText,
} from '$lib/utils/baseMatrix.js';

interface Props {
  /** In display order: the columns follow it. */
  studies: readonly AttributeStudy[];
  /** Open one attribute's own study, for the evidence behind a cell. */
  onselect?: (attribute: string) => void;
}

const { studies, onselect }: Props = $props();

const matrix = $derived(buildBaseMatrix(studies));

function cellKind(cell: BaseCell): 'exact' | 'conflict' | 'bound' | 'unknown' | 'gap' | 'none' {
  if (cell.reading) {
    if (isExactBase(cell.reading)) return 'exact';
    if (isConflict(cell.reading)) return 'conflict';
    return cell.reading.min === null && cell.reading.max === null ? 'unknown' : 'bound';
  }
  return cell.gap ? 'gap' : 'none';
}

function cellTitle(cell: BaseCell): string {
  const parts: string[] = [];
  const r = cell.reading;
  if (r) {
    parts.push(`Read as ${lumpText(r)}`);
    parts.push(`${r.support} animals${r.dissent > 0 ? `, ${r.dissent} disagree` : ''}`);
  }
  if (cell.gap) {
    parts.push(
      `Base ${gapText(cell.gap)} exactly (${cell.gap.animals} animals${cell.gap.dissent > 0 ? `, ${cell.gap.dissent} disagree` : ''})`,
    );
  }
  return parts.length > 0 ? parts.join('\n') : 'Not settled yet';
}
</script>

{#if matrix.rows.length > 0}
	<div class="base-matrix" data-testid="study-base-matrix">
		<p class="lead">
			Each breed's value before any gene effect. <strong>Bold</strong> is exact. ≤ and ≥ are bounds from the
			declared sign of a gene every animal of the breed expresses, which no pair can separate from the base;
			a range a … b combines bounds from breeds linked by a gap.
			A second line is the exact gap to another breed's base. * marks a value some animals disagree with. Select
			a column for the evidence.
		</p>
		<div class="scroll">
			<table>
				<thead>
					<tr>
						<th scope="col">Breed</th>
						{#each matrix.attributes as attribute (attribute)}
							<th scope="col" class="numeric">
								{#if onselect}
									<button
										type="button"
										class="col-link"
										data-testid="base-matrix-col-{attribute}"
										onclick={() => onselect(attribute)}>{attribute}</button
									>
								{:else}
									{attribute}
								{/if}
							</th>
						{/each}
					</tr>
				</thead>
				<tbody>
					{#each matrix.rows as row (row.breed)}
						<tr data-testid="base-matrix-row-{row.breed || 'none'}">
							<th scope="row">{breedLabel(row.breed)}</th>
							{#each row.cells as cell, i (matrix.attributes[i])}
								{@const kind = cellKind(cell)}
								<td
									class="numeric cell {kind}"
									class:dissent={(cell.reading?.dissent ?? 0) > 0}
									title={cellTitle(cell)}
									data-testid="base-matrix-{row.breed || 'none'}-{matrix.attributes[i]}"
								>
									{#if cell.reading}
										<span class="base">{baseText(cell.reading)}</span>
										{#if cell.gap}<span class="gap">{gapText(cell.gap)}</span>{/if}
									{:else if cell.gap}
										<span class="gap">{gapText(cell.gap)}</span>
									{:else}
										<span class="base">—</span>
									{/if}
								</td>
							{/each}
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</div>
{:else}
	<p class="empty" data-testid="study-base-matrix-empty">No breed's base has settled yet.</p>
{/if}

<style>
	.base-matrix {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		font-size: 12px;
	}

	.lead,
	.empty {
		margin: 0;
		padding: var(--space-xs) var(--space-md);
		color: var(--text-tertiary);
		line-height: 1.5;
		max-width: 80ch;
		font-size: 12px;
	}
	.lead strong {
		color: var(--text-primary);
	}

	.scroll {
		flex: 1;
		min-height: 0;
		overflow: auto;
	}

	table {
		border-collapse: collapse;
	}

	th,
	td {
		padding: var(--space-2xs) var(--space-sm);
		text-align: left;
		border-bottom: 1px solid var(--border-primary);
		white-space: nowrap;
	}
	th:first-child {
		padding-left: var(--space-md);
	}
	thead th {
		position: sticky;
		top: 0;
		background: var(--bg-primary);
		font-weight: 500;
		color: var(--text-tertiary);
		/* Attribute keys are lowercase; the attribute tabs capitalise them the same way. */
		text-transform: capitalize;
	}
	tbody th {
		font-weight: 500;
		color: var(--text-secondary);
	}

	.numeric {
		text-align: right;
		font-variant-numeric: tabular-nums;
	}

	.col-link {
		background: none;
		border: none;
		padding: 0;
		font: inherit;
		color: inherit;
		cursor: pointer;
		text-transform: inherit;
	}
	.col-link:hover {
		color: var(--text-primary);
		text-decoration: underline;
	}

	.cell .base,
	.cell .gap {
		display: block;
	}
	.cell .gap {
		font-size: 11px;
		color: var(--text-tertiary);
	}

	.exact .base {
		color: var(--text-primary);
		font-weight: 600;
	}
	.bound .base {
		color: var(--text-secondary);
	}
	.conflict .base {
		color: var(--gene-negative);
	}
	.unknown .base,
	.none .base {
		color: var(--text-tertiary);
	}
	.gap .gap {
		color: var(--text-secondary);
	}

	.dissent .base::after {
		content: '*';
		color: var(--gene-negative);
	}
</style>
