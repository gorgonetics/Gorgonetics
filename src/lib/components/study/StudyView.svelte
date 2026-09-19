<script lang="ts">
import { onMount } from 'svelte';
import { namesForSubjects, runAttributeStudy, type StudyRun } from '$lib/services/studyService.js';
import StudyFindingsTable from './StudyFindingsTable.svelte';

const SPECIES = 'horse';

/** Plain-English reasons, so the corpus line reads as a sentence. */
const EXCLUSION_LABEL: Record<string, string> = {
  unmeasured: 'attributes never recorded',
  unrevealed: 'genome not fully revealed',
  'no-genome': 'genome could not be read',
  'no-breed': 'no breed',
};

let run = $state<StudyRun | null>(null);
let names = $state(new Map<string, string>());
let attribute = $state<string | null>(null);
let loading = $state(true);
let failure = $state<string | null>(null);

const studies = $derived(run?.studies ?? []);
const current = $derived(studies.find((s) => s.attribute === attribute) ?? studies[0]);

const coverage = $derived(run && run.totals.slots > 0 ? Math.round((run.totals.found / run.totals.slots) * 100) : 0);
const accuracy = $derived(
  run && run.validation.tested > 0 ? (100 * run.validation.exact) / run.validation.tested : null,
);

/**
 * Animals contradicting an otherwise-agreed magnitude, pooled across every
 * attribute. The model forbids disagreement, so a name high on this list is
 * almost always a mis-recorded row rather than a discovery.
 */
