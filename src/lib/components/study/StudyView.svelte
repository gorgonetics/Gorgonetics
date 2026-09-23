<script lang="ts">
import {
  confirmGeneDeclaration,
  listExcludedSubjects,
  namesForSubjects,
  type RefreshProgress,
  refreshStudyCorpus,
  runAttributeStudy,
  STUDYABLE_SPECIES,
  type StudyRun,
  setUseForStudies,
  studyCorpusStatus,
} from '$lib/services/studyService.js';
import { pets } from '$lib/stores/pets.js';
import { settings, settingsActions } from '$lib/stores/settings.js';
import type { GeneDoubt } from '$lib/utils/attributeStudy.js';
import { mostPopulatedSpecies } from '$lib/utils/species.js';
import StudyFindingsTable from './StudyFindingsTable.svelte';

// Only species the study can measure. Listing one it cannot gives a panel
// that is permanently empty and blames the animals for it.
const speciesOptions = STUDYABLE_SPECIES;

/** Community entries the study can learn from, without owning them. */
const COMMUNITY_HINT =
  'Pulls every shared animal into a local study cache. They stay out of My Pets and cannot be bred — they are evidence, not stock — and they can never settle a disagreement, since you cannot re-read someone else\u2019s animal in the game.';

/**
 * Which species to study. Every count on this screen — slots, coverage,
 * the attribute tabs — comes from one species' gene table, so studying the
 * wrong one shows a panel that is not merely empty but mislabelled.
 *
 * Defaults to the most-populated species rather than a hardcoded one, the
 * same rule `BreedView` uses, and is derived rather than set at mount
 * because the pet list arrives well after mount.
 */
let picked = $state('');
const defaultSpecies = $derived(mostPopulatedSpecies($pets, speciesOptions));
const species = $derived(picked || defaultSpecies);

/** Plain-English reasons, so the corpus line reads as a sentence. */
const EXCLUSION_LABEL: Record<string, string> = {
  unmeasured: 'attributes never recorded',
  unrevealed: 'genome not fully revealed',
  'no-genome': 'genome could not be read',
  incomplete: 'genome missing some loci',
  'no-breed': 'no breed',
  'mixed-breed': 'mixed breed',
};

let run = $state<StudyRun | null>(null);
let ranFor = $state('');
/**
 * Which solve is current. Switching species starts a new one while the
 * previous is still awaiting the DB, and the stale result would otherwise
 * land last and overwrite the new species' findings — including its
 * `loading` and error state, not just the data.
 */
let generation = 0;
let cachedCount = $state(0);
let fetchedAt = $state<string | null>(null);
let refreshing = $state(false);
let refreshError = $state<string | null>(null);
/**
 * What the refresh is doing right now.
 *
 * The button alone cannot say: a fetch is two paged network reads, a few
 * hundred hash checks and then a full re-solve, and "Fetching…" for all of
 * it is indistinguishable from a hang. `null` once nothing is running.
 */
let progress = $state<RefreshProgress | { phase: 'solving' } | null>(null);

/**
 * Deliberately no time estimate. The rate depends on the catalogue size and
 * the connection, and a number that turns out wrong is worse than a count
 * the player can watch move.
 */
function progressLabel(p: RefreshProgress | { phase: 'solving' }): string {
  switch (p.phase) {
    case 'catalogue':
      return p.done > 0
        ? `Reading the catalogue — ${p.done.toLocaleString()} animals so far`
        : 'Reading the catalogue…';
    case 'genomes':
      return `Downloading genomes — ${p.done.toLocaleString()} of ${p.total.toLocaleString()}`;
    case 'checking':
      return `Verifying genomes — ${p.done.toLocaleString()} of ${p.total.toLocaleString()}`;
    case 'saving':
      return `Saving ${p.total.toLocaleString()} animals…`;
    case 'solving':
      return 'Re-running the study…';
  }
}
let names = $state(new Map<string, string>());
let attribute = $state<string | null>(null);
/** The slot a confirmation is being written for, so its button can say so. */
/** The row an action is running for, so only that button says "Saving…". */
let busyRow = $state<string | null>(null);
let actionError = $state<string | null>(null);

