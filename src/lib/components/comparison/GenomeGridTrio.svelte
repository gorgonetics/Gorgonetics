<script lang="ts">
import { onDestroy, onMount, untrack } from 'svelte';
import '$lib/components/gene/geneCell.css';
import GeneTooltip from '$lib/components/gene/GeneTooltip.svelte';
import BreedSelector from '$lib/components/shared/BreedSelector.svelte';
import DetailOverlay from '$lib/components/shared/DetailOverlay.svelte';
import GeneFilterPills, { type FilterPillItem } from '$lib/components/shared/GeneFilterPills.svelte';
import StatusPane from '$lib/components/shared/StatusPane.svelte';
import { getAttributeConfig, normalizeSpecies } from '$lib/services/configService.js';
import { getGeneEffectsCached } from '$lib/services/geneService.js';
import { computeOffspringTrio } from '$lib/services/offspringTrioService.js';
import { isBreedScoped, loadGeneImpact, studyInputsKey } from '$lib/services/studyService.js';
import { pets as petList } from '$lib/stores/pets.js';
import {
  type AttributeInfo,
  type BreedingPairResult,
  GeneType,
  HORSE_BREEDS,
  type OffspringTrioResult,
  type Pet,
  type TrioContributionMode,
  type TrioGainMode,
} from '$lib/types/index.js';
import { attributePotentialFilterCSS } from '$lib/utils/filterCSS.js';
import { triStateToggle } from '$lib/utils/filterToggle.js';
import { breedFor, effectFor, type GeneEffectData, isNoEffect } from '$lib/utils/geneAnalysis.js';
import { buildAppearanceLookup, createGeneCellBuilder, type GeneCell } from '$lib/utils/geneGridCells.js';
import { expressedImpact, formatPoints, impactPaint, maxAbsPoints } from '$lib/utils/geneImpact.js';
import { hiddenGeneCount } from '$lib/utils/hiddenGenes.js';
import { keyedResource } from '$lib/utils/keyedResource.svelte.js';
import {
  type AttributeOutlook,
  locusOutlook,
  offspringAttributeOutlooks,
  type PairParent,
} from '$lib/utils/offspringImpact.js';
import { ATTRIBUTE_KEYS } from '$lib/utils/sharedPet.js';
import { getSpeciesEmoji } from '$lib/utils/species.js';
import { capitalize } from '$lib/utils/string.js';
import {
  buildTrioGrid,
  contributionBackground,
  contributionOf,
  outcomeBoxBackground,
  poolIdentity,
  type TrioGrid,
  type TrioLocusCell,
} from '$lib/utils/trioGrid.js';

interface Props {
  father: Pet;
  mother: Pet;
  offspringBreed?: string;
  /**
   * The candidate pool the pair was ranked against. Required for the Quality
   * and Pool gain lenses — both measure against the rest of the stable, so
   * two parents alone cannot produce them.
   */
  pool?: readonly Pet[];
  breedLockWeight?: number;
  /**
   * The pair's ranked row, when the trio was opened from the breeding table.
   * Drives the score panel; absent, the panel is not shown.
   */
  scores?: BreedingPairResult;
  /** Back out of the trio lens (→ Pairs). */
  onClose: () => void;
}

const { father, mother, offspringBreed = '', pool, breedLockWeight, scores, onClose }: Props = $props();

const isHorse = $derived(normalizeSpecies(father.species) === 'horse');
/** Parents whose genomes hide genes, for the warning above the grid. */
const hiddenParents = $derived(
  [
    { label: `♂ ${father.name || 'Father'}`, count: hiddenGeneCount(father) },
    { label: `♀ ${mother.name || 'Mother'}`, count: hiddenGeneCount(mother) },
  ].filter((p) => p.count > 0),
);
const speciesLabel = $derived(normalizeSpecies(father.species));

let loading = $state(false);
let error = $state<string | null>(null);
let grid = $state<TrioGrid | null>(null);
let summary = $state<OffspringTrioResult['summary'] | null>(null);
let attributeDisplayInfo = $state<AttributeInfo[]>([]);
// Kept for the styled parent tooltip (the "if Dominant/Recessive" alternatives).
let effectsDB = $state<Record<string, GeneEffectData>>({});
const attributeItems = $derived<FilterPillItem[]>(
  attributeDisplayInfo.map((a) => ({ key: a.key, name: a.name, icon: a.icon })),
);

// Breed re-runs the projection (the service drops loci locked to other breeds,
// keeping the trio consistent with the breeding ranking). Attribute is a visual
// focus filter applied as CSS over the rendered grid — the same engine the
// 2-pet diff grid uses (select dims everything else, alt-click hides).
let selectedBreed = $state(untrack(() => offspringBreed));
let selectedAttributes = $state<string[]>([]);
let hiddenAttributes = $state<string[]>([]);
// "New gains only": hide locked loci — those where both parents share the same
// homozygous allele (both dominant or both recessive), so every offspring is
// fixed to that same genotype and nothing new can appear. This is broader than
// a "locked-in gain" (it includes neutral loci with no attribute effect), which
// is what the player means by "won't change in the offspring".
let hideLocked = $state(false);
// Which improvement the offspring boxes highlight as the vivid gain: expressing
// a new positive attribute, or "Clarification" (clearing a mixed gene to
// homozygous, so it breeds true). The other collapses into the muted keep shade.
let gainMode = $state<TrioGainMode>('attributes');
// Which additive pair score the offspring boxes are tinted by, or `off` for
// the default outcome-bucket rendering. Only the three scores that are a plain
// sum over loci appear here — see `TrioLocusContributions` for why Ceiling,
// Floor and Cleanup cannot join them.
let contributionMode = $state<TrioContributionMode>('off');
// Open the arithmetic behind the non-additive scores. Off by default: it
// answers "why is this number what it is", which is not the question the grid
// itself is for.
let showScores = $state(false);

// --- Impact lens ------------------------------------------------------------
// What the foal's attributes are expected to be, from the study's measured
// gene effects. Replaces the outcome buckets while on: both parents and the
// foal are tinted by points, and a panel estimates each attribute.
let lens = $state<'outcome' | 'impact'>('outcome');
const breedScoped = $derived(isBreedScoped(father.species));
/**
 * A breed-scoped species needs a real offspring breed here: breeds carry their
 * own loci and their own attribute base, so without one neither the loci the
 * foal has nor the parent to anchor its values on is defined. Mixed has no
 * single base.
 */
const impactBreedMissing = $derived(breedScoped && (!selectedBreed || selectedBreed === 'Mixed'));
/** The parents' own breeds, offered as one-click picks when none is chosen. */
const parentBreeds = $derived(
  [...new Set([father.breed, mother.breed])].filter((b): b is string => !!b && b !== 'Mixed' && !!HORSE_BREEDS[b]),
);
const impactKey = $derived.by(() => {
  if (lens !== 'impact') return null;
  const _reloaded = $petList;
  return studyInputsKey(father.species);
});
const impactResource = keyedResource(() => impactKey, loadGeneImpact);
const impactData = $derived(impactResource.value ?? null);
const impactMaxAbs = $derived(impactData ? maxAbsPoints(impactData.magnitudes) : 0);
/** Tint only when the loci on screen are the foal's: data in, and a breed where one is needed. */
const impactTint = $derived(lens === 'impact' && impactData !== null && !impactBreedMissing);

function parentOf(p: Pet): PairParent {
  const row = p as unknown as Record<string, unknown>;
  const values: Record<string, number> = {};
  for (const key of ATTRIBUTE_KEYS) if (typeof row[key] === 'number') values[key] = row[key] as number;
  return { breed: p.breed ?? '', values: p.attributes_measured ? values : null };
}

