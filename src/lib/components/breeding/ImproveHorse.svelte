<script lang="ts">
/**
 * Improve one animal: keep it, pick the attributes it should gain on, and
 * rank its partners by how likely one foal is to beat it there without
 * losing more than a tolerance anywhere else. See `utils/targetedBreeding`
 * for the arithmetic and its limits.
 */

import { normalizeSpecies } from '$lib/services/configService.js';
import { attributeMagnitudesFor, peekAttributeMagnitudes } from '$lib/services/studyService.js';
import {
  type BridgeResult,
  rankBridges,
  rankPartners,
  type TargetedPlan,
} from '$lib/services/targetedBreedingService.js';
import { breedingView } from '$lib/stores/breeding.svelte.js';
import type { Pet } from '$lib/types/index.js';
import { expectedFoals, type KeepRule, type PartnerOutlook } from '$lib/utils/targetedBreeding.js';

interface Props {
  /** Stabled animals of the species: who can be improved. */
  pool: readonly Pet[];
  /** The pool without benched animals: who can be a partner. */
  candidates: readonly Pet[];
  /** Capitalised attribute names, in display order. */
  attrNames: readonly string[];
}

const { pool, candidates, attrNames }: Props = $props();

const anchors = $derived([...pool].sort((a, b) => a.name.localeCompare(b.name)));
const anchor = $derived(pool.find((p) => p.id === breedingView.anchorId) ?? null);
const targets = $derived(breedingView.targets.filter((t) => attrNames.includes(t)));
const others = $derived(attrNames.filter((a) => !targets.includes(a)));

let plan = $state<TargetedPlan | null>(null);
/** Two-step routes; `null` while they are being ranked. */
let routes = $state<BridgeResult[] | null>(null);
/** A gain gene to show routes for, instead of the best routes overall. */
let focus = $state<string | null>(null);
let loading = $state(false);
let failed = $state(false);
let seq = 0;
let routeSeq = 0;

/** Effect sizes, peeked first: the Breed tab has usually solved the study already. */
async function magnitudesFor(pet: Pet) {
  const species = normalizeSpecies(pet.species);
  return peekAttributeMagnitudes(species) ?? (await attributeMagnitudesFor(species));
}

$effect(() => {
  const a = anchor;
  const t = targets;
  const tolerance = breedingView.tolerance;
  const pets = candidates;
  if (!a || t.length === 0) {
    plan = null;
    return;
  }
  const mine = ++seq;
  loading = true;
  failed = false;
  (async () => {
    const result = await rankPartners({ anchor: a, pets, targets: t, tolerance, magnitudes: await magnitudesFor(a) });
    if (mine === seq) plan = result;
  })()
    .catch((err: unknown) => {
      if (mine !== seq) return;
      console.error('rankPartners failed', err);
      plan = null;
      failed = true;
    })
    .finally(() => {
      if (mine === seq) loading = false;
    });
});

// Routes rank separately: they take a second or so, and the direct partners
// are the answer the player can act on today, so they must not wait. A
// failed route search leaves that answer standing.
$effect(() => {
  const a = anchor;
  const t = targets;
  const tolerance = breedingView.tolerance;
  const pets = candidates;
  const gene = focus;
  routes = null;
  if (!a || t.length === 0) return;
  const mine = ++routeSeq;
  (async () => {
    const magnitudes = await magnitudesFor(a);
    return rankBridges({ anchor: a, pets, targets: t, tolerance, magnitudes, limit: 6, focus: gene ?? undefined });
  })()
    .catch((err: unknown) => {
      console.error('rankBridges failed', err);
      return [];
    })
    .then((ranked) => {
      if (mine === routeSeq) routes = ranked;
    });
});

// A focus belongs to one question; a new animal or target asks another.
$effect(() => {
  void anchor;
  void targets;
  focus = null;
});

function toggleTarget(attr: string) {
  breedingView.targets = targets.includes(attr) ? targets.filter((t) => t !== attr) : [...targets, attr];
}

const recorded = (pet: Pet, attr: string) => (pet as unknown as Record<string, unknown>)[attr.toLowerCase()];
const percent = (p: number) => (p === 0 ? '0%' : p < 0.001 ? '<0.1%' : `${(p * 100).toFixed(p < 0.1 ? 1 : 0)}%`);
const signed = (n: number) => {
  const r = Math.round(n * 10) / 10;
  return r > 0 ? `+${r}` : r < 0 ? `−${-r}` : '0';
};