const suspects = $derived.by(() => {
  const totals = new Map<string, number>();
  for (const study of studies)
    for (const c of study.contradictions) totals.set(c.subjectId, (totals.get(c.subjectId) ?? 0) + c.count);
  return [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
});

onMount(async () => {
  try {
    const result = await runAttributeStudy(SPECIES);
    // Resolve every id the UI can surface — witnesses and suspects — in one
    // query rather than per row.
    const ids = new Set<string>();
    for (const study of result.studies) {
      for (const finding of study.findings) for (const [l, r] of finding.witnesses) ids.add(l).add(r);
      for (const c of study.contradictions) ids.add(c.subjectId);
    }
    names = await namesForSubjects([...ids]);
    run = result;
    attribute = result.studies[0]?.attribute ?? null;
  } catch (err) {
    failure = err instanceof Error ? err.message : String(err);
  } finally {
    loading = false;
  }
});
</script>

<div class="study" data-testid="study-view">
	<h2 class="sr-only">Genetic study</h2>

	{#if loading}
		<div class="center-state">
			<div class="spinner"></div>
			<p class="state-text">Deducing gene effects…</p>
		</div>
	{:else if failure}
		<div class="center-state">
			<p class="state-text">Could not run the study: {failure}</p>
		</div>
	{:else if run}
		<header class="summary">
			<div class="stat">
				<span class="stat-value">{coverage}%</span>
				<span class="stat-label">of effects known</span>
				<span class="stat-detail">{run.totals.found} of {run.totals.slots}</span>
			</div>
			<div class="stat">
				<span class="stat-value">{run.totals.direct}</span>
				<span class="stat-label">observed directly</span>
				<span class="stat-detail">{run.totals.derived} more by substitution</span>
			</div>
			<div class="stat">
				<span class="stat-value">{accuracy === null ? '—' : `${accuracy.toFixed(1)}%`}</span>
				<span class="stat-label">predictions exact</span>
				<!-- The honest measure: pairs the findings were NOT read off. A
				     figure well under 100% means a modelling assumption is wrong
				     or the corpus holds bad rows. -->
				<span class="stat-detail">on {run.validation.tested.toLocaleString()} held-out pairs</span>
			</div>
			<p class="corpus">
				{run.corpus.subjects.length} of {run.corpus.considered} horses studied{#if run.corpus.excluded.length > 0}&nbsp;— set
					aside: {#each run.corpus.excluded as ex, i (ex.reason)}{i > 0 ? ', ' : ''}{ex.count}
						{EXCLUSION_LABEL[ex.reason] ?? ex.reason}{/each}{/if}
			</p>
		</header>

		{#if run.corpus.subjects.length === 0}
			<div class="center-state">
				<p class="state-text">
					No horse in your stable can be studied yet. An animal needs a fully revealed genome and a
					name carrying its attribute readings.
				</p>
			</div>
		{:else}
			<div class="body">
				<nav class="attr-tabs" aria-label="Attribute">
					{#each studies as study (study.attribute)}
						<button
							type="button"
							class="attr-tab"
							class:active={study.attribute === current?.attribute}
							data-testid="study-attr-{study.attribute}"
							onclick={() => (attribute = study.attribute)}
						>
							{study.attribute}
							<span class="attr-count">{study.findings.length}/{study.slots}</span>
						</button>
					{/each}
				</nav>

				{#if current}
					<StudyFindingsTable findings={current.findings} {names} slots={current.slots} />
				{/if}

				{#if suspects.length > 0}
					<aside class="suspects">
						<h3>Suspect readings</h3>
						<p>
							These animals disagree with magnitudes the rest of the stable agrees on. The arithmetic
							is exact, so a high count almost always means a mis-recorded attribute.
						</p>
						<ul>
							{#each suspects as [id, count] (id)}
								<li>
									<span class="suspect-name">{names.get(id) ?? `#${id}`}</span>
									<span class="suspect-count">{count}</span>
								</li>
							{/each}
						</ul>
					</aside>
				{/if}
			</div>
		{/if}
	{/if}
</div>

<style>
	.study {
		position: relative;
		display: flex;
		flex-direction: column;
		height: 100%;
		min-height: 0;
		overflow: hidden;
	}

	.summary {
		flex-shrink: 0;
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		gap: var(--space-xl);
		padding: var(--space-md) var(--space-md) var(--space-sm);
		border-bottom: 1px solid var(--border-primary);
	}

	.stat {
		display: flex;
		flex-direction: column;
		gap: 1px;
	}

	.stat-value {
		font-size: 22px;
		font-weight: 600;
		color: var(--text-secondary);
		font-variant-numeric: tabular-nums;
		line-height: 1.1;
	}

	.stat-label {
		font-size: 12px;
		color: var(--text-secondary);
	}

	.stat-detail {
		font-size: 11px;
		color: var(--text-tertiary);
	}

	.corpus {
		flex-basis: 100%;
		margin: 0;
		font-size: 11px;
		color: var(--text-tertiary);
	}

	.body {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.attr-tabs {
		flex-shrink: 0;
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3xs);
		padding: var(--space-xs) var(--space-md) 0;
	}

	.attr-tab {
		display: flex;
		align-items: baseline;
		gap: var(--space-2xs);
		padding: var(--space-2xs) var(--space-sm);
		background: none;
		border: 1px solid transparent;
		border-radius: 4px 4px 0 0;
		font-size: 12px;
		text-transform: capitalize;
		color: var(--text-tertiary);
		cursor: pointer;
	}
	.attr-tab:hover {
		color: var(--text-secondary);
	}
	.attr-tab.active {
		background: var(--bg-secondary);
		border-color: var(--border-primary);
		border-bottom-color: transparent;
		color: var(--text-secondary);
	}

	.attr-count {
		font-size: 11px;
		color: var(--text-tertiary);
		font-variant-numeric: tabular-nums;
	}

	.suspects {
		flex-shrink: 0;
		max-height: 22%;
		overflow-y: auto;
		padding: var(--space-sm) var(--space-md);
		border-top: 1px solid var(--border-primary);
		background: var(--bg-secondary);
	}

	.suspects h3 {
		margin: 0 0 var(--space-3xs);
		font-size: 12px;
		font-weight: 600;
		color: var(--text-secondary);
	}

	.suspects p {
		margin: 0 0 var(--space-2xs);
		font-size: 11px;
		line-height: 1.4;
		color: var(--text-tertiary);
		max-width: 70ch;
	}

	.suspects ul {
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 1px;
	}

	.suspects li {
		display: flex;
		justify-content: space-between;
		gap: var(--space-sm);
		font-size: 12px;
		max-width: 60ch;
	}

	.suspect-name {
		color: var(--text-secondary);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.suspect-count {
		color: var(--gene-negative);
		font-variant-numeric: tabular-nums;
	}

	.center-state {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: var(--space-sm);
		color: var(--text-muted);
	}

	.state-text {
		font-size: 13px;
		color: var(--text-muted);
		margin: 0;
		max-width: 52ch;
		text-align: center;
		line-height: 1.5;
	}
</style>