const outlooks = $derived.by((): AttributeOutlook[] => {
  if (!impactTint || !impactData || !grid) return [];
  return offspringAttributeOutlooks({
    loci: grid.rows.flatMap((row) => Object.values(row.cells)),
    parsed: impactData.parsed,
    magnitudes: impactData.magnitudes,
    father: parentOf(father),
    mother: parentOf(mother),
    offspringBreed: selectedBreed,
    breedScoped,
    attributes: attributeDisplayInfo.map((a) => a.key),
  });
});
const hiddenTotal = $derived(outlooks.reduce((s, o) => s + o.hiddenLoci, 0));
/** Whether either parent shares the foal's base, so the foal can be compared with it. */
const anyComparable = $derived(outlooks.some((o) => o.pBeatsBoth !== null));

/** Parent cell under the impact lens: the slot it expresses, painted as the pet lens paints it. */
function parentImpactStyle(cell: TrioLocusCell, type: GeneType | null): string | undefined {
  if (lens !== 'impact' || type === null || type === GeneType.UNKNOWN) return undefined;
  // No breed yet, or no data: neutral, like the foal row, rather than the
  // outcome lens's colours under an impact heading.
  if (!impactTint || !impactData)
    return 'background: var(--impact-neutral); border: 1px solid var(--impact-cell-edge);';
  const impact = expressedImpact(impactData.parsed[cell.geneId], cell.geneId, type, impactData.magnitudes);
  const paint = impactPaint(impact, impactMaxAbs) ?? 'var(--impact-neutral)';
  return `background: ${paint}; border: 1px solid var(--impact-cell-edge);`;
}

/**
 * Foal cell under the impact lens: what this gene can do against the parents.
 * Green for a chance to beat the better parent here, by how much; red for a
 * chance to fall below the weaker one; hatched when only unmeasured effects
 * move.
 */
function offspringImpactBackground(cell: TrioLocusCell): string {
  if (!impactData) return 'var(--impact-neutral)';
  const o = locusOutlook(cell, impactData.parsed[cell.geneId], impactData.magnitudes);
  if (o.upside > 0)
    return impactPaint({ kind: 'known', attribute: '', sign: '+', points: o.upside }, impactMaxAbs) ?? '';
  if (o.downside > 0) {
    return impactPaint({ kind: 'known', attribute: '', sign: '-', points: -o.downside }, impactMaxAbs) ?? '';
  }
  if (o.unmeasuredSign) return `var(--impact-${o.unmeasuredSign === '+' ? 'pos' : 'neg'}-unknown)`;
  return 'var(--impact-neutral)';
}

/** Tooltip lines for a foal cell under the impact lens: each attribute's outcomes against the parents. */
function offspringImpactLines(cell: TrioLocusCell): string[] {
  if (!impactData) return [];
  const o = locusOutlook(cell, impactData.parsed[cell.geneId], impactData.magnitudes);
  const lines = o.attributes.map(({ attribute, outcomes, father: kF, mother: kM }) => {
    const spread = outcomes
      .sort((a, b) => b[0] - a[0])
      .map(([points, p]) => `${formatPoints(points)} ${pct(p)}`)
      .join(' · ');
    return `${attribute}: ${spread} <span style="color: var(--text-muted)">(♂ ${formatPoints(kF)}, ♀ ${formatPoints(kM)})</span>`;
  });
  if (o.unmeasuredSign)
    lines.push(
      `<span style="color: var(--text-muted)">Unmeasured effect may move ${o.unmeasuredSign === '+' ? 'up' : 'down'}</span>`,
    );
  return lines;
}

const pct = (p: number) => (p > 0 && p < 0.005 ? '<1%' : `${Math.round(p * 100)}%`);

/**
 * The three lenses, in display order — one table rather than a mode list, a
 * label map and a help map that have to agree. `needsPool` is which of them
 * measure against the rest of the stable and so cannot be offered when the
 * trio was opened without a candidate pool.
 */
const CONTRIBUTION_LENSES: readonly {
  id: Exclude<TrioContributionMode, 'off'>;
  label: string;
  needsPool: boolean;
  help: string;
}[] = [
  {
    id: 'capability',
    label: 'Quality',
    needsPool: true,
    help: 'Tint each locus by its share of Quality — the capability the foal adds that the pool cannot already breed true.',
  },
  {
    id: 'positive',
    label: '+ genes',
    needsPool: false,
    help: 'Tint each locus by its share of + genes — the probability the foal expresses a positive here. A count, not a size.',
  },
];

/** The lenses this trio can offer: the pool-measured ones need a pool. */
const availableLenses = $derived(CONTRIBUTION_LENSES.filter((l) => !l.needsPool || summary?.poolScored));

const labelFor = (mode: Exclude<TrioContributionMode, 'off'>) =>
  CONTRIBUTION_LENSES.find((l) => l.id === mode)?.label ?? '';

/**
 * Pair-level total and per-locus peak for the active lens.
 *
 * Summed from the rendered grid rather than read off the ranked row, so the
 * total always matches the loci on screen: the trio has its own breed
 * selector, and under a different breed the ranking's figure describes a
 * locus set the player is no longer looking at.
 */
const contributionStats = $derived.by(() => {
  const stats = { total: 0, max: 0, loci: 0 };
  if (!grid || contributionMode === 'off') return stats;
  for (const row of grid.rows) {
    for (const key in row.cells) {
      const v = contributionOf(row.cells[key].contributions, contributionMode);
      if (v <= 0) continue;
      stats.total += v;
      stats.loci++;
      if (v > stats.max) stats.max = v;
    }
  }
  return stats;
});

/** The trio is projecting a different breed than the ranking scored. */
const breedDiverged = $derived(selectedBreed !== offspringBreed);

/**
 * The three scores that cannot be attributed to a locus, each with the three
 * numbers that actually produce it. Ceiling and Floor share a mean and a
 * spread and differ only in the baseline — laying them out together is the
 * clearest statement of what separates the two strategies.
 */
const improvementRows = $derived.by(() => {
  if (!scores) return [];
  return [
    {
      id: 'ceiling',
      label: 'Ceiling',
      score: scores.evPositiveImprovement,
      formula: 'E[max(0, foal positives − better parent)]',
      mean: scores.evPositiveTotal,
      sd: scores.positiveSd,
      baseline: scores.betterParentPositives,
      baselineLabel: 'better parent',
    },
    {
      id: 'floor',
      label: 'Floor',
      score: scores.evPairUpgrade,
      formula: 'E[max(0, foal positives − weaker parent)]',
      mean: scores.evPositiveTotal,
      sd: scores.positiveSd,
      baseline: scores.weakerParentPositives,
      baselineLabel: 'weaker parent',
    },
    {
      id: 'cleanup',
      label: 'Cleanup',
      score: scores.evLiabilityReduction,
      formula: 'E[max(0, cleaner parent − foal negatives)]',
      mean: scores.evNegativeTotal,
      sd: scores.negativeSd,
      baseline: scores.cleanerParentNegatives,
      baselineLabel: 'cleaner parent',
    },
  ];
});

/** The additive scores, each with the lens that breaks it down per locus. */
const additiveRows = $derived.by(() => {
  if (!scores) return [];
  const score: Record<Exclude<TrioContributionMode, 'off'>, number> = {
    capability: scores.evCapabilityGain,
    positive: scores.evPositiveTotal,
  };
  return availableLenses.map((l) => ({ id: l.id, label: l.label, score: score[l.id] }));
});

const fmt = (n: number) => n.toFixed(2);

/** The gain bucket the current mode highlights. */
function activeGain(cell: TrioLocusCell): number {
  return gainMode === 'attributes' ? cell.buckets.newPositive : cell.buckets.clarifiedPositive;
}

