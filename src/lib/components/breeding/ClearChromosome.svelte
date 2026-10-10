<script lang="ts">
/**
 * Clear a chromosome: breed toward animals holding the best genotype at
 * every generic locus of it, as a base for any breed. Progress first — how
 * far each animal is, and which crosses most likely give a foal closer than
 * your best of its gender — then the routes to a fully clear foal. See
 * `utils/chromosomeClearing` for the arithmetic.
 */
import { type ClearingPlan, planClearing } from '$lib/services/clearingService.js';
import { Gender, type Pet } from '$lib/types/index.js';

interface Props {
  /** Stabled animals of the species, benched ones out. */
  candidates: readonly Pet[];
  species: string;
}

const { candidates, species }: Props = $props();

/** Chromosome under work. Only 1 for now; the arithmetic takes any. */
const chromosome = '01';

let plan = $state<ClearingPlan | null>(null);
let failed = $state(false);
let seq = 0;

$effect(() => {
  const pets = candidates;
  const sp = species;
  const mine = ++seq;
  failed = false;
  planClearing({ pets, species: sp, chromosome })
    .then((result) => {
      if (mine === seq) plan = result;
    })
    .catch((err: unknown) => {
      if (mine !== seq) return;
      console.error('planClearing failed', err);
      failed = true;
    });
});

let showAll = $state(false);
const shownAnimals = $derived(plan ? (showAll ? plan.animals : plan.animals.slice(0, 8)) : []);

const percent = (p: number) => (p === 0 ? '0%' : p < 0.001 ? '<0.1%' : `${(p * 100).toFixed(p < 0.1 ? 1 : 0)}%`);
const foalsText = (n: number) =>
  Number.isFinite(n) ? `≈ ${n < 10 ? Math.round(n * 10) / 10 : Math.round(n).toLocaleString()}` : '—';
const oneIn = (p: number) => `1 in ${p > 0.5 ? Math.round((1 / p) * 10) / 10 : Math.round(1 / p).toLocaleString()}`;
const genderWord = (g: Gender) => (g === Gender.MALE ? 'male' : 'female');
const other = (g: Gender) => (g === Gender.MALE ? Gender.FEMALE : Gender.MALE);
const targetSummary = (targets: ClearingPlan['targets']) => {
  const kinds = new Set(targets.map(([, t]) => t));
  return kinds.size === 1
    ? `${[...kinds][0]} at all ${targets.length}`
    : `the better homozygote at each of ${targets.length}`;
};
</script>