/** The kept attribute most likely to fall below the tolerance. */
function mainRisk(o: PartnerOutlook): { attr: string; p: number } | null {
  let worst: { attr: string; p: number } | null = null;
  for (const [attr, p] of Object.entries(o.pDrop)) if (p > 0 && (!worst || p > worst.p)) worst = { attr, p };
  return worst;
}

/** Unmeasured target changes, by the direction their declared signs give. */
const unmeasuredOn = (o: PartnerOutlook) =>
  targets.reduce(
    (sum, t) => ({
      better: sum.better + (o.unmeasured[t]?.better ?? 0),
      worse: sum.worse + (o.unmeasured[t]?.worse ?? 0),
    }),
    { better: 0, worse: 0 },
  );

const best = $derived(plan?.partners[0]?.outlook.pSuccess ?? 0);

/** `≈ 8`; a dash when success is out of reach. */
const foalsText = (n: number) =>
  Number.isFinite(n) ? `≈ ${n < 10 ? Math.round(n * 10) / 10 : Math.round(n).toLocaleString()}` : '—';

/** `08B3 D or x` */
const ruleText = (k: KeepRule) => `${k.gene} ${k.allowed.join(' or ')}`;

/** `1 in 32` */
const oneIn = (p: number) => `1 in ${p > 0.5 ? Math.round((1 / p) * 10) / 10 : Math.round(1 / p).toLocaleString()}`;
/** Loci where a partner could lift the targets: what a two-step route can bring in. */
const gainGenes = $derived(plan?.needs.filter((n) => n.byPartner[n.best] > 0) ?? []);
/** The gender the middle foal of a two-step route has to be. */
const middleGender = $derived(anchor?.gender === 'Male' ? 'female' : 'male');
</script>

