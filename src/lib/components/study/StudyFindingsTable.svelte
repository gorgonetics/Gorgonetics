<script lang="ts">
import type { StudyFinding } from '$lib/utils/attributeStudy.js';

interface Props {
  findings: readonly StudyFinding[];
  /** Subject id to display name, for the evidence column. */
  names: Map<string, string>;
  /** Slots in scope for this attribute, so the header can say what is left. */
  slots: number;
}

const { findings, names, slots }: Props = $props();

let expanded = $state<string | null>(null);

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
	<div class="findings-head">
		<span class="found">{findings.length}</span> of {slots} known
	</div>

	{#if findings.length === 0}
		<p class="empty">
			Nothing is pinned for this attribute yet. A magnitude is only known once two animals
			differ at exactly one of its genes — or once every other gene in a wider pair is already known.
		</p>
	{:else}
		<div class="scroll">
		<table>
			<thead>
				<tr>
					<th scope="col" class="col-gene">Gene</th>
					<th scope="col" class="col-expressed">Expressed</th>
					<th scope="col" class="numeric col-points">Points</th>
					<th scope="col" class="col-how">How</th>
					<th scope="col" class="numeric col-agreeing">Agreeing</th>
					<th scope="col"><span class="sr-only">Evidence</span></th>
				</tr>
			</thead>
			<tbody>
				{#each findings as finding (key(finding))}
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

	.findings-head {
		flex-shrink: 0;
		padding: var(--space-xs) var(--space-md);
		font-size: 12px;
		color: var(--text-tertiary);
		border-bottom: 1px solid var(--border-primary);
	}

	.found {
		color: var(--text-secondary);
		font-weight: 600;
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
