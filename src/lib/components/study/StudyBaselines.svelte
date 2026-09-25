<script lang="ts">
import type { AttributeBaselines, BaselineReading } from '$lib/utils/attributeStudy.js';

interface Props {
  baselines: AttributeBaselines;
}

const { baselines }: Props = $props();

/** `05F2:recessive` reads as `05F2 recessive` — the colon is an internal key separator. */
const slotLabel = (key: string) => key.replace(':', ' ');

const breedLabel = (breed: string) => breed || 'No breed';

const signed = (n: number) => (n < 0 ? `−${-n}` : String(n));

/**
 * The base as the corpus pins it: exact, one-sided, or not at all.
 *
 * Only the exact case is a number for the base itself. A bound is what the
 * declared signs of the unresolved slots allow, and without one the base is
 * unknown — the lump is still shown, because it is what differences between
 * breeds are read from.
 */
function baseText(r: BaselineReading): string {
  if (r.unresolved.length === 0) return signed(r.value);
  if (r.max !== null) return `≤ ${signed(r.max)}`;
  if (r.min !== null) return `≥ ${signed(r.min)}`;
  return '?';
}

function lumpText(r: BaselineReading): string {
  if (r.unresolved.length === 0) return 'exact';
  const shown = r.unresolved.slice(0, 3).map(slotLabel).join(' + ');
  const more = r.unresolved.length > 3 ? ` + ${r.unresolved.length - 3} more` : '';
  return `base + ${shown}${more} = ${signed(r.value)}`;
}
</script>

{#if baselines.readings.length > 0}
	<details class="baselines" data-testid="study-baselines">
		<summary>
			<span class="label">Base values</span>
			{#each baselines.readings.slice(0, 4) as r (r.breed)}
				<span class="chip">{breedLabel(r.breed)} <strong>{baseText(r)}</strong></span>
			{/each}
			{#if baselines.readings.length > 4}<span class="chip more">+{baselines.readings.length - 4}</span>{/if}
		</summary>
		<p class="lead">
			The value before any gene effect. Where a slot every animal expresses is still unknown, no pair can
			separate it from the base, so the base is only bounded by its declared sign. Breeds that leave the same
			slots unknown still give an exact gap.
		</p>
		<table>
			<thead>
				<tr>
					<th scope="col">Breed</th>
					<th scope="col" class="numeric">Base</th>
					<th scope="col">Read as</th>
					<th scope="col" class="numeric">Animals</th>
				</tr>
			</thead>
			<tbody>
				{#each baselines.readings as r (r.breed)}
					<tr data-testid="baseline-{r.breed || 'none'}">
						<td>{breedLabel(r.breed)}</td>
						<td class="numeric base" class:exact={r.unresolved.length === 0}>{baseText(r)}</td>
						<td class="lump" title={r.unresolved.map(slotLabel).join(', ')}>{lumpText(r)}</td>
						<td class="numeric">
							{r.support}{#if r.dissent > 0}<span class="dissent" title="Animals with the same unknown slots reading another value"
									>&nbsp;/ {r.dissent} disagree</span
								>{/if}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
		{#if baselines.offsets.length > 0}
			<ul class="offsets">
				{#each baselines.offsets as o (o.breed)}
					<li data-testid="baseline-offset-{o.breed || 'none'}">
						{breedLabel(o.breed)} = {breedLabel(o.relativeTo)}
						{o.offset === 0 ? '' : o.offset > 0 ? `+ ${o.offset}` : `− ${-o.offset}`}
						<span class="offset-detail">({o.animals} animals{o.dissent > 0 ? `, ${o.dissent} disagree` : ''})</span>
					</li>
				{/each}
			</ul>
		{/if}
	</details>
{/if}

<style>
	.baselines {
		flex-shrink: 0;
		border-bottom: 1px solid var(--border-primary);
		font-size: 12px;
	}

	summary {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: var(--space-xs);
		padding: var(--space-2xs) var(--space-md);
		cursor: pointer;
		color: var(--text-secondary);
	}

	/* A flex summary drops the native disclosure marker, so draw one. */
	summary::-webkit-details-marker {
		display: none;
	}
	summary::before {
		content: '▸';
		color: var(--text-tertiary);
	}
	.baselines[open] summary::before {
		content: '▾';
	}
	summary {
		list-style: none;
	}

	.label {
		font-weight: 600;
	}

	.chip {
		color: var(--text-tertiary);
	}
	.chip strong {
		color: var(--text-primary);
		font-variant-numeric: tabular-nums;
	}

	.lead {
		margin: 0;
		padding: 0 var(--space-md) var(--space-2xs);
		color: var(--text-tertiary);
		line-height: 1.5;
		max-width: 70ch;
	}

	table {
		border-collapse: collapse;
		width: 100%;
	}

	th,
	td {
		padding: var(--space-3xs) var(--space-sm);
		text-align: left;
	}
	th:first-child,
	td:first-child {
		padding-left: var(--space-md);
	}
	th {
		font-weight: 500;
		color: var(--text-tertiary);
	}

	.numeric {
		text-align: right;
		font-variant-numeric: tabular-nums;
	}

	.base {
		color: var(--text-secondary);
	}
	.base.exact {
		color: var(--text-primary);
		font-weight: 600;
	}

	.lump {
		color: var(--text-tertiary);
		font-family: ui-monospace, monospace;
		font-size: 11px;
	}

	.dissent {
		color: var(--gene-negative);
	}

	.offsets {
		margin: 0;
		padding: var(--space-2xs) var(--space-md) var(--space-xs);
		list-style: none;
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2xs) var(--space-md);
		color: var(--text-secondary);
	}

	.offset-detail {
		color: var(--text-tertiary);
	}
</style>