/**
 * Record that the player checked this gene in game and the table was right.
 *
 * Re-solves afterwards rather than just hiding the row: a confirmed
 * declaration moves the blame onto the animals in the dispute, and they
 * should appear under Suspect readings straight away — that is the next
 * place to look, and the reason this is worth recording at all.
 */
async function confirmDoubt(d: GeneDoubt): Promise<void> {
  busyRow = `${d.gene}:${d.expression}`;
  actionError = null;
  try {
    await confirmGeneDeclaration(species, d.gene, d.expression, d.attribute, d.declared);
    // `solve` directly rather than clearing `ranFor` to provoke the effect:
    // the species has not changed, so re-arming the effect only schedules a
    // second identical solve that the generation guard then throws away.
    await solve(species);
  } catch (err) {
    actionError = err instanceof Error ? err.message : String(err);
  } finally {
    busyRow = null;
  }
}
let loading = $state(true);
let failure = $state<string | null>(null);
let excluded = $state<Array<{ subjectId: string; name: string }>>([]);

/** Narrowest and widest the evidence column may be dragged, in pixels. */
const EVIDENCE_MIN = 220;
const EVIDENCE_MAX = 620;
const EVIDENCE_DEFAULT = 300;
const EVIDENCE_SETTING = 'study.evidenceWidth';

const clampWidth = (px: number) => Math.min(EVIDENCE_MAX, Math.max(EVIDENCE_MIN, Math.round(px)));

/**
 * Width of the evidence column.
 *
 * Seeded from the saved setting on first read and owned locally afterwards:
 * dragging writes here every pointer move, and persisting on every move
 * would be a database write per frame. The save happens once the drag ends.
 */
let evidenceWidth = $state(EVIDENCE_DEFAULT);
let widthLoaded = false;
$effect(() => {
  const saved = $settings[EVIDENCE_SETTING];
  if (widthLoaded || typeof saved !== 'number') return;
  widthLoaded = true;
  evidenceWidth = clampWidth(saved);
});

let splitEl: HTMLDivElement | undefined = $state();

/**
 * Drag the divider.
 *
 * Measured from the split's right edge rather than by accumulating deltas,
 * so the column cannot drift away from the pointer over a long drag or when
 * the clamp bites. Pointer capture keeps the moves coming even when the
 * cursor outruns the 6px handle.
 */
function startDrag(event: PointerEvent): void {
  const split = splitEl;
  if (!split) return;
  const handle = event.currentTarget as HTMLElement;
  handle.setPointerCapture(event.pointerId);
  const right = split.getBoundingClientRect().right;

  const move = (e: PointerEvent) => {
    evidenceWidth = clampWidth(right - e.clientX);
  };
  const end = () => {
    handle.releasePointerCapture(event.pointerId);
    handle.removeEventListener('pointermove', move);
    handle.removeEventListener('pointerup', end);
    handle.removeEventListener('pointercancel', end);
    void settingsActions.update(EVIDENCE_SETTING, evidenceWidth);
  };
  handle.addEventListener('pointermove', move);
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
  event.preventDefault();
}

/** Arrow keys move the divider too — a drag handle nobody can tab to is not one. */
function nudge(event: KeyboardEvent): void {
  const step = event.shiftKey ? 48 : 16;
  let next = evidenceWidth;
  if (event.key === 'ArrowLeft') next = evidenceWidth + step;
  else if (event.key === 'ArrowRight') next = evidenceWidth - step;
  else if (event.key === 'Home') next = EVIDENCE_MAX;
  else if (event.key === 'End') next = EVIDENCE_MIN;
  else return;
  event.preventDefault();
  evidenceWidth = clampWidth(next);
  void settingsActions.update(EVIDENCE_SETTING, evidenceWidth);
}

/**
 * Stop learning from an animal, or start again.
 *
 * Re-solves rather than filtering the view: an excluded animal changes which
 * magnitudes are entailed at all, so the whole study is different afterwards
 * and a filtered display would be a different claim than the numbers on
 * screen.
 */