<div class="clear" data-testid="clear-chromosome">
	{#if failed}
		<p class="hint error">Could not plan the clearing.</p>
	{:else if !plan}
		<p class="hint">Working out the clearing…</p>
	{:else if plan.targets.length === 0}
		<p class="hint">Chromosome {Number(chromosome)} has no generic locus with a better genotype to aim for.</p>
	{:else}
		{@const closest = plan.animals[0]}
		<p class="best" data-testid="clear-summary">
			Target: <strong>{targetSummary(plan.targets)}</strong> generic loci of chromosome {Number(chromosome)}, the genotype
			expressing the better effect at each. Closest male:
			<strong>{plan.best.Male ?? '—'}</strong> alleles to go; closest female: <strong>{plan.best.Female ?? '—'}</strong>.
		</p>
		<p class="meta">
			Alleles to go: two per locus homozygous the wrong way, one per carrier. A foal is on average halfway between its
			parents, so progress comes from keeping the foals that land closer. A parent homozygous the wrong way
			<em>blocks</em> that locus: no foal of it can reach the target there.
		</p>

		<section data-testid="clear-animals">
			<h3>Your animals</h3>
			<div class="table-wrapper">
				<table>
					<thead>
						<tr>
							<th scope="col">Animal</th>
							<th scope="col" class="numeric" title="Two per locus homozygous the wrong way, one per carrier">To go</th>
							<th scope="col" class="numeric">On target</th>
							<th scope="col" class="numeric">Carrier</th>
							<th scope="col">Blocks</th>
						</tr>
					</thead>
					<tbody>
						{#each shownAnimals as a (a.pet.id)}
							<tr data-testid="clear-animal-{a.pet.id}">
								<td>{a.pet.name} <span class="muted">({genderWord(a.pet.gender)})</span></td>
								<td class="numeric strong">{a.toGo}</td>
								<td class="numeric">{a.onTarget}</td>
								<td class="numeric">{a.carrier}</td>
								<td class="genes">{a.blocked.join(', ') || '—'}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			{#if plan.animals.length > 8}
				<button type="button" class="link" data-testid="clear-animals-toggle" onclick={() => (showAll = !showAll)}
					>{showAll ? 'Show the closest 8' : `Show all ${plan.animals.length}`}</button
				>
			{/if}
		</section>

		{#if plan.pairs.length > 0}
			<section data-testid="clear-pairs">
				<h3>Crosses that move the {genderWord(plan.behind)} line, which is further behind</h3>
				<div class="table-wrapper">
					<table>
						<thead>
							<tr>
								<th scope="col">Cross</th>
								<th scope="col" class="numeric" title="P(a {genderWord(plan.behind)} foal has fewer alleles to go than your closest {genderWord(plan.behind)})"
									>Beats best {genderWord(plan.behind)}</th
								>
								<th scope="col" class="numeric" title="P(a {genderWord(other(plan.behind))} foal has fewer alleles to go than your closest {genderWord(other(plan.behind))})"
									>Beats best {genderWord(other(plan.behind))}</th
								>
								<th scope="col" class="numeric" title="P(the foal is on target at every locus)">Clear</th>
								<th scope="col">Blocked</th>
							</tr>
						</thead>
						<tbody>
							{#each plan.pairs as p (`${p.sire.id}:${p.dam.id}`)}
								<tr data-testid="clear-pair-{p.sire.id}-{p.dam.id}">
									<td>{p.sire.name} × {p.dam.name}</td>
									<td class="numeric strong">{percent(p.pCloser[plan.behind])}</td>
									<td class="numeric">{percent(p.pCloser[other(plan.behind)])}</td>
									<td class="numeric">{percent(p.pClear)}</td>
									<td class="genes">{p.blocked.join(', ') || '—'}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</section>
		{/if}

		<section data-testid="clear-routes">
			<h3>Two steps to a clear foal</h3>
			<p class="hint">
				Breed a pair, keep a foal, breed it to a third animal. You read the foal's genome before keeping it, so each
				route says what to keep it for. Counts assume the kept foal is the gender its partner needs; how often a foal
				is, is not modelled.
			</p>
			{#if plan.routes.length === 0}
				<p class="hint" data-testid="clear-routes-empty">
					No two-step route can clear every locus: some locus is blocked whichever animals you use. Breed for progress
					first.
				</p>
			{:else}
				<div class="table-wrapper">
					<table>
						<thead>
							<tr>
								<th scope="col">Plan</th>
								<th scope="col" class="numeric" title="Foals bred in both steps, on average, until one is clear">Foals</th>
								<th scope="col" class="numeric" title="P(a foal of step 3 is clear)">Clear</th>
							</tr>
						</thead>
						<tbody>
							{#each plan.routes as r (`${r.sire.id}:${r.dam.id}:${r.partner.id}`)}
								<tr data-testid="clear-route-{r.sire.id}-{r.dam.id}-{r.partner.id}">
									<td class="plan">
										<div>1. Breed <strong>{r.sire.name} × {r.dam.name}</strong></div>
										<div>
											2. Keep a {genderWord(other(r.partner.gender))} foal{#if r.keep.length > 0}{' '}that is <span class="genes"
													>{r.keep.map((k) => `${k.gene} ${k.allowed.join(' or ')}`).join(', ')}</span
												>
												<span class="muted">({oneIn(r.pQualify)} foals)</span>{:else}, any will do{/if}
										</div>
										<div>3. Breed it to {r.partner.name}</div>
									</td>
									<td class="numeric">{foalsText(r.foals)}</td>
									<td class="numeric strong">{percent(r.pClear)}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</section>
	{/if}
</div>

<style>
	.clear {
		flex-shrink: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-sm);
	}

	.hint,
	.meta {
		margin: 0;
		font-size: 12px;
		line-height: 1.5;
		color: var(--text-tertiary);
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

	h3 {
		margin: var(--space-sm) 0 var(--space-2xs);
		font-size: 13px;
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
	.muted {
		color: var(--text-tertiary);
	}

	.genes {
		font-family: ui-monospace, monospace;
		font-size: 12px;
		color: var(--text-secondary);
	}

	.plan {
		font-size: 12px;
		line-height: 1.6;
	}

	.link {
		align-self: flex-start;
		margin-top: var(--space-2xs);
		background: none;
		border: none;
		padding: 0;
		font: inherit;
		font-size: 12px;
		color: var(--accent-text, var(--accent));
		cursor: pointer;
		text-decoration: underline;
	}
</style>