/** Locked = both parents the same homozygous allele → offspring can't differ. */
function isLocked(cell: TrioLocusCell): boolean {
  const f = cell.fatherType;
  return f !== null && f === cell.motherType && (f === GeneType.DOMINANT || f === GeneType.RECESSIVE);
}

const lockedCount = $derived.by(() => {
  if (!grid) return 0;
  let n = 0;
  for (const row of grid.rows) for (const key in row.cells) if (isLocked(row.cells[key])) n++;
  return n;
});

// Loci where the offspring could gain what the current mode highlights.
const gainCount = $derived.by(() => {
  if (!grid) return 0;
  let n = 0;
  for (const row of grid.rows) for (const key in row.cells) if (activeGain(row.cells[key]) > 0) n++;
  return n;
});

// Loci where the offspring risks a loss (new negative, or losing a parent's positive).
const lossCount = $derived.by(() => {
  if (!grid) return 0;
  let n = 0;
  for (const row of grid.rows) for (const key in row.cells) if (row.cells[key].buckets.loss > 0) n++;
  return n;
});

const ALLELE_LABEL: Record<string, string> = { D: 'Dominant', x: 'Mixed', R: 'Recessive', '?': 'Unknown' };

/**
 * Identity of the candidate set, not of the array holding it.
 *
 * `pool` arrives as a `$derived` filter over the pets store, so it is a fresh
 * array on every store emission — a background reload, an unrelated marker
 * toggle. Tracking the array itself would reload the trio on each of those,
 * throwing away the scroll position and the player's attribute focus for a set
 * that did not change. `BreedView` guards its own re-rank the same way.
 */
const poolKey = $derived(poolIdentity(pool));

$effect(() => {
  // Read for the dependency, not the value: the reload should follow which
  // animals are in the pool, and `load` reads the array itself untracked.
  poolKey;
  if (father?.id && mother?.id) {
    load(father, mother, selectedBreed);
  }
});

// Dynamic filter stylesheet — the zero-rerender pattern from GenomeGridDiff,
// scoped to this modal's grid so it can't leak into the diff grid.
let filterStyleEl: HTMLStyleElement | null = null;
onMount(() => {
  filterStyleEl = document.createElement('style');
  filterStyleEl.id = 'trio-grid-filters';
  document.head.appendChild(filterStyleEl);
});
onDestroy(() => {
  filterStyleEl?.remove();
  filterStyleEl = null;
});
$effect(() => {
  if (!filterStyleEl) return;
  // `*` cell selector: the trio's three rows use different cell classes
  // (`.gene-cell` parents, `.dist-bar` offspring); all carry `data-attrs`.
  // Potential-attribute match keeps both parents + the offspring lit at every
  // locus whose gene could affect the attribute, even where a parent's current
  // allele is neutral.
  filterStyleEl.textContent = attributePotentialFilterCSS(
    '.trio-grid-container',
    '*',
    selectedAttributes,
    hiddenAttributes,
  );
});

function toggleAttributeFilter(attrKey: string, ctrlKey: boolean, altKey: boolean) {
  ({ selected: selectedAttributes, hidden: hiddenAttributes } = triStateToggle(
    attrKey,
    selectedAttributes,
    hiddenAttributes,
    ctrlKey,
    altKey,
  ));
}

/**
 * Generation counter for in-flight projections.
 *
 * The load is triggered by the pair, the projected breed and the pool, so two
 * can overlap — change breed while a pool-driven reload is still running and
 * the slower request lands last. Without this the older grid would overwrite
 * the newer one, and the score panel and contribution lens would then describe
 * different projections. Same guard `BreedView` uses for its ranking.
 */
let loadSeq = 0;

async function load(f: Pet, m: Pet, breed: string) {
  const mine = ++loadSeq;
  try {
    loading = true;
    error = null;
    // A new pair or breed changes which loci exist; a focus carried over from
    // the previous set could dim the whole grid, so start unfiltered.
    selectedAttributes = [];
    hiddenAttributes = [];
    const sp = normalizeSpecies(f.species);
    const [result, efData] = await Promise.all([
      // `pool` untracked — `poolKey` above is the dependency. `breedLockWeight`
      // stays tracked: a change to it really does rescore the projection.
      computeOffspringTrio(f, m, {
        species: sp,
        offspringBreed: breed,
        pool: untrack(() => pool),
        breedLockWeight,
      }),
      getGeneEffectsCached(sp),
    ]);
    if (mine !== loadSeq) return;
    // Quality needs the candidate pool. Opened without one (or
    // with an empty one), fall back rather than tint every cell at zero — a
    // uniform grid reads as "nothing contributes", which is a different claim.
    if (!result.summary.poolScored && contributionMode !== 'off' && contributionMode !== 'positive') {
      contributionMode = 'off';
    }

    effectsDB = efData?.effects ?? {};
    const config = getAttributeConfig(sp);
    attributeDisplayInfo = config.attributes;
    const cellBuilder = createGeneCellBuilder({
      effectsDB,
      attributeNames: config.all_attribute_names.map((n) => capitalize(n)),
      appearanceLookup: buildAppearanceLookup(sp),
      speciesKey: sp,
    });

    grid = buildTrioGrid(result, cellBuilder);
    summary = result.summary;
  } catch (err: unknown) {
    if (mine !== loadSeq) return;
    error = err instanceof Error ? err.message : 'Failed to build the trio view';
    grid = null;
    summary = null;
  } finally {
    // A superseded load must not clear the spinner the newer one is still
    // showing.
    if (mine === loadSeq) loading = false;
  }
}

const BUCKET_LABEL: { key: keyof TrioLocusCell['buckets']; label: string }[] = [
  { key: 'newPositive', label: 'new positive' },
  { key: 'clarifiedPositive', label: 'clarify a positive' },
  { key: 'keepPositive', label: 'keep a positive' },
  { key: 'neutral', label: 'neutral' },
  { key: 'keepNegative', label: 'keep a negative' },
  { key: 'loss', label: 'lose / worsen' },
];

/** Hover text for the offspring outcome cell — the Punnett breakdown vs parents. */
function offspringTitle(cell: TrioLocusCell) {
  const parts = [`Gene ${cell.geneId}`];
  if (cell.attribute) parts.push(cell.attribute);
  if (contributionMode !== 'off') {
    const v = contributionOf(cell.contributions, contributionMode);
    parts.push(`${labelFor(contributionMode)}: ${v.toFixed(3)} of ${contributionStats.total.toFixed(2)}`);
  }
  if (cell.buckets.unknown >= 1) {
    parts.push('Unknown — not visible at your genetics skill');
    return parts.join('\n');
  }
  const outcomes = BUCKET_LABEL.map(({ key, label }) => {
    const pct = Math.round(cell.buckets[key] * 100);
    return pct > 0 ? `${pct}% ${label}` : null;
  }).filter(Boolean);
  parts.push(`Of the offspring: ${outcomes.join(', ')}`);
  parts.push(`♂ ${cell.fatherEffect || '—'} · ♀ ${cell.motherEffect || '—'}`);
  // Surface silent carriers: a parent can carry the allele driving the gain/loss
  // without expressing it (its effect line above reads neutral).
  if (cell.source) {
    parts.push(`Carried by ${cell.source === 'both' ? 'both parents' : `the ${cell.source}`}`);
  }
  return parts.join('\n');
}

/** One-line aggregate label for the box (the per-quarter fills carry no text). */
function offspringAria(cell: TrioLocusCell) {
  return offspringTitle(cell).replace(/\n/g, '; ');
}

function parentTitle(cell: GeneCell | null, label: string) {
  if (!cell) return '';
  return `${label} · Gene ${cell.id} (${ALLELE_LABEL[cell.type] ?? cell.type})\n${cell.effect || 'No effect'}`;
}