async function toggleUse(subjectId: string, use: boolean): Promise<void> {
  busyRow = subjectId;
  actionError = null;
  try {
    await setUseForStudies(species, subjectId, use);
    await solve(species);
  } catch (err) {
    actionError = err instanceof Error ? err.message : String(err);
  } finally {
    busyRow = null;
  }
}

const studies = $derived(run?.studies ?? []);
const current = $derived(studies.find((s) => s.attribute === attribute) ?? studies[0]);

const coverage = $derived(run && run.totals.slots > 0 ? Math.round((run.totals.found / run.totals.slots) * 100) : 0);
const accuracy = $derived(
  run && run.validation.tested > 0 ? (100 * run.validation.exact) / run.validation.tested : null,
);
/** The score over pairs the player can re-read, which is the one to trust. */
const stabledAccuracy = $derived(
  run && run.validation.stabledTested > 0 ? (100 * run.validation.stabledExact) / run.validation.stabledTested : null,
);

/**
 * Genes whose declared effect the animals dispute, pooled across attributes.
 *
 * The gene table is hand-entered, so a disagreement is as likely to be a
 * mistake in it as in an animal's record. Each of these is a specific
 * question to put to the game.
 */
const doubts = $derived(
  studies
    .flatMap((s) => s.geneDoubts)
    .sort((a, b) => Number(b.checkable) - Number(a.checkable) || b.animals - a.animals || b.support - a.support)
    .slice(0, 6),
);

/**
 * Animals contradicting an otherwise-agreed magnitude, pooled across every
 * attribute. The model forbids disagreement, so a name high on this list is
 * almost always a mis-recorded row rather than a discovery.
 */
const suspects = $derived.by(() => {
  const totals = new Map<string, { count: number; stabled: boolean }>();
  for (const study of studies)
    for (const c of study.contradictions) {
      const seen = totals.get(c.subjectId);
      if (seen) seen.count += c.count;
      else totals.set(c.subjectId, { count: c.count, stabled: c.stabled });
    }
  // Stabled first: only those can be settled by re-reading the animal, so a
  // smaller checkable disagreement beats a larger unfalsifiable one.
  return [...totals.entries()]
    .sort(([, a], [, b]) => Number(b.stabled) - Number(a.stabled) || b.count - a.count)
    .slice(0, 6);
});

/**
 * The four evidence panels used to stack in one column, each fighting the
 * others for vertical space. They now share a rail with one visible at a
 * time, picked from this list — built fresh each render so a panel that
 * empties out (e.g. every doubt gets confirmed) drops off it.
 */
type EvidenceId = 'doubts' | 'suspects' | 'misrecorded' | 'excluded';
const evidenceSections = $derived(
  (
    [
      { id: 'doubts', label: 'Gene checks', count: doubts.length },
      { id: 'suspects', label: 'Suspect readings', count: suspects.length },
      { id: 'misrecorded', label: 'Mis-recorded', count: run?.suspects.length ?? 0 },
      { id: 'excluded', label: 'Excluded', count: excluded.length },
    ] satisfies Array<{ id: EvidenceId; label: string; count: number }>
  ).filter((s) => s.count > 0),
);
let evidenceSection = $state<EvidenceId>('doubts');
// Keep the selection on a panel that still has something in it, without
// fighting the player's own click: only steps in once the current pick has
// emptied out or nothing has been picked yet.
$effect(() => {
  if (evidenceSections.length === 0) return;
  if (!evidenceSections.some((s) => s.id === evidenceSection)) evidenceSection = evidenceSections[0].id;
});

/**
 * Re-runs whenever the species changes, including the first time it
 * resolves from an empty pet list. Guarded on `ranFor` so a re-render that
 * does not change the species cannot restart the solve.
 */
$effect(() => {
  const target = species;
  if (!target || target === ranFor) return;
  ranFor = target;
  void solve(target);
});