{#snippet outcomeHead()}
	<th scope="col" class="numeric" title="Foals bred, on average, until one succeeds">Foals</th>
	<th scope="col" class="numeric" title="Every target up, every other attribute kept within the tolerance">Success</th>
	<th scope="col" class="numeric" title="Every target up, whatever happens elsewhere">Targets up</th>
	{#each targets as t (t)}
		<th scope="col" class="numeric" title="Expected change from {anchor?.name}, in measured points">Δ {t}</th>
	{/each}
	<th scope="col">Main risk</th>
	<th scope="col">Moves the targets</th>
{/snippet}

{#snippet outcome(o: PartnerOutlook, foals: number)}
	{@const risk = mainRisk(o)}
	{@const blind = unmeasuredOn(o)}
	<td class="numeric">{foalsText(foals)}</td>
	<td class="numeric strong">{percent(o.pSuccess)}</td>
	<td class="numeric">{percent(o.pTargets)}</td>
	{#each targets as t (t)}
	{@const d = o.expected[t] ?? 0}
		<td class="numeric" class:up={d > 0} class:down={d < 0}>{signed(d)}</td>
	{/each}
	<td class="risk">
		{#if risk}{risk.attr} falls {percent(risk.p)}{:else}—{/if}
	</td>
	<td class="levers">
		{#each o.levers.slice(0, 3) as l, i (l.gene)}{i > 0 ? ', ' : ''}<span
				class:up={l.expected > 0}
				class:down={l.expected < 0}
				title="{anchor?.name} {l.anchor} × {l.partner === null ? `a ${middleGender} foal of the pair` : `partner ${l.partner}`}; foal changes slot {percent(l.pChange)} of the time"
				>{l.gene} {signed(l.expected)}</span
			>{/each}{#if blind.better + blind.worse > 0}<span
				class="blind"
				title="Expected loci where the foal changes a target slot whose size the study has not measured. The declared signs give the direction: gaining a positive or dropping a negative is better."
				>{o.levers.length > 0 ? '; ' : ''}unmeasured {#if blind.better > 0}<span class="up"
						>↑{blind.better.toFixed(1)}</span
					>{/if}{#if blind.better > 0 && blind.worse > 0}&nbsp;{/if}{#if blind.worse > 0}<span class="down"
						>↓{blind.worse.toFixed(1)}</span
					>{/if}</span
			>{/if}
	</td>
{/snippet}

<div class="improve" data-testid="improve-horse">
	<div class="controls">
		<label class="field">
			<span class="label">Improve</span>
			<select
				data-testid="improve-anchor"
				value={breedingView.anchorId ?? ''}
				onchange={(e) => {
					const v = (e.currentTarget as HTMLSelectElement).value;
					breedingView.anchorId = v === '' ? null : Number(v);
				}}
			>
				<option value="">Choose an animal…</option>
				{#each anchors as p (p.id)}
					<option value={p.id}>{p.name} ({p.gender}{p.breed ? `, ${p.breed}` : ''})</option>
				{/each}
			</select>
		</label>

		<div class="field">
			<span class="label">Raise</span>
			<div class="seg" role="group" aria-label="Target attributes">
				{#each attrNames as attr (attr)}
					<button
						type="button"
						class="seg-btn"
						class:active={targets.includes(attr)}
						aria-pressed={targets.includes(attr)}
						data-testid="improve-target-{attr}"
						onclick={() => toggleTarget(attr)}>{attr}</button
					>
				{/each}
			</div>
		</div>

		<label class="field" title="How many points any other attribute may fall below the animal and still count as kept.">
			<span class="label">Allow other stats to drop by</span>
			<input
				type="number"
				min="0"
				max="50"
				data-testid="improve-tolerance"
				value={breedingView.tolerance}
				oninput={(e) => {
					// On input, not change: a typed value would otherwise wait for
					// Enter or blur, and the ranking on screen would not match the box.
					const raw = (e.currentTarget as HTMLInputElement).value;
					if (raw === '') return;
					const n = Number(raw);
					if (Number.isFinite(n)) breedingView.tolerance = Math.max(0, Math.min(50, Math.round(n)));
				}}
			/>
			<span class="unit">points</span>
		</label>
	</div>

	{#if anchor}
		<p class="anchor-line" data-testid="improve-anchor-values">
			{#each attrNames as attr, i (attr)}{i > 0 ? ' · ' : ''}<span class:target={targets.includes(attr)}
					>{attr} {recorded(anchor, attr) ?? '—'}</span
				>{/each}
		</p>
	{/if}

	{#if !anchor}
		<p class="hint">Choose the animal to improve. Its partners are your stabled animals of the other gender.</p>
	{:else if targets.length === 0}
		<p class="hint">Choose at least one attribute to raise.</p>
	{:else if failed}
		<p class="hint error">Could not rank partners.</p>
	{:else if loading && !plan}
		<p class="hint">Ranking partners…</p>
	{:else if plan}
		{#if plan.partners.length === 0}
			<p class="meta" data-testid="improve-summary">
				No stabled {anchor.gender === 'Male' ? 'female' : 'male'} is available to breed with {anchor.name}.
			</p>
		{:else}
			{@const top = plan.partners[0]}
			{@const route = routes?.[0]}
			<!-- The answer first, however small: a 13% best choice is still the
			     best choice, and the player decides whether it is worth a foal. -->
			{@const topFoals = expectedFoals(top.outlook.pSuccess)}
			<p class="best" data-testid="improve-best">
				Best partner: <strong>{top.partner.name}</strong>. {percent(top.outlook.pTargets)} of foals beat
				{anchor.name} on {targets.join(' and ')}{#if others.length > 0}, and {percent(top.outlook.pSuccess)} also
					lose no more than {breedingView.tolerance} on anything else{/if}{#if Number.isFinite(topFoals)}: about
					{foalsText(topFoals).slice(2)} foals for one that does{/if}.
			</p>
			{#if !focus && route && route.foals < topFoals}
				<p class="best" data-testid="improve-best-route">
					Better in two steps: about {foalsText(route.foals).slice(2)} foals in all. Breed
					<strong>{route.sire.name} × {route.dam.name}</strong>, keep a {middleGender} foal{route.keep.length > 0
						? ` that is ${route.keep.map(ruleText).join(', ')}`
						: ''}, then breed it to {anchor.name}.
				</p>
			{/if}
			<p class="meta" data-testid="improve-summary">
				Foals are taken to be {anchor.breed || 'the same breed'}; changes are in measured points.{#if best === 0}
					{plan.needs.length > 0
						? ' The list at the bottom says what a better partner would need to carry.'
						: ' The study has not measured enough of these genes to say what a better partner would need.'}{/if}
			</p>
		{/if}

		{#if plan.partners.length > 0}
			<div class="table-wrapper">
				<table data-testid="improve-partners">
					<thead>
						<tr>
							<th scope="col">Partner</th>
							{@render outcomeHead()}
						</tr>
					</thead>
					<tbody>
						{#each plan.partners as r (r.partner.id)}
							<tr data-testid="improve-partner-{r.partner.id}">
								<td>
									{r.partner.name}
									{#if r.crossBreed}
										<span
											class="tag-badge cross"
											title="A {r.partner.breed} partner: the foal may come out {r.partner.breed} rather than {anchor.breed}. Scored as {anchor.breed}."
											>{r.partner.breed}</span
										>
									{/if}
								</td>
								{@render outcome(r.outlook, expectedFoals(r.outlook.pSuccess))}
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}

		{#if plan.partners.length > 0}
			<section class="routes" data-testid="improve-routes">
				<h3>
					Two steps: breed a pair, keep a {middleGender} foal, breed it to {anchor.name}{focus ? ` — bringing in ${focus}` : ''}
				</h3>
				<p class="hint">
					For genes only {anchor.gender === 'Male' ? 'males' : 'females'} carry, or that need a better partner than
					the stable has. You read the foal's genome before keeping it, so each route says what to keep it for
					and how many of the pair's foals qualify. Odds and foal counts assume the kept foal is {middleGender};
					how often a foal is, is not modelled.
				</p>
				{#if gainGenes.length > 0}
					<!-- The best routes overall rarely carry a single gene in: the
					     carriers usually bring losses elsewhere. So each gain gene
					     gets its own view, one click away rather than at the bottom. -->
					<div class="field focus-picker">
						<span class="label">Show</span>
						<div class="seg" role="group" aria-label="Routes to show" data-testid="improve-focus">
							<button
								type="button"
								class="seg-btn"
								class:active={focus === null}
								aria-pressed={focus === null}
								data-testid="improve-focus-clear"
								onclick={() => (focus = null)}>Best routes</button
							>
							{#each gainGenes as n (n.gene)}
								<button
									type="button"
									class="seg-btn"
									class:active={focus === n.gene}
									aria-pressed={focus === n.gene}
									data-testid="improve-focus-chip-{n.gene}"
									title="Routes that bring {n.gene} into a {middleGender} foal: worth {signed(n.byPartner[n.best])} in {anchor.name}'s foals from a {n.best} partner"
									onclick={() => (focus = n.gene)}>Bring in {n.gene} ({signed(n.byPartner[n.best])})</button
								>
							{/each}
						</div>
					</div>
				{/if}
				{#if routes === null}
					<p class="hint">Looking for two-step routes…</p>
				{:else if routes.length === 0}
					<p class="hint" data-testid="improve-routes-empty">
						{focus ? `No stabled pair can give a ${middleGender} foal what ${anchor.name} needs at ${focus}.` : 'No two-step route found.'}
					</p>
				{:else}
					<div class="table-wrapper">
						<table data-testid="improve-route-table">
							<thead>
								<tr>
									<th scope="col">Plan</th>
									{@render outcomeHead()}
								</tr>
							</thead>
							<tbody>
								{#each routes as r (`${r.sire.id}:${r.dam.id}`)}
									<tr data-testid="improve-route-{r.sire.id}-{r.dam.id}">
										<td class="plan">
											<div>
												1. Breed <strong>{r.sire.name} × {r.dam.name}</strong>
												{#if r.crossBreed}
													<span
														class="tag-badge cross"
														title="A grandparent of another breed: the foals may come out that breed rather than {anchor.breed}. Scored as {anchor.breed}."
														>cross-breed</span
													>
												{/if}
											</div>
											<div data-testid="improve-route-keep">
												2. Keep a {middleGender} foal{#if r.keep.length > 0}{' '}that is <span class="rules">{r.keep.map(ruleText).join(', ')}</span>
													<span class="muted">({oneIn(r.pQualify)} foals)</span>{:else}, any will do{/if}
											</div>
											<div>3. Breed it to {anchor.name}</div>
										</td>
										{@render outcome(r.outlook, r.foals)}
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				{/if}
			</section>
		{/if}

		{#if plan.needs.length > 0}
			<section class="needs" data-testid="improve-needs">
				<h3>What a partner would need to carry</h3>
				<p class="hint">
					Per locus, the partner genotype that does most for {targets.join(' and ')}, and the expected change in
					points for each choice. <em>Gain</em> loci are where a partner can lift the foal above {anchor.name}, by
					adding a positive or dropping one of {anchor.name}'s negatives;
					at <em>keep</em> loci {anchor.name} already holds the best, and the wrong partner costs points. A
					recessive positive survives only if the partner passes a recessive allele too.
				</p>
				<table>
					<thead>
						<tr>
							<th scope="col">Gene</th>
							<th scope="col">{anchor.name}</th>
							<th scope="col"></th>
							<th scope="col">Best partner</th>
							<th scope="col" class="numeric" title="Partners here that carry the best genotype">Have it</th>
							<th scope="col" class="numeric">D</th>
							<th scope="col" class="numeric">x</th>
							<th scope="col" class="numeric">R</th>
							<th scope="col"></th>
						</tr>
					</thead>
					<tbody>
						{#each plan.needs.slice(0, 12) as n (n.gene)}
							<tr data-testid="improve-need-{n.gene}">
								<td>{n.gene}</td>
								<td>{n.anchor}</td>
								<td class="kind">{n.byPartner[n.best] > 0 ? 'gain' : 'keep'}</td>
								<td class="strong">{n.best}</td>
								<td class="numeric">{n.matching} of {plan.partners.length}</td>
								{#each ['D', 'x', 'R'] as const as t (t)}
									<td class="numeric" class:up={n.byPartner[t] > 0} class:down={n.byPartner[t] < 0}
										>{signed(n.byPartner[t])}</td
									>
								{/each}
								<td>
									{#if n.byPartner[n.best] > 0}
										<button
											type="button"
											class="link"
											data-testid="improve-focus-{n.gene}"
											title="Two-step routes that bring {n.gene} in through a {middleGender} foal"
											onclick={() => (focus = n.gene)}>Routes</button
										>
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</section>
		{/if}
	{/if}
</div>

<style>
	/* Natural height, and the Breed body scrolls it. Left shrinkable, a long
	   page squeezed the partner table to its border while the sections
	   below it kept their height. */
	.improve {
		flex-shrink: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-sm);
	}

	.controls {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-sm) var(--space-lg);
	}

	.field {
		display: flex;
		align-items: center;
		gap: var(--space-xs);
	}

	.label {
		font-size: 12px;
		font-weight: 600;
		color: var(--text-secondary);
		white-space: nowrap;
	}

	select,
	input {
		font: inherit;
		font-size: 12px;
		padding: var(--space-3xs) var(--space-xs);
		border: 1px solid var(--border-primary);
		border-radius: 6px;
		background: var(--bg-primary);
		color: var(--text-primary);
	}
	input {
		width: 4em;
	}

	.unit,
	.hint,
	.meta {
		font-size: 12px;
		color: var(--text-tertiary);
	}
	.hint,
	.meta {
		margin: 0;
		line-height: 1.5;
	}
	.error {
		color: var(--gene-negative);
	}

	.best {
		margin: 0;
		font-size: 13px;
		color: var(--text-secondary);
	}
	.best strong {
		color: var(--text-primary);
	}

	.anchor-line {
		margin: 0;
		font-size: 12px;
		color: var(--text-tertiary);
		font-variant-numeric: tabular-nums;
	}
	.anchor-line .target {
		color: var(--text-primary);
		font-weight: 600;
	}

	.table-wrapper {
		flex: none;
		overflow-x: auto;
		border: 1px solid var(--border-primary);
		border-radius: 6px;
		background: var(--bg-primary);
	}

	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 13px;
	}

	th {
		text-align: left;
		background: var(--bg-secondary);
		border-bottom: 1px solid var(--border-primary);
		font-weight: 600;
		font-size: 12px;
		padding: var(--space-sm) var(--space-md);
		position: sticky;
		top: 0;
		white-space: nowrap;
	}

	td {
		padding: var(--space-xs) var(--space-md);
		border-bottom: 1px solid var(--border-primary);
	}

	.numeric {
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
	.strong {
		font-weight: 600;
	}
	.up {
		color: var(--gene-positive);
	}
	.down {
		color: var(--gene-negative);
	}

	.risk,
	.levers {
		font-size: 12px;
		color: var(--text-secondary);
	}
	.levers {
		font-family: ui-monospace, monospace;
	}
	.blind {
		color: var(--text-tertiary);
	}

	.cross {
		margin-left: var(--space-2xs);
		background: var(--bg-tertiary);
		color: var(--text-secondary);
	}

	.link {
		background: none;
		border: none;
		padding: 0;
		font: inherit;
		font-size: 12px;
		color: var(--accent-text, var(--accent));
		cursor: pointer;
		text-decoration: underline;
	}

	.focus-picker {
		flex-wrap: wrap;
		margin-bottom: var(--space-xs);
	}

	.plan {
		font-size: 12px;
		line-height: 1.6;
		min-width: 26em;
	}
	.plan .rules {
		font-family: ui-monospace, monospace;
	}
	.muted {
		color: var(--text-tertiary);
	}

	.kind {
		font-size: 12px;
		color: var(--text-tertiary);
	}

	.routes h3,
	.needs h3 {
		margin: var(--space-sm) 0 var(--space-2xs);
		font-size: 13px;
	}
	.needs table {
		width: auto;
		margin-top: var(--space-xs);
		border: 1px solid var(--border-primary);
	}
</style>