// --- Styled tooltip (same GeneTooltip the compare/single-pet grids use) ---
const BUCKET_TONE: Record<keyof TrioLocusCell['buckets'], string> = {
  newPositive: '#34d399',
  clarifiedPositive: '#34d399',
  keepPositive: '#6ee7b7',
  neutral: '#9ca3af',
  keepNegative: '#fca5a5',
  loss: '#f87171',
  unknown: '#9ca3af',
};

let tooltipVisible = $state(false);
let tooltipX = $state(0);
let tooltipY = $state(0);
let tooltipGeneId = $state('');
let tooltipGeneType = $state('');
let tooltipEffect = $state('');
let tooltipSubtitle = $state('');
let tooltipLabel = $state('Potential Effects');
let tooltipPotentialEffects = $state<string[]>([]);

function positionTooltip(e: MouseEvent) {
  const offset = 12;
  let x = e.clientX + offset;
  let y = e.clientY - offset - 60;
  if (x + 250 > window.innerWidth) x = e.clientX - 250 - offset;
  if (y < 0) y = e.clientY + offset;
  tooltipX = x;
  tooltipY = y;
}

/** Parent cell: current allele + the "if Dominant/Recessive" alternatives. */
function handleParentEnter(e: MouseEvent, parent: GeneCell | null) {
  if (!parent) return;
  const cellData = effectsDB[parent.id];
  const potentialEffects: string[] = [];
  const dominantEffect = effectFor(cellData, 'D');
  const recessiveEffect = effectFor(cellData, 'R');
  if (parent.type !== 'D' && !isNoEffect(dominantEffect)) {
    const color = dominantEffect.includes('+') ? '#34d399' : dominantEffect.includes('-') ? '#f87171' : '#9ca3af';
    potentialEffects.push(`If Dominant: <span style="color: ${color}">${dominantEffect}</span>`);
  }
  if (parent.type !== 'R' && !isNoEffect(recessiveEffect)) {
    const color = recessiveEffect.includes('+') ? '#34d399' : recessiveEffect.includes('-') ? '#f87171' : '#9ca3af';
    potentialEffects.push(`If Recessive: <span style="color: ${color}">${recessiveEffect}</span>`);
  }
  const breed = breedFor(cellData);
  if (breed && isHorse) {
    potentialEffects.push(`<span style="color: #9ca3af">⚬ ${breed} breed gene</span>`);
  }
  positionTooltip(e);
  tooltipGeneId = parent.id;
  tooltipGeneType = parent.type;
  tooltipEffect = parent.effect || '';
  tooltipSubtitle = '';
  tooltipLabel = 'Potential Effects';
  tooltipPotentialEffects = potentialEffects;
  tooltipVisible = true;
}

/** Offspring cell: the Punnett outcome split vs the parents. */
function handleOffspringEnter(e: MouseEvent, cell: TrioLocusCell) {
  const lines: string[] = [];
  if (impactTint) {
    positionTooltip(e);
    tooltipGeneId = cell.geneId;
    tooltipGeneType = '';
    tooltipEffect = '';
    tooltipSubtitle = '';
    tooltipLabel = 'Foal outcomes';
    const impactLines = offspringImpactLines(cell);
    tooltipPotentialEffects = impactLines.length > 0 ? impactLines : ['No measured attribute effect'];
    tooltipVisible = true;
    return;
  }
  if (contributionMode !== 'off') {
    const v = contributionOf(cell.contributions, contributionMode);
    const label = labelFor(contributionMode);
    const share = contributionStats.total > 0 ? ` (${((v / contributionStats.total) * 100).toFixed(1)}%)` : '';
    lines.push(
      `<span style="color: ${v > 0 ? '#34d399' : '#9ca3af'}">${label}: ${v.toFixed(3)} of ${contributionStats.total.toFixed(2)}${share}</span>`,
    );
  }
  if (cell.buckets.unknown >= 1) {
    lines.push('<span style="color: #9ca3af">Not visible at your genetics skill</span>');
  } else {
    for (const { key, label } of BUCKET_LABEL) {
      const pct = Math.round(cell.buckets[key] * 100);
      if (pct > 0) lines.push(`<span style="color: ${BUCKET_TONE[key]}">${pct}% ${label}</span>`);
    }
    lines.push(`<span style="color: #9ca3af">♂ ${cell.fatherEffect || '—'} · ♀ ${cell.motherEffect || '—'}</span>`);
    if (cell.source) {
      lines.push(
        `<span style="color: #9ca3af">Carried by ${cell.source === 'both' ? 'both parents' : `the ${cell.source}`}</span>`,
      );
    }
  }
  positionTooltip(e);
  tooltipGeneId = cell.geneId;
  tooltipGeneType = '';
  tooltipEffect = '';
  tooltipSubtitle = cell.attribute ?? '';
  tooltipLabel = 'Offspring outcome';
  tooltipPotentialEffects = lines;
  tooltipVisible = true;
}

function handleCellLeave() {
  tooltipVisible = false;
}
</script>

<DetailOverlay
    testid="trio-view"
    backTestid="trio-view-back"
    backLabel="← Pairs"
    ariaLabel="Offspring trio"
    onBack={onClose}