async function refresh(): Promise<void> {
  refreshing = true;
  refreshError = null;
  progress = null;
  try {
    await refreshStudyCorpus(species, (p) => {
      progress = p;
    });
    // The re-solve is the view's own step and can be the longest of the
    // lot, so it gets named rather than left under the same spinner.
    progress = { phase: 'solving' };
    // Re-solve rather than patch: the new animals change every count on
    // screen, not just the cache line. Called directly — clearing `ranFor`
    // would re-arm the effect and schedule a second identical solve.
    await solve(species);
  } catch (err) {
    refreshError = err instanceof Error ? err.message : String(err);
  } finally {
    refreshing = false;
    progress = null;
  }
}

async function solve(target: string): Promise<void> {
  const mine = ++generation;
  loading = true;
  failure = null;
  try {
    const result = await runAttributeStudy(target);
    if (mine !== generation) return;
    // Resolve every id the UI can surface — witnesses and suspects — in one
    // query rather than per row.
    const ids = new Set<string>();
    for (const study of result.studies) {
      for (const finding of study.findings) for (const [l, r] of finding.witnesses) ids.add(l).add(r);
      for (const c of study.contradictions) ids.add(c.subjectId);
    }
    // Suspects come from *held-out* equations, so they are by construction
    // not the pairs any finding was read off — without this they miss the
    // witness ids entirely and the panel renders raw content hashes.
    for (const s of result.suspects) ids.add(s.subjectId);
    const resolved = await namesForSubjects([...ids]);
    if (mine !== generation) return;
    names = resolved;
    run = result;
    attribute = result.studies[0]?.attribute ?? null;
    // Both reads before any assignment, then one guard: a solve that started
    // while these were in flight has already published its own numbers, and
    // writing these afterwards would pair the new study with the old corpus.
    const [status, excludedNow] = await Promise.all([studyCorpusStatus(target), listExcludedSubjects(target)]);
    if (mine !== generation) return;
    cachedCount = status.cached;
    fetchedAt = status.fetchedAt;
    excluded = excludedNow;
  } catch (err) {
    if (mine !== generation) return;
    failure = err instanceof Error ? err.message : String(err);
  } finally {
    if (mine === generation) loading = false;
  }
}
</script>