>
    {#snippet title()}
        <span class="parent-name father">♂ {father?.name}</span>
        <span class="cross">×</span>
        <span class="parent-name mother">♀ {mother?.name}</span>
        {#if speciesLabel}
            <span class="species-badge">{getSpeciesEmoji(father?.species)} {speciesLabel}</span>
        {/if}
    {/snippet}

    <!-- Stat pills ride in the header bar alongside the parent names; the filter
         row + legend sit below — two rows of chrome instead of three. -->
    {#snippet headerActions()}
        {#if grid && summary && grid.rows.length > 0}
            <div class="trio-stats">
                <span class="chip chip-gain" title="Loci where the offspring could {gainMode === 'attributes' ? 'express a positive attribute neither parent has' : 'clarify a mixed gene to homozygous (breeds true)'}.">{gainCount} {gainMode === 'attributes' ? 'gains' : 'clarifications'}</span>
                <span class="chip chip-risk" title="Loci where the offspring risks a new negative, or losing a positive a parent has.">{lossCount} losses</span>
                {#if lockedCount > 0}
                    <button
                        type="button"
                        class="chip chip-lock toggle"
                        class:active={hideLocked}
                        aria-pressed={hideLocked}
                        data-testid="trio-hide-locked"
                        title="Locked: both parents share the same allele (both dominant or both recessive), so the offspring can't differ here. Toggle to hide these and show new gains only."
                        onclick={() => { hideLocked = !hideLocked; }}
                    >
                        {lockedCount} locked{hideLocked ? ' · hidden' : ''}
                    </button>
                {/if}
                {#if summary.unknownLoci > 0}
                    <span class="chip chip-unknown">{summary.unknownLoci} unknown</span>
                {/if}
                {#if scores}
                    <button
                        type="button"
                        class="chip chip-score toggle"
                        class:active={showScores}
                        aria-pressed={showScores}
                        data-testid="trio-show-scores"
                        title="Show how this pair's Ceiling, Floor and Cleanup scores were produced."
                        onclick={() => { showScores = !showScores; }}
                    >📊 Scores</button>
                {/if}
            </div>
        {/if}
    {/snippet}

    <div class="trio-body">
    {#if hiddenParents.length > 0}
        <div class="banner banner-warn trio-hidden" role="status" data-testid="trio-hidden-warning">
            ⚠ {hiddenParents.map((p) => `${p.label} has ${p.count} hidden ${p.count === 1 ? 'gene' : 'genes'}`).join(' · ')}
            (studied at a lower Genetics level). The foal's outcome at those genes is unknown and not counted, so this
            view can miss gains and losses there.
        </div>
    {/if}
    {#if !error}
        <div class="trio-filters">
            <div class="seg lens-mode" role="group" aria-label="Trio lens">
                <button
                    type="button"
                    class="seg-btn"
                    class:active={lens === 'outcome'}
                    aria-pressed={lens === 'outcome'}
                    data-testid="trio-lens-outcome"
                    title="Show what the foal can gain or lose at each gene."
                    onclick={() => { lens = 'outcome'; }}
                >Outcome</button>
                <button
                    type="button"
                    class="seg-btn"
                    class:active={lens === 'impact'}
                    aria-pressed={lens === 'impact'}
                    data-testid="trio-lens-impact"
                    title="Estimate the foal's attribute values from the genes' measured effects."
                    onclick={() => { lens = 'impact'; }}
                >Impact</button>
            </div>
            {#if isHorse}
                <div class="breed-filter" data-testid="trio-breed-filter">
                    <BreedSelector
                        value={selectedBreed}
                        breeds={HORSE_BREEDS}
                        label="Offspring breed"
                        onChange={(v) => { selectedBreed = v; }}
                    />
                </div>
            {/if}
            {#if attributeItems.length > 0}
                <GeneFilterPills
                    label="Attribute"
                    items={attributeItems}
                    selected={selectedAttributes}
                    hidden={hiddenAttributes}
                    onToggle={toggleAttributeFilter}
                    onReset={() => { selectedAttributes = []; hiddenAttributes = []; }}
                    testid="trio-attribute-filter"
                />
            {/if}
            {#if lens === 'impact'}
                <span class="legend" data-testid="trio-impact-legend">
                    <span class="legend-item"><span class="swatch" style="background: var(--impact-neg-3)"></span>−</span>
                    <span class="legend-item"><span class="swatch" style="background: var(--impact-pos-3)"></span>+ measured points</span>
                    <span class="legend-item"><span class="swatch" style="background: var(--impact-pos-unknown)"></span>size not measured</span>
                    {#if impactResource.loading}
                        <span class="legend-item">Loading study…</span>
                    {:else if impactResource.error || impactData?.studyFailed}
                        <span class="legend-item legend-warn">The study failed — declared effects only</span>
                    {/if}
                </span>
            {:else if grid && summary && grid.rows.length > 0}
                <div class="seg gain-mode" role="group" aria-label="Highlight which gain">
                    <button
                        type="button"
                        class="seg-btn"
                        class:active={gainMode === 'attributes'}
                        aria-pressed={gainMode === 'attributes'}
                        data-testid="trio-gain-attributes"
                        title="Highlight loci where the offspring can express a positive attribute neither parent has."
                        onclick={() => { gainMode = 'attributes'; }}
                    >New attributes</button>
                    <button
                        type="button"
                        class="seg-btn"
                        class:active={gainMode === 'clarification'}
                        aria-pressed={gainMode === 'clarification'}
                        data-testid="trio-gain-clarification"
                        title="Highlight loci where the offspring can clear a mixed gene to homozygous, so it breeds true (Clarification)."
                        onclick={() => { gainMode = 'clarification'; }}
                    >Clarification</button>
                </div>
                <!-- Contribution lens. Repaints the offspring row by each locus's
                     share of one additive score, so "what triggers Quality" is a
                     question the grid can answer directly. Off by default — the
                     outcome buckets remain the view's primary reading. -->
                <div class="seg contrib-mode" role="group" aria-label="Tint by score contribution">
                    <span class="seg-caption">Contribution</span>
                    <button
                        type="button"
                        class="seg-btn"
                        class:active={contributionMode === 'off'}
                        aria-pressed={contributionMode === 'off'}
                        data-testid="trio-contrib-off"
                        title="Show the offspring outcome buckets (the default)."
                        onclick={() => { contributionMode = 'off'; }}
                    >Off</button>
                    {#each availableLenses as lens (lens.id)}
                        <button
                            type="button"
                            class="seg-btn"
                            class:active={contributionMode === lens.id}
                            aria-pressed={contributionMode === lens.id}
                            data-testid="trio-contrib-{lens.id}"
                            title={lens.help}
                            onclick={() => { contributionMode = lens.id; }}
                        >{lens.label}</button>
                    {/each}
                </div>
                <span class="legend">
                    {#if contributionMode === 'off'}
                        <span class="legend-item"><span class="swatch swatch-gain"></span>{gainMode === 'attributes' ? 'new +' : 'clarify'}</span>
                        <span class="legend-item"><span class="swatch swatch-keep"></span>keep</span>
                        <span class="legend-item"><span class="swatch swatch-neutral"></span>neutral</span>
                        <span class="legend-item"><span class="swatch swatch-loss"></span>loss</span>
                    {:else}
                        <span class="legend-item"><span class="swatch swatch-contrib-none"></span>none</span>
                        <span class="legend-item"><span class="swatch swatch-contrib-ramp"></span>more</span>
                        <span class="legend-item" data-testid="trio-contrib-total"
                            >{contributionStats.loci} loci · {contributionStats.total.toFixed(2)} {labelFor(contributionMode)}</span
                        >
                        <!-- The total is summed at the trio's own breed. Once that
                             diverges from the ranked one it stops matching the
                             column it names, and the score panel that says so is
                             closed by default — so say it here too. -->
                        {#if breedDiverged}
                            <span class="legend-item legend-warn" data-testid="trio-contrib-breed-warn"
                                >≠ ranked breed</span
                            >
                        {/if}
                    {/if}
                </span>
            {/if}
        </div>
        {#if attributeItems.length > 0}
            <div class="grid-instructions">Click attribute to focus · Ctrl+click multi · Alt+click hide</div>
        {/if}
    {/if}

    {#if loading}
        <StatusPane variant="loading" body="Building offspring projection…" />
    {:else if error}
        <StatusPane variant="error" icon="⚠️" body={error} />
    {:else if grid && summary && grid.rows.length > 0}
        <!-- Grid and score panel share one row: the grid is the wide element and
             the panel is narrow, so stacking them spent vertical space the grid
             needs while leaving the right-hand third of the row empty. -->
        <div class="trio-main">
        <div class="grid-container trio-grid-container" class:hide-locked={hideLocked}>
            <table class="trio-table">
                <thead>
                    <tr>
                        <th class="chr-header">Chr</th>
                        <th class="role-header">&nbsp;</th>
                        {#each grid.blocks as block (block)}
                            {#each grid.positionsByBlock[block] as pos (pos)}
                                <th class="pos-header {pos === 1 ? 'block-start' : ''}">{pos === 1 ? block : ''}</th>
                            {/each}
                        {/each}
                    </tr>
                </thead>
                <tbody>
                    {#each grid.rows as row (row.chromosome)}
                        <tr class="role-row father-row">
                            <td class="chr-label" rowspan="3">{row.chromosome}</td>
                            <td class="role-label">♂ Father</td>
                            {#each grid.blocks as block (block)}
                                {#each grid.positionsByBlock[block] as pos (pos)}
                                    {@const cell = row.cells[`${block}${pos}`]}
                                    <td class="grid-cell {pos === 1 ? 'block-start' : ''}">
                                        {#if cell?.fatherCell}
                                            <div
                                                class={cell.fatherCell.attributeCls}
                                                class:fixed={isLocked(cell)}
                                                data-attrs={cell.attrs}
                                                style={parentImpactStyle(cell, cell.fatherType)}
                                                role="img"
                                                aria-label={parentTitle(cell.fatherCell, 'Father')}
                                                onmouseenter={(e) => handleParentEnter(e, cell.fatherCell)}
                                                onmouseleave={handleCellLeave}
                                            >
                                                {#if cell.fatherCell.type === '?'}<span class="unknown-symbol">?</span>{/if}
                                            </div>
                                        {/if}
                                    </td>
                                {/each}
                            {/each}
                        </tr>
                        <tr class="role-row offspring-row">
                            <td class="role-label offspring-label">⚲ Offspring</td>
                            {#each grid.blocks as block (block)}
                                {#each grid.positionsByBlock[block] as pos (pos)}
                                    {@const cell = row.cells[`${block}${pos}`]}
                                    <td class="grid-cell offspring-cell {pos === 1 ? 'block-start' : ''}">
                                        {#if cell}
                                            <div
                                                class="outcome-box"
                                                class:hatch={cell.buckets.unknown >= 1}
                                                class:fixed={isLocked(cell)}
                                                data-attrs={cell.attrs}
                                                role="img"
                                                aria-label={offspringAria(cell)}
                                                onmouseenter={(e) => handleOffspringEnter(e, cell)}
                                                onmouseleave={handleCellLeave}
                                                style={cell.buckets.unknown >= 1
                                                    ? undefined
                                                    : lens === 'impact'
                                                      ? impactTint
                                                        ? `background: ${offspringImpactBackground(cell)}`
                                                        : 'background: var(--impact-neutral)'
                                                      : contributionMode !== 'off'
                                                      ? `background: ${contributionBackground(contributionOf(cell.contributions, contributionMode), contributionStats.max)}`
                                                      : `background: ${outcomeBoxBackground(cell.buckets, gainMode)}`}
                                            ></div>
                                        {/if}
                                    </td>
                                {/each}
                            {/each}
                        </tr>
                        <tr class="role-row mother-row">
                            <td class="role-label">♀ Mother</td>
                            {#each grid.blocks as block (block)}
                                {#each grid.positionsByBlock[block] as pos (pos)}
                                    {@const cell = row.cells[`${block}${pos}`]}
                                    <td class="grid-cell {pos === 1 ? 'block-start' : ''}">
                                        {#if cell?.motherCell}
                                            <div
                                                class={cell.motherCell.attributeCls}
                                                class:fixed={isLocked(cell)}
                                                data-attrs={cell.attrs}
                                                style={parentImpactStyle(cell, cell.motherType)}
                                                role="img"
                                                aria-label={parentTitle(cell.motherCell, 'Mother')}
                                                onmouseenter={(e) => handleParentEnter(e, cell.motherCell)}
                                                onmouseleave={handleCellLeave}
                                            >
                                                {#if cell.motherCell.type === '?'}<span class="unknown-symbol">?</span>{/if}
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
        {#if lens === 'impact'}
            <aside class="score-panel impact-panel" data-testid="trio-impact-panel">
                <section class="score-group">
                    <h4 class="score-head">Foal vs parents</h4>
                    {#if impactBreedMissing}
                        <p class="score-note" data-testid="trio-impact-breed-needed">
                            Pick an offspring breed. Each breed has its own genes and its own attribute base, so
                            the foal's values cannot be estimated without one.
                        </p>
                        {#if parentBreeds.length > 0}
                            <div class="breed-picks">
                                {#each parentBreeds as breed (breed)}
                                    <button
                                        type="button"
                                        class="seg-btn breed-pick"
                                        data-testid="trio-impact-pick-{breed}"
                                        onclick={() => { selectedBreed = breed; }}
                                    >{breed}</button>
                                {/each}
                            </div>
                        {/if}
                    {:else if impactResource.error}
                        <p class="score-note" data-testid="trio-impact-error">
                            Could not load gene impact, so the foal cannot be compared. Reopen the trio to retry.
                        </p>
                    {:else if !impactData}
                        <p class="score-note">Loading study…</p>
                    {:else}
                        <table class="impact-table" data-testid="trio-impact-table">
                            <thead>
                                <tr>
                                    <th>Attribute</th>
                                    <th class="num" title="Father's recorded value">♂</th>
                                    <th class="num" title="Mother's recorded value">♀</th>
                                    <th class="num" title="Chance the foal beats both parents on measured genes">↑ both</th>
                                    <th class="num" title="The value one foal in four reaches or beats (hover for the very best case)">Top 25%</th>
                                    <th class="num" title="Chance the foal falls below both parents on measured genes">↓ both</th>
                                    <th class="num" title="Unmeasured effects the foal is expected to gain beyond both parents, up / down (size unknown)">?</th>
                                </tr>
                            </thead>
                            <tbody>
                                {#each outlooks as o (o.attribute)}
                                    <tr data-attribute={o.attribute}>
                                        <td
                                            title={o.hiddenLoci > 0
                                                ? `${o.hiddenLoci} gene${o.hiddenLoci === 1 ? '' : 's'} affecting ${o.attribute} ${o.hiddenLoci === 1 ? 'is' : 'are'} hidden at your genetics skill and left out`
                                                : undefined}
                                        >{o.attribute}{#if o.hiddenLoci > 0}<span class="hidden-count"> ·{o.hiddenLoci}?</span>{/if}</td>
                                        <td class="num">{o.fatherValue ?? '—'}</td>
                                        <td class="num">{o.motherValue ?? '—'}</td>
                                        <td class="num beats" class:up={(o.pBeatsBoth ?? 0) > 0}>
                                            {o.pBeatsBoth === null ? '—' : pct(o.pBeatsBoth)}
                                        </td>
                                        <td
                                            class="num best"
                                            title={o.topGain === null
                                                ? 'Neither parent shares the foal\'s base'
                                                : `One foal in four reaches ${o.topValue ?? formatPoints(o.topGain)} or more (${formatPoints(o.topGain)} against the better parent). The very best case, ${o.bestValue ?? formatPoints(o.bestGain ?? 0)}, needs every uncertain gene to land at once: ${pct(o.pBest)} of foals.`}
                                        >
                                            {#if o.topGain === null}
                                                —
                                            {:else}
                                                <span class:up={o.topGain > 0}>{o.topValue ?? formatPoints(o.topGain)}</span>
                                            {/if}
                                        </td>
                                        <td class="num below" class:down={(o.pBelowBoth ?? 0) > 0}>
                                            {o.pBelowBoth === null ? '—' : pct(o.pBelowBoth)}
                                        </td>
                                        <td class="num unmeasured">
                                            {#if o.unmeasuredUp >= 0.05}<span class="up">↑{o.unmeasuredUp.toFixed(1)}</span>{/if}
                                            {#if o.unmeasuredDown >= 0.05}<span class="down">↓{o.unmeasuredDown.toFixed(1)}</span>{/if}
                                        </td>
                                    </tr>
                                {/each}
                            </tbody>
                        </table>
                        {#if hiddenTotal > 0}
                            <p class="score-note" data-testid="trio-impact-hidden">
                                Genes hidden at your genetics skill (·N? by an attribute) are left out: the foal's
                                outcome there is unknown, so they are not counted as no effect.
                            </p>
                        {/if}
                        <p class="score-note">
                            {#if anyComparable}
                                Chances come from the measured genes: a parent of the foal's breed shares its base,
                                so the foal beats it exactly when its measured points exceed the parent's own. Top 25%
                                is the value one foal in four reaches or beats (its gain when no value is recorded).
                                ? counts unmeasured effects expected beyond both parents, with no size.
                            {:else}
                                Neither parent is a {selectedBreed}, so neither shares the foal's base and the foal
                                cannot be compared with them.
                            {/if}
                        </p>
                    {/if}
                </section>
            </aside>
        {/if}
        {#if showScores && scores}
            <aside class="score-panel" data-testid="trio-score-panel">
                <section class="score-group">
                    <h4 class="score-head">Whole-genome</h4>
                    <p class="score-note">
                        No locus drives these — each is an expectation over the foal's whole count against a parent
                        baseline, so only these three numbers move them.
                    </p>
                    {#each improvementRows as r (r.id)}
                        <div class="score-item" data-testid="trio-score-{r.id}">
                            <div class="score-top">
                                <span class="score-label">{r.label}</span>
                                <span class="score-value">{fmt(r.score)}</span>
                            </div>
                            <div class="score-formula">{r.formula}</div>
                            <div class="score-terms">
                                mean <strong>{fmt(r.mean)}</strong> · spread <strong>{fmt(r.sd)}</strong> ·
                                {r.baselineLabel} <strong>{r.baseline}</strong>
                            </div>
                        </div>
                    {/each}
                    <!-- The one comparison the table cannot make on its own: the two
                         strategies run the identical integral and disagree only here. -->
                    <p class="score-note">
                        Ceiling and Floor differ only in the baseline ({scores.betterParentPositives} vs
                        {scores.weakerParentPositives}).
                    </p>
                </section>

                {#if additiveRows.length > 0}
                    <section class="score-group">
                        <h4 class="score-head">Per-locus</h4>
                        <p class="score-note">A plain sum over loci — highlight one to see where it came from.</p>
                        {#each additiveRows as r (r.id)}
                            <div class="score-item score-item-lens" data-testid="trio-score-{r.id}">
                                <span class="score-label">{r.label}</span>
                                <span class="score-value">{fmt(r.score)}</span>
                                <button
                                    type="button"
                                    class="score-lens"
                                    class:active={contributionMode === r.id}
                                    data-testid="trio-score-lens-{r.id}"
                                    title={CONTRIBUTION_LENSES.find((l) => l.id === r.id)?.help}
                                    onclick={() => { contributionMode = contributionMode === r.id ? 'off' : r.id; }}
                                    aria-pressed={contributionMode === r.id}
                                >{contributionMode === r.id ? 'highlighting' : 'highlight'}</button>
                            </div>
                        {/each}
                    </section>
                {/if}

                {#if breedDiverged}
                    <p class="score-warn" data-testid="trio-score-breed-warn">
                        Scored for {offspringBreed || 'no committed breed'}; the grid is projecting
                        {selectedBreed || 'no committed breed'}. These figures are the ranked ones and do not describe
                        the loci on screen.
                    </p>
                {/if}
            </aside>
        {/if}
        </div>
    {:else if selectedBreed}
        <p class="empty-text">No loci for the {selectedBreed} breed in this pair.</p>
    {:else}
        <p class="empty-text">No genome data available for this pair.</p>
    {/if}
    </div>
    <GeneTooltip
        visible={tooltipVisible}
        x={tooltipX}
        y={tooltipY}
        geneId={tooltipGeneId}
        geneType={tooltipGeneType}
        effect={tooltipEffect}
        subtitle={tooltipSubtitle}
        effectsLabel={tooltipLabel}
        potentialEffects={tooltipPotentialEffects}
    />
</DetailOverlay>

<style>
    /* Title (header bar) — parent names + species badge, moved here now that
       this component owns its DetailOverlay. */
    .parent-name { font-weight: 700; }
    .parent-name.father { color: var(--accent); }
    .parent-name.mother { color: var(--pet-b); }
    .cross { color: var(--text-muted); font-weight: 500; }
    .species-badge {
        font-size: 12px;
        font-weight: 500;
        padding: var(--space-3xs) var(--space-sm);
        background: var(--bg-tertiary);
        border-radius: 10px;
        color: var(--text-secondary);
        white-space: nowrap;
    }

    /* Stat pills that ride in the header bar (DetailOverlay's headerActions). No
       band background — the header itself is the bar. */
    .trio-stats { display: flex; align-items: center; gap: var(--space-sm); flex-wrap: wrap; }

    /* Body fills the overlay; a flex column so the grid is the single scroll
       region and the filter row stays pinned above it. */
    .trio-hidden { font-size: 12px; margin: 0 0 var(--space-xs); flex-shrink: 0; }
    .trio-body {
        flex: 1;
        min-height: 0;
        display: flex;
        flex-direction: column;
        padding: var(--space-sm) 14px;
        /* Offspring-outcome palette, derived from the shared gene colours so the
           trio stays coherent with the rest of the app. Vivid = a change vs the
           parents (gain / loss); muted (mixed toward neutral) = a hold. */
        --trio-gain: var(--gene-positive);
        --trio-keep-pos: color-mix(in srgb, var(--gene-positive) 42%, var(--gene-neutral));
        --trio-neutral: color-mix(in srgb, var(--gene-neutral) 60%, transparent);
        --trio-keep-neg: color-mix(in srgb, var(--gene-negative) 42%, var(--gene-neutral));
        --trio-loss: var(--gene-negative);
        /* Contribution lens: one hue ramped by magnitude. Deliberately not the
           gain/loss palette — a contribution has no sign, and reusing the green
           would read as "this locus is good" rather than "this locus is most of
           the score". The accent keeps the two lenses visually distinct. */
        --trio-contrib: var(--accent);
        --trio-contrib-none: color-mix(in srgb, var(--gene-neutral) 28%, transparent);
    }
    /* Compact the shared segmented control to sit in the dense filter row. */
    .gain-mode { font-size: 11px; }
    .contrib-mode { font-size: 11px; display: inline-flex; align-items: center; }
    .seg-caption {
        font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em;
        color: var(--text-tertiary); padding: 0 var(--space-xs); white-space: nowrap;
    }
    .chip-score { background: color-mix(in srgb, var(--accent) 16%, transparent); color: var(--accent-text, var(--accent)); }
    .legend-warn { color: var(--warning-text, var(--text-secondary)); font-weight: 600; }
    .swatch-contrib-none { background: var(--trio-contrib-none); }
    .swatch-contrib-ramp { background: linear-gradient(90deg, var(--trio-contrib-none), var(--trio-contrib)); width: 34px; }

    /* Grid + score panel share the row. The grid keeps the scroll region; the
       panel is a fixed narrow column so a long score list never steals width
       from the genes. */
    .trio-main { display: flex; flex: 1; min-height: 0; gap: var(--space-sm); }

    /* Score panel: the arithmetic behind the ranked columns, as a narrow
       right-hand column. It reads as an annotation on the pair, not a control,
       and scrolls on its own so the grid's scroll position is unaffected. */
    .score-panel {
        flex: 0 0 236px;
        width: 236px;
        min-height: 0;
        overflow-y: auto;
        display: flex; flex-direction: column; gap: var(--space-md);
        padding: var(--space-sm) var(--space-sm) var(--space-md);
        border: 1px solid var(--border-primary); border-radius: 6px;
        background: var(--bg-secondary); font-size: 11px;
    }
    .score-group { display: flex; flex-direction: column; gap: var(--space-2xs); }
    .impact-panel { flex-basis: 360px; width: 360px; }
    .impact-table { width: 100%; border-collapse: collapse; font-size: 11px; }
    .impact-table th, .impact-table td {
        padding: var(--space-3xs) var(--space-2xs); border-bottom: 1px solid var(--border-primary);
        text-align: left; white-space: nowrap;
    }
    .impact-table th { color: var(--text-tertiary); font-weight: 600; }
    .impact-table .num { text-align: right; font-variant-numeric: tabular-nums; }
    .impact-table .beats.up, .impact-table .best .up { color: var(--gene-positive); font-weight: 700; }
    .impact-table .best { font-weight: 600; }
    .impact-table .hidden-count { color: var(--text-tertiary); font-weight: 400; }
    .impact-table .below.down { color: var(--gene-negative); font-weight: 700; }
    .impact-table .unmeasured .up { color: var(--gene-positive); }
    .impact-table .unmeasured .down { color: var(--gene-negative); margin-left: 0.3em; }
    .breed-picks { display: flex; flex-wrap: wrap; gap: var(--space-2xs); }
    .breed-pick { border: 1px solid var(--border-secondary); }
    .score-head {
        margin: 0; font-size: 10px; font-weight: 700; text-transform: uppercase;
        letter-spacing: 0.05em; color: var(--text-tertiary);
    }
    .score-note { margin: 0; color: var(--text-tertiary); font-size: 10px; line-height: 1.4; }
    .score-item { display: flex; flex-direction: column; gap: 1px; }
    .score-top { display: flex; align-items: baseline; justify-content: space-between; gap: var(--space-xs); }
    .score-label { font-weight: 600; color: var(--text-primary); font-size: 12px; }
    .score-value { font-variant-numeric: tabular-nums; color: var(--text-primary); font-weight: 600; font-size: 12px; }
    /* The formula is the substance of the explanation, so it stays visible
       rather than retreating into a tooltip; it wraps at this width. */
    .score-formula { color: var(--text-muted); font-size: 10px; line-height: 1.35; }
    .score-terms { color: var(--text-secondary); font-size: 10px; line-height: 1.4; }
    .score-terms strong { font-variant-numeric: tabular-nums; font-weight: 700; }
    /* Per-locus rows carry no formula, so label, value and lens sit on one line. */
    .score-item-lens { flex-direction: row; align-items: baseline; gap: var(--space-2xs); }
    .score-item-lens .score-value { margin-left: auto; }
    .score-lens {
        font: inherit; font-size: 10px; padding: 1px var(--space-2xs);
        border: 1px solid var(--border-primary); border-radius: 5px;
        background: var(--bg-primary); color: var(--text-secondary); cursor: pointer; white-space: nowrap;
    }
    .score-lens:hover { border-color: var(--border-secondary); color: var(--text-primary); }
    .score-lens.active { border-color: var(--accent); color: var(--accent-text, var(--accent)); background: color-mix(in srgb, var(--accent) 14%, transparent); }
    .score-warn { margin: 0; color: var(--warning-text, var(--text-secondary)); font-size: 10px; font-weight: 600; line-height: 1.4; }
    /* Narrow windows have no width to spare: fall back to stacking, capped so
       the panel cannot push the grid off-screen the way it did full-width. */
    @media (max-width: 1000px) {
        .trio-main { flex-direction: column; }
        .score-panel { flex: 0 0 auto; width: auto; max-height: 40%; }
    }

    /* Filter row: breed + attribute pills on the left, legend pushed right. */
    .trio-filters {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--space-2xs) 14px;
        margin-bottom: var(--space-xs);
        flex-shrink: 0;
    }
    /* Attribute pills → GeneFilterPills; breed picker → shared BreedSelector. */
    .breed-filter { display: flex; padding: 0 var(--space-2xs); }

    /* Shared instruction line (identical to GenomeGridDiff's .grid-instructions). */
    .grid-instructions { font-size: 10px; color: var(--text-muted); margin-bottom: var(--space-2xs); font-style: italic; padding: 0 var(--space-2xs); }
    .chip {
        font-size: 12px;
        font-weight: 600;
        padding: var(--space-3xs) var(--space-md);
        border-radius: 10px;
        background: var(--bg-tertiary);
        color: var(--text-secondary);
    }
    .chip.toggle { cursor: pointer; border: 1px solid transparent; }
    .chip.toggle:hover { border-color: var(--border-secondary); }
    .chip.toggle.active { border-color: var(--accent); color: var(--text-primary); background: color-mix(in srgb, var(--accent) 16%, transparent); }
    .chip-gain { background: color-mix(in srgb, var(--gene-positive) 18%, transparent); color: var(--gene-positive); }
    .chip-risk { background: color-mix(in srgb, var(--gene-negative) 18%, transparent); color: var(--gene-negative); }
    .legend { display: flex; gap: var(--space-md); margin-left: auto; font-size: 11px; color: var(--text-tertiary); }
    .legend-item { display: inline-flex; align-items: center; gap: var(--space-2xs); }
    .swatch { width: 11px; height: 11px; border-radius: 2px; display: inline-block; box-shadow: inset 0 0 0 1px rgba(127, 127, 127, 0.25); }
    .swatch-gain { background: var(--trio-gain); }
    .swatch-keep { background: var(--trio-keep-pos); }
    .swatch-neutral { background: var(--trio-neutral); }
    .swatch-loss { background: var(--trio-loss); }

    .grid-container {
        flex: 1;
        min-height: 0;
        overflow: auto;
        border: 1px solid var(--border-primary);
        border-radius: 6px;
        background: var(--bg-secondary);
    }
    .trio-table { width: auto; border-collapse: collapse; table-layout: fixed; }

    thead th {
        position: sticky;
        top: 0;
        z-index: 10;
        background: var(--bg-secondary);
        border-bottom: 1px solid var(--border-primary);
        padding: var(--space-3xs) var(--space-2xs);
        font-size: 9px;
        font-weight: normal;
        color: var(--text-secondary);
        text-align: center;
        white-space: nowrap;
    }
    .chr-header { position: sticky; left: 0; z-index: 11; width: 28px; min-width: 28px; font-weight: bold; }
    .role-header { position: sticky; left: 28px; z-index: 11; width: 72px; min-width: 72px; }
    .pos-header { width: 18px; min-width: 18px; max-width: 18px; }
    .pos-header.block-start { font-weight: bold; padding-left: var(--space-sm); }

    .chr-label {
        position: sticky;
        left: 0;
        z-index: 1;
        background: var(--bg-secondary);
        font-size: 10px;
        font-weight: 700;
        color: var(--text-secondary);
        text-align: center;
        vertical-align: middle;
        border-right: 1px solid var(--border-primary);
    }
    .role-label {
        position: sticky;
        left: 28px;
        z-index: 1;
        background: var(--bg-secondary);
        font-size: 9px;
        font-weight: 600;
        padding: 1px var(--space-xs);
        white-space: nowrap;
        border-right: 1px solid var(--border-primary);
        color: var(--text-secondary);
        width: 72px;
        min-width: 72px;
    }
    .offspring-label { color: var(--accent); font-weight: 700; }
    .mother-row { border-bottom: 2px solid var(--border-primary); }

    .grid-cell { padding: 1px; text-align: center; vertical-align: middle; }
    .grid-cell.block-start { padding-left: var(--space-sm); }

    /* Offspring row is taller and its cells host the outcome box. */
    .offspring-cell { height: 22px; }
    /* One box per locus: a hard-stop vertical gradient of the outcome buckets
       (gain / keep / neutral / keep-negative / loss), quartered by the Punnett
       odds. No verdict border — the fill carries direction, magnitude and the
       gain/hold distinction on its own. */
    .outcome-box {
        width: 16px;
        height: 16px;
        margin: 0 auto;
        border-radius: 3px;
        overflow: hidden;
        box-sizing: border-box;
        box-shadow: inset 0 0 0 1px rgba(127, 127, 127, 0.22);
    }
    .outcome-box.hatch {
        background: repeating-linear-gradient(45deg, color-mix(in srgb, var(--gene-neutral) 60%, transparent) 0 2px, transparent 2px 4px);
    }

    /* Parent cells share the offspring bar's box size so the three rows line up
       column-for-column, at the same 16px density as the compare view. */
    .trio-table :global(.gene-cell) { width: 16px; height: 16px; }

    /* "New gains only": fade locked loci out of ALL three rows (both parents and
       the offspring) so the remaining gain-coloured bars are only new gains. */
    .trio-grid-container.hide-locked .fixed { opacity: 0.12; }
    .trio-grid-container.hide-locked .outcome-box.fixed { box-shadow: none; }

    .unknown-symbol { color: var(--text-muted); font-size: 1em; font-weight: 600; }
    .empty-text { color: var(--text-muted); font-size: 13px; text-align: center; padding: 40px; }
</style>