<div class="study" data-testid="study-view">
	<h2 class="sr-only">Genetic study</h2>

	{#if speciesOptions.length > 1}
		<nav class="species-tabs" aria-label="Species">
			{#each speciesOptions as option (option)}
				<button
					type="button"
					class="species-tab"
					class:active={option === species}
					data-testid="study-species-{option}"
					onclick={() => (picked = option)}
				>
					{option}
				</button>
			{/each}
		</nav>
	{/if}

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
				<span class="stat-detail"
					>{run.totals.derived} more by substitution{#if run.totals.system > 0}, {run.totals.system} by solving
						together{/if}</span
				>
			</div>
			<div class="stat">
				<span class="stat-value">{accuracy === null ? '—' : `${accuracy.toFixed(1)}%`}</span>
				<span class="stat-label">predictions exact</span>
				<!-- The honest measure: pairs the findings were NOT read off. A
				     figure well under 100% means a modelling assumption is wrong
				     or the corpus holds bad rows. -->
				<span class="stat-detail">on {run.validation.tested.toLocaleString()} held-out pairs</span>
			</div>
			<div class="stat">
				<span class="stat-value" class:muted={stabledAccuracy === null}>
					{stabledAccuracy === null ? '—' : `${stabledAccuracy.toFixed(1)}%`}
				</span>
				<span class="stat-label">exact, stabled only</span>
				<!-- The score you can act on. Elsewhere a shortfall is ambiguous —
				     bad data and a bad model look the same — but between two
				     stabled animals it is a claim you can go and falsify. -->
				<span class="stat-detail">
					{run.validation.stabledTested === 0
						? 'no stabled pair to check against'
						: `on ${run.validation.stabledTested.toLocaleString()} checkable pairs`}
				</span>
			</div>
			<div class="corpus-block">
			<p class="community">
				<!-- Explicit, never on mount: one Firestore read per catalogue
				     entry against a Spark quota. -->
				<button
					type="button"
					class="refresh"
					data-testid="study-refresh"
					disabled={refreshing}
					title={COMMUNITY_HINT}
					onclick={refresh}
				>
					{refreshing ? 'Fetching…' : 'Fetch community animals'}
				</button>
				{#if refreshError}
					<span class="refresh-error">{refreshError}</span>
				{:else if progress}
					<span class="refresh-progress" aria-live="polite">{progressLabel(progress)}</span>
				{:else if cachedCount > 0}
					<span class="community-detail">
						{cachedCount.toLocaleString()} cached{fetchedAt ? `, last fetched ${fetchedAt.slice(0, 10)}` : ''}
					</span>
				{:else}
					<span class="community-detail">none cached — the study sees only your own animals</span>
				{/if}
			</p>
			<p class="corpus">
				<!-- No species name here: it pluralises differently per species and
				     the selector above already says which one is under study. -->
				{run.corpus.subjects.length} of {run.corpus.considered} animals studied{#if run.corpus.excluded.length > 0}&nbsp;— set
					aside: {#each run.corpus.excluded as ex, i (ex.reason)}{i > 0 ? ', ' : ''}{ex.count}
						{EXCLUSION_LABEL[ex.reason] ?? ex.reason}{/each}{/if}
			</p>
			</div>
		</header>

		{#if run.corpus.subjects.length === 0}
			<div class="center-state">
				<p class="state-text">
					No {species} in your stable can be studied yet. An animal needs a fully revealed genome
					and a name carrying its attribute readings.
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
				<div class="split" bind:this={splitEl} style="--evidence-width: {evidenceWidth}px">
					<div class="main">

					{#if current}
						<StudyFindingsTable findings={current.findings} {names} slots={current.slots} />
					{/if}
				</div>

				{#if evidenceSections.length > 0}
					<!-- A focusable `separator` carrying aria-valuenow is the WAI-ARIA
					     window-splitter pattern, which the linter's "noninteractive"
					     rules do not model. Dropping the tabindex to satisfy them
					     would leave the divider mouse-only. -->
					<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
					<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
					<div
						class="splitter"
						role="separator"
						tabindex="0"
						aria-orientation="vertical"
						aria-label="Resize evidence column"
						aria-valuenow={evidenceWidth}
						aria-valuemin={EVIDENCE_MIN}
						aria-valuemax={EVIDENCE_MAX}
						data-testid="study-splitter"
						onpointerdown={startDrag}
						onkeydown={nudge}
					></div>
					<aside class="evidence" data-testid="study-evidence">
						<div class="evidence-nav" role="group" aria-label="Evidence">
							{#each evidenceSections as section (section.id)}
								<button
									type="button"
									class="evidence-tab"
									class:active={section.id === evidenceSection}
									data-testid="study-evidence-{section.id}"
									onclick={() => (evidenceSection = section.id)}
								>
									{section.label}
									<span class="evidence-count">{section.count}</span>
								</button>
							{/each}
						</div>
						<div class="evidence-body">
				{#if evidenceSection === 'doubts' && doubts.length > 0}
					<div class="panel doubts">
						<h3>Check these genes in game</h3>
						<p>
							The animals disagree with what the gene table says these do. The table is entered by
							hand, so it is as likely to be wrong as a pet's record. Check the gene in game: if it is
							wrong, correct it in Reference; if it is right, say so here and the animals behind the
							disagreement become the suspects instead.
						</p>
						<ul>
							{#each doubts as d (`${d.gene}:${d.expression}:${d.attribute}`)}
								<li>
									<span class="doubt-gene">{d.gene}</span>
									<span class="doubt-claim">
										{#if d.reason === 'contradicts-sign'}
											declared {d.attribute}{d.declared > 0 ? '+' : '−'}, but reads
											{d.observed > 0 ? '+' : '−'}{Math.abs(d.observed)}
										{:else if d.reason === 'no-effect'}
											declared {d.attribute}{d.declared > 0 ? '+' : '−'}, but changes nothing
										{:else if d.reason === 'non-integer'}
											{d.attribute} works out to {d.observed.toFixed(2)} — effects are whole numbers, so a
											reading behind this is wrong
										{:else}
											{d.attribute} effect is not consistent across animals
										{/if}
									</span>
									{#if d.checkable}
										<span class="checkable" title="A stabled pair witnesses this, so you can settle it now."
											>checkable</span
										>
									{/if}
									<span class="doubt-animals" title="Distinct animals behind this">{d.animals}</span>
									<button
										type="button"
										class="row-action"
										data-testid="gene-confirm-{d.gene}-{d.expression}"
										disabled={busyRow !== null}
										title="I checked in game and the declared effect is right. Stop recommending this gene, and treat the animals in the dispute as the mis-recorded ones."
										onclick={() => confirmDoubt(d)}
									>
										{busyRow === `${d.gene}:${d.expression}` ? 'Saving…' : 'Table is right'}
									</button>
								</li>
							{/each}
						</ul>
						{#if actionError}
							<p class="action-error">Could not save that: {actionError}</p>
						{/if}
						</div>
				{:else if evidenceSection === 'suspects' && suspects.length > 0}

					<div class="panel suspects shaded">
						<h3>Suspect readings</h3>
						<p>
							These animals disagree with magnitudes the rest of the stable agrees on. The arithmetic
							is exact, so a high count almost always means a mis-recorded attribute. Stabled animals
							come first — those are the ones you can re-read in game and settle.
						</p>
						<ul>
							{#each suspects as [id, s] (id)}
								<li>
									<span class="suspect-name">{names.get(id) ?? `#${id}`}</span>
									{#if s.stabled}
										<span class="checkable" title="Stabled — re-read this animal in game to settle the disagreement."
											>checkable</span
										>
									{/if}
									<span class="suspect-count">{s.count}</span>
								</li>
							{/each}
						</ul>
					</div>
				{:else if evidenceSection === 'misrecorded' && run && run.suspects.length > 0}

					<div class="panel misrecorded shaded">
						<h3>Animals the predictions disagree with</h3>
						<p>
							Each of these takes part in predictions that come out wrong. One mis-typed attribute
							shifts an animal by a constant, so a high share at a single offset is the signature of a
							bad record rather than bad luck. Turning one off stops the study learning from it; you
							can turn it back on at any time.
						</p>
						<ul>
							{#each run.suspects.slice(0, 8) as s (s.subjectId)}
								<li>
									<span class="suspect-name">{names.get(s.subjectId) ?? `#${s.subjectId}`}</span>
									<span class="suspect-count" title="Failed predictions this animal appears in"
										>{s.failures}</span
									>
									<span
										class="offset"
										title="Most of its failures are wrong by this same amount, which is what one mis-typed attribute looks like."
										>off by {s.offset} · {Math.round(s.offsetShare * 100)}%</span
									>
									<button
										type="button"
										class="row-action"
										data-testid="exclude-{s.subjectId}"
										disabled={busyRow !== null}
										onclick={() => toggleUse(s.subjectId, false)}
									>
										{busyRow === s.subjectId ? 'Saving…' : 'Stop using'}
									</button>
								</li>
							{/each}
						</ul>
					</div>
				{:else if evidenceSection === 'excluded' && excluded.length > 0}

					<div class="panel excluded-panel">
						<h3>Not used for studies</h3>
						<p>These animals are excluded from inference. Their records are kept exactly as they are.</p>
						<ul>
							{#each excluded as e (e.subjectId)}
								<li>
									<span class="suspect-name">{e.name}</span>
									<button
										type="button"
										class="row-action"
										data-testid="restore-{e.subjectId}"
										disabled={busyRow !== null}
										onclick={() => toggleUse(e.subjectId, true)}
									>
										{busyRow === e.subjectId ? 'Saving…' : 'Use again'}
									</button>
								</li>
							{/each}
						</ul>
					</div>
				{/if}
					</div>
				</aside>
			{/if}
				</div>
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

	.species-tabs {
		flex-shrink: 0;
		display: flex;
		gap: var(--space-3xs);
		padding: var(--space-xs) var(--space-md) 0;
	}

	.species-tab {
		padding: var(--space-3xs) var(--space-sm);
		background: none;
		border: 1px solid transparent;
		border-radius: 4px;
		font-size: 12px;
		text-transform: capitalize;
		color: var(--text-tertiary);
		cursor: pointer;
	}
	.species-tab.active {
		border-color: var(--border-primary);
		color: var(--text-secondary);
	}

	/* Everything above the split eats into the height the table and evidence
	   get, so it stays tight: smaller gaps, no wasted line between the stat
	   row and the two detail lines below it. Nothing here drops information
	   — only the spacing shrank. */
	.summary {
		flex-shrink: 0;
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		gap: var(--space-lg);
		padding: var(--space-xs) var(--space-md);
		border-bottom: 1px solid var(--border-primary);
	}

	.stat {
		display: flex;
		flex-direction: column;
		gap: 1px;
	}

	.stat-value {
		font-size: 19px;
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

	/* Beside the stats rather than under them: four stats leave most of a wide
	   window empty, and these two lines used to claim a full row each. */
	.corpus-block {
		margin-left: auto;
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: var(--space-3xs);
		text-align: right;
	}

	.community {
		display: flex;
		align-items: baseline;
		gap: var(--space-xs);
		margin: 0;
		font-size: 11px;
	}

	.refresh {
		background: none;
		border: 1px solid var(--border-primary);
		border-radius: 4px;
		padding: var(--space-3xs) var(--space-xs);
		font-size: 11px;
		color: var(--text-secondary);
		cursor: pointer;
	}
	.refresh:disabled {
		color: var(--text-tertiary);
		cursor: default;
	}

	.community-detail {
		color: var(--text-tertiary);
	}

	.refresh-error {
		color: var(--gene-negative);
	}

	.offset {
		font-size: 11px;
		color: var(--text-tertiary);
		font-variant-numeric: tabular-nums;
	}

	.action-error {
		margin: var(--space-2xs) 0 0;
		font-size: 12px;
		color: var(--gene-negative);
	}

	.row-action {
		background: none;
		border: 1px solid var(--border-primary);
		border-radius: 3px;
		padding: 1px var(--space-2xs);
		font-size: 11px;
		color: var(--text-secondary);
		cursor: pointer;
		white-space: nowrap;
	}
	.row-action:hover:not(:disabled) {
		border-color: var(--accent);
		color: var(--accent);
	}
	.row-action:disabled {
		opacity: 0.5;
		cursor: default;
	}

	.refresh-progress {
		color: var(--text-tertiary);
		font-variant-numeric: tabular-nums;
	}

	.corpus {
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

	/* Findings and evidence side by side, each taking the split's full
	   height instead of stacking and fighting over it. `.split` is the one
	   place that decides row vs. column (flipped for narrow windows below),
	   so neither child has to know which layout it is in. */
	.split {
		flex: 1;
		min-height: 0;
		display: flex;
		overflow: hidden;
	}

	/* A flex item AND a flex container for the table below it, so both ends
	   of the chain need their own min-height: 0 (and here, min-width: 0 —
	   the split's main axis is horizontal) or the table's scroller silently
	   stops clipping instead of scrolling. */
	.main {
		flex: 1;
		min-width: 0;
		min-height: 0;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	/* The four "Check genes / Suspect readings / Mis-recorded / Excluded"
	   panels used to stack under the table, each fighting the others (and
	   the table) for height. Now only the picked one renders, beside the
	   table rather than below it, so both get the split's full height and
	   neither scrolls more than it has to. */
	/* A hit area wider than the visible line: a 1px border is not draggable,
	   and padding the handle instead of the border keeps the columns flush. */
	.splitter {
		flex-shrink: 0;
		width: 7px;
		margin-right: -1px;
		cursor: col-resize;
		background: transparent;
		touch-action: none;
	}
	.splitter:hover,
	.splitter:focus-visible {
		background: var(--accent);
		opacity: 0.35;
		outline: none;
	}

	.evidence {
		flex-shrink: 0;
		width: var(--evidence-width, 300px);
		min-height: 0;
		display: flex;
		flex-direction: column;
		border-left: 1px solid var(--border-primary);
		overflow: hidden;
	}

	.evidence-nav {
		flex-shrink: 0;
		display: flex;
		flex-direction: column;
		padding: var(--space-2xs);
		border-bottom: 1px solid var(--border-primary);
	}

	.evidence-tab {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-sm);
		width: 100%;
		padding: var(--space-2xs) var(--space-sm);
		background: none;
		border: none;
		border-left: 2px solid transparent;
		border-radius: 0 4px 4px 0;
		font-size: 12px;
		text-align: left;
		color: var(--text-tertiary);
		cursor: pointer;
	}
	.evidence-tab:hover {
		color: var(--text-secondary);
		background: var(--bg-hover);
	}
	.evidence-tab.active {
		background: var(--bg-secondary);
		border-left-color: var(--accent);
		color: var(--text-secondary);
		font-weight: 600;
	}

	.evidence-count {
		font-size: 11px;
		color: var(--text-tertiary);
		font-variant-numeric: tabular-nums;
	}
	.evidence-tab.active .evidence-count {
		color: var(--text-secondary);
	}

	.evidence-body {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
	}

	/* Below this, a side-by-side split has no room to work with — flip to
	   the findings table on top and evidence below, each with its own
	   scroller. `.evidence` goes back to being capped by height rather than
	   fixed-width, and its nav goes back to a wrapping row so four buttons
	   don't cost four rows of a pane that is already short on height. */
	@media (max-width: 860px) {
		.corpus-block {
			margin-left: 0;
			align-items: flex-start;
			text-align: left;
		}

		.split {
			flex-direction: column;
		}

		/* Stacked: the divider has no axis to drag along, and the inline
		   custom property must not keep forcing a width. */
		.splitter {
			display: none;
		}

		.evidence {
			width: auto;
			max-height: 40%;
			border-left: none;
			border-top: 1px solid var(--border-primary);
		}

		.evidence-nav {
			flex-direction: row;
			flex-wrap: wrap;
			gap: var(--space-3xs);
		}

		.evidence-tab {
			width: auto;
			border-left: none;
			border-radius: 4px;
		}
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

	/* All four evidence panels are the same object: a heading, one
	   explanatory line and a tight list. They differ only in how each row is
	   laid out, so only that differs below. Only one is ever mounted at a
	   time (see `evidenceSection`), and `.evidence-body` is the sole scroll
	   container for it. `.evidence`'s own fixed width is the panel's measure
	   now, so it needs no cap of its own. */
	.panel {
		padding: var(--space-sm) var(--space-md);
	}

	.panel.shaded {
		background: var(--bg-secondary);
	}

	.panel h3 {
		margin: 0 0 var(--space-3xs);
		font-size: 12px;
		font-weight: 600;
		color: var(--text-secondary);
	}

	.panel p {
		margin: 0 0 var(--space-2xs);
		font-size: 11px;
		line-height: 1.4;
		color: var(--text-tertiary);
		max-width: 70ch;
	}

	.panel ul {
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 1px;
	}

	/* `.evidence`'s own fixed width is this list's measure now (down from a
	   panel that used to span most of the window), so a row with several
	   inline pieces — gene, claim sentence, badge, count, button — no longer
	   fits on one line. Wrapping lets the claim take the line it needs and
	   drops the rest to a second line instead of overflowing the column. */
	.panel li {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-3xs) var(--space-sm);
		font-size: 12px;
	}

	.suspects li {
		justify-content: space-between;
	}

	.doubt-gene {
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		color: var(--text-secondary);
		width: 5rem;
		flex-shrink: 0;
	}

	.doubt-claim {
		flex: 1;
		color: var(--text-tertiary);
	}

	.doubt-animals {
		color: var(--text-tertiary);
		font-variant-numeric: tabular-nums;
	}

	.checkable {
		flex-shrink: 0;
		padding: 0 var(--space-2xs);
		border: 1px solid var(--border-primary);
		border-radius: 3px;
		font-size: 11px;
		color: var(--text-tertiary);
	}

	.stat-value.muted {
		color: var(--text-tertiary);
	}

	.suspect-name {
		flex: 1;
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
