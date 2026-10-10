<script lang="ts">
/**
 * Roster — the My Pets table. A sortable matrix of the filtered pets with
 * Name / Species / Gender / Breed / attributes / Total / +Genes / Quality /
 * Imported, laid out like the Community table (#557): attribute columns are
 * species-aware, filled only where the attribute applies to that row's
 * species, so every column is useful without choosing a species first.
 * Receives the already-filtered pets from MyPets (one filterPets pass shared
 * by table and selection); sort + multi-select live in `myPetsView`.
 * Clicking a name opens that pet; checkboxes build a multi-selection for the
 * lenses.
 * See docs/design/redesign-library-workspace-v1.md (§2.1).
 */
import PetActions from '$lib/components/shared/PetActions.svelte';
import { normalizeSpecies } from '$lib/services/configService.js';
import { scoreStable } from '$lib/services/geneticQualityService.js';
import { myPetsView, setMyPetsSelection, toggleMyPetsSelection } from '$lib/stores/mypets.svelte.js';
import { pets as allPets } from '$lib/stores/pets.js';
import { settings } from '$lib/stores/settings.js';
import type { Pet } from '$lib/types/index.js';
import { ATTRIBUTE_COLUMNS, attributeApplies } from '$lib/utils/attributeColumns.js';
import { type GeneticQualityResult, parseBreedLockWeight } from '$lib/utils/geneticQuality.js';
import { keyedResource } from '$lib/utils/keyedResource.svelte.js';
import { qualityRows, rowText } from '$lib/utils/qualityLens.js';
import { type SortableColumn, sortByColumn } from '$lib/utils/sortColumn.js';
import { formatShortDate } from '$lib/utils/timestamp.js';

interface Props {
  /** The already-filtered pets to list. MyPets computes the visible set once
   *  (filterPets + getMyPetsFilters) and shares it with the roster (#405). */
  pets: Pet[];
  /** Open a pet's detail (clicking its name), optionally in a given view —
   *  the Quality column opens the Quality lens. Distinct from the row
   *  checkbox, which builds the multi-selection for bulk actions. */
  onOpen?: (pet: Pet, view?: string) => void;
}

const { pets: filtered, onOpen }: Props = $props();

interface Column {
  id: string;
  label: string;
  numeric: boolean;
  /** Null where the column does not apply to the pet; rendered as a dash, as
   *  is an empty text value (a species without breeds). */
  accessor: (pet: Pet) => string | number | null;
}

/** An attribute's value, or null when it is not one of the pet's species'. */
function attrValue(pet: Pet, key: string): number | null {
  if (!attributeApplies(pet.species, key)) return null;
  const v = (pet as unknown as Record<string, unknown>)[key];
  return typeof v === 'number' ? v : null;
}

/**
 * Genetic quality is measured against the **stabled population of one
 * species**, never against the filtered view. Capability is defined
 * relative to the animals you can breed from, so scoring the filtered set
 * would make a search box silently change every score — a pet would look
 * irreplaceable simply because you filtered its rivals out of sight.
 *
 * One species at a time, because the gene set differs per species. With no
 * species chosen each species is scored against its own stable, and a pet's
 * share is of its own species' total — shares are comparable within a
 * species, not across (#557).
 */
const scoredSpecies = $derived(
  myPetsView.species
    ? [normalizeSpecies(myPetsView.species)]
    : [...new Set($allPets.filter((p) => p.stabled).map((p) => normalizeSpecies(p.species)))].sort(),
);
const poolOf = (species: string) => $allPets.filter((p) => p.stabled && normalizeSpecies(p.species) === species);
/**
 * The breed the score values at full weight, and what a benefit locked to
 * any other breed is worth against a breed-generic one.
 *
 * A weight, never a filter: 677 of the horse gene set's 879 benefit slots
 * belong to one of ten breeds, so leaving them unweighted lets material a
 * single-breed breeder will never use decide three-quarters of the column —
 * but zeroing them would call the sole carrier of another breed's positive
 * expendable, which is the mistake design doc §5 is about.
 */
const focusBreed = $derived(String($settings['quality.focusBreed'] ?? ''));
const breedLockWeight = $derived(parseBreedLockWeight($settings['quality.breedLockWeight']));
// Keyed on the population's identity and the weighting, so an unrelated
// `$pets` re-emit with the same members does not re-score but a settings
// change does.
const qualityKey = $derived(
  scoredSpecies.length > 0
    ? `${focusBreed}|${breedLockWeight ?? 'auto'}|${scoredSpecies
        .map(
          (sp) =>
            `${sp}:${poolOf(sp)
              .map((p) => p.id)
              .join(',')}`,
        )
        .join(';')}`
    : null,
);
/**
 * Every species' scores merged into one lookup. Species' pet ids never
 * overlap, and `meaningful` is true when any species clears the population
 * floor — a species that does not is scored but reads as unmeasured.
 */
const quality = keyedResource(
  () => qualityKey,
  async () => {
    const merged = {
      scores: new Map<number, GeneticQualityResult>(),
      shares: new Map<number, number>(),
      unscored: [] as number[],
      meaningful: false,
      speciesOf: new Map<number, string>(),
      /** Species scored but with too few stabled animals to compare. */
      belowFloor: new Set<string>(),
    };
    for (const species of scoredSpecies) {
      const pool = poolOf(species);
      const result = await scoreStable({ species, pets: pool, focusBreed, breedLockWeight });
      merged.unscored.push(...result.unscored);
      if (!result.meaningful) {
        merged.belowFloor.add(species);
        continue;
      }
      merged.meaningful = true;
      for (const [id, r] of result.scores) merged.scores.set(id, r);
      for (const [id, share] of result.shares) merged.shares.set(id, share);
      for (const p of pool) merged.speciesOf.set(p.id, species);
    }
    return merged;
  },
);
const qualityShare = (pet: Pet) => quality.value?.shares.get(pet.id) ?? 0;
// Set, not the array: the tooltip asks per row, and the roster renders every
// filtered pet.
const unscoredIds = $derived(new Set(quality.value?.unscored ?? []));
/**
 * Suppressed below the population floor, where every allele reads as sole.
 *
 * Sticky across a refetch: `keyedResource` clears `value` the moment the key
 * changes, so gating on it alone made the column vanish on every star toggle
 * or stable change. A disappearing column trips the stale-sort guard below,
 * which silently rewrote the sort to Name — so sorting by Quality and then
 * un-stabling one pet reset the sort.
 */
let qualityEverMeaningful = $state(false);
$effect(() => {
  if (quality.value) qualityEverMeaningful = quality.value.meaningful;
});
const showQuality = $derived(scoredSpecies.length > 0 && (quality.value?.meaningful ?? qualityEverMeaningful));

/**
 * Whether this pet was in the scored population at all. An un-stabled pet
 * shows in the filtered roster but is not scored, and rendering it as `—`
 * would borrow the vocabulary that means "redundant" — a very different
 * claim from "not measured".
 */
const wasScored = (pet: Pet) => quality.value?.scores.has(pet.id) ?? false;

/** Genes named in the Quality tooltip; the Quality lens lists the rest. */
const QUALITY_TITLE_GENES = 5;

/** Tooltip: what the percentage is a share of, and why it is what it is. */
function qualityTitle(pet: Pet): string {
  const r = quality.value?.scores.get(pet.id);
  if (!r) {
    if (unscoredIds.has(pet.id)) return 'Not scored — no usable genome data for this pet. Re-import its genome file.';
    const species = normalizeSpecies(pet.species);
    if (pet.stabled && quality.value?.belowFloor.has(species)) {
      return `Not scored — too few stabled ${species} pets to compare against each other.`;
    }
    return 'Not scored — only stabled pets are, since capability is what you can breed from.';
  }
  if (r.atRiskCapability === 0) {
    return 'Nothing here is irreplaceable — every beneficial allele it carries is available from another stabled pet.';
  }
  const parts = [
    `${r.atRiskCapability.toFixed(1)} slot-units the stable would lose without it (1 = only carrier, breeding it true; 0.5 = only carrier, or only true breeder where others carry it)`,
  ];
  if (r.genericCapability > 0) {
    parts.push(`${r.genericCapability.toFixed(1)} of that is breed-generic — a base for any breed you target`);
  }
  if (r.breedCapability > 0) {
    parts.push(`${r.breedCapability.toFixed(1)} is breed-locked, weighted down for the breeds you are not breeding`);
  }
  if (r.soleSourceSlots > 0) {
    const generic = r.genericSoleSourceSlots > 0 ? ` (${r.genericSoleSourceSlots} breed-generic)` : '';
    parts.push(`sole source of ${r.soleSourceSlots}${generic}`);
  }
  if (r.soleLockSlots > 0) parts.push(`only one able to breed ${r.soleLockSlots} true`);
  const species = quality.value?.speciesOf.get(pet.id);
  parts.push(`shown as a share of the ${species ? `${species} ` : ''}stable's total irreplaceable capability`);
  const rows = qualityRows(r.contributions);
  const top = rows.slice(0, QUALITY_TITLE_GENES).map(rowText);
  if (rows.length > QUALITY_TITLE_GENES) top.push(`${rows.length - QUALITY_TITLE_GENES} more`);
  return `${parts.join(' · ')}\n\nGenes: ${top.join('; ')}\n\nClick to see them on the genome.`;
}

/**
 * Mark an animal whose irreplaceable material is mostly breed-generic.
 *
 * The distinction the percentage cannot carry on its own: two animals at
 * the same share are not the same buy if one of them keeps its value
 * whatever breed you switch to. Half is the threshold because it is the
 * point at which the generic part outweighs everything else combined —
 * anything finer would need a legend nobody reads.
 */
const genericLed = (pet: Pet): boolean => {
  const r = quality.value?.scores.get(pet.id);
  return !!r && r.atRiskCapability > 0 && r.genericCapability > r.atRiskCapability / 2;
};

/**
 * Attribute columns that some pet in scope uses. Scope is the species filter
 * alone, not every filter, so columns stay put while the player types in the
 * search box — the Community table's rule — but a horse-only view drops the
 * bees' Ferocity.
 */
const inScope = $derived(
  myPetsView.species
    ? $allPets.filter((p) => normalizeSpecies(p.species) === normalizeSpecies(myPetsView.species))
    : $allPets,
);
const attrCols = $derived(ATTRIBUTE_COLUMNS.filter((col) => inScope.some((p) => attrValue(p, col.key) !== null)));

// Precompute one attribute total per visible pet so sorting by Total doesn't
// re-sum every attribute on each O(n log n) comparison.
const totals = $derived.by(() => {
  const m = new Map<number, number>();
  for (const p of filtered) {
    let sum = 0;
    for (const col of ATTRIBUTE_COLUMNS) sum += attrValue(p, col.key) ?? 0;
    m.set(p.id, sum);
  }
  return m;
});

const importedAt = (pet: Pet): number => {
  const t = Date.parse(pet.created_at ?? '');
  return Number.isNaN(t) ? 0 : t;
};

const columns = $derived.by((): Column[] => [
  { id: 'name', label: 'Name', numeric: false, accessor: (p) => p.name ?? '' },
  { id: 'species', label: 'Species', numeric: false, accessor: (p) => p.species ?? '' },
  { id: 'gender', label: 'Gender', numeric: false, accessor: (p) => p.gender ?? '' },
  { id: 'breed', label: 'Breed', numeric: false, accessor: (p) => p.breed ?? '' },
  ...attrCols.map(
    (col): Column => ({ id: col.key, label: col.label, numeric: true, accessor: (p) => attrValue(p, col.key) }),
  ),
  ...(attrCols.length > 0
    ? [{ id: 'attr_total', label: 'Total', numeric: true, accessor: (p: Pet) => totals.get(p.id) ?? 0 }]
    : []),
  { id: 'positive_genes', label: '+ Genes', numeric: true, accessor: (p) => p.positive_genes ?? 0 },
  ...(showQuality
    ? [{ id: 'genetic_quality', label: 'Quality', numeric: true, accessor: (p: Pet) => qualityShare(p) }]
    : []),
  { id: 'created_at', label: 'Imported', numeric: true, accessor: importedAt },
]);

const sorted = $derived.by(() => {
  const col = columns.find((c) => c.id === myPetsView.sortCol) ?? columns[0];
  // Reuse the shared, tested comparator (numeric subtract vs localeCompare).
  // A dash sorts below every value, as in the Community table.
  const sortable: SortableColumn<Pet> = col.numeric
    ? { numeric: true, accessor: (p) => Number(col.accessor(p) ?? -1) }
    : { numeric: false, accessor: (p) => String(col.accessor(p) ?? '') };
  return sortByColumn(filtered, sortable, myPetsView.sortDir);
});

// If the sorted column disappears (species change drops an attribute), fall
// back to name so the table doesn't silently sort by a stale, missing column.
$effect(() => {
  const ids = new Set(columns.map((c) => c.id));
  if (!ids.has(myPetsView.sortCol)) {
    myPetsView.sortCol = 'name';
    myPetsView.sortDir = 'asc';
  }
});

const selectedInView = $derived(sorted.reduce((n, p) => n + (myPetsView.selectedIds.has(p.id) ? 1 : 0), 0));
const allSelected = $derived(sorted.length > 0 && selectedInView === sorted.length);
const someSelected = $derived(selectedInView > 0 && !allSelected);

function toggleSort(colId: string): void {
  if (myPetsView.sortCol === colId) {
    myPetsView.sortDir = myPetsView.sortDir === 'asc' ? 'desc' : 'asc';
  } else {
    myPetsView.sortCol = colId;
    // Text reads most naturally A→Z; numbers and dates largest or newest first.
    myPetsView.sortDir = columns.find((c) => c.id === colId)?.numeric ? 'desc' : 'asc';
  }
}

function sortIndicator(colId: string): string {
  if (colId !== myPetsView.sortCol) return '';
  return myPetsView.sortDir === 'asc' ? ' ▲' : ' ▼';
}

function toggleSelectAll(): void {
  const next = new Set(myPetsView.selectedIds);
  if (allSelected) for (const p of sorted) next.delete(p.id);
  else for (const p of sorted) next.add(p.id);
  setMyPetsSelection(next);
}

// Open a single pet's detail. The row checkbox is separate (multi-select for
// bulk actions); clicking the name opens the full-view detail.
function open(pet: Pet, view?: string): void {
  onOpen?.(pet, view);
}
</script>

<div class="roster" data-testid="roster">
  <table class="roster-table">
    <thead>
      <tr>
        <th class="sel-col">
          <input
            type="checkbox"
            data-testid="roster-select-all"
            checked={allSelected}
            indeterminate={someSelected}
            onchange={toggleSelectAll}
            aria-label="Select all {sorted.length} pets"
          />
        </th>
        {#each columns as col (col.id)}
          <th class:numeric={col.numeric} class:active-sort={myPetsView.sortCol === col.id}>
            <button type="button" class="sort-btn" onclick={() => toggleSort(col.id)}>
              {col.label}{sortIndicator(col.id)}
            </button>
          </th>
        {/each}
        <th class="act-col" aria-label="Actions"></th>
      </tr>
    </thead>
    <tbody>
      {#if sorted.length === 0}
        <tr><td class="empty" colspan={columns.length + 2}>No pets match these filters.</td></tr>
      {:else}
        {#each sorted as pet (pet.id)}
          <tr class:row-selected={myPetsView.selectedIds.has(pet.id)} data-pet-id={pet.id}>
            <td class="sel-col">
              <input
                type="checkbox"
                data-testid="roster-row-select"
                checked={myPetsView.selectedIds.has(pet.id)}
                onchange={() => toggleMyPetsSelection(pet.id)}
                aria-label="Select {pet.name ?? 'pet'}"
              />
            </td>
            {#each columns as col (col.id)}
              {@const value = col.accessor(pet)}
              <td
                class:numeric={col.numeric}
                class:cell-text={!col.numeric && col.id !== 'name'}
                class:cell-total={col.id === 'attr_total'}
                class:cell-date={col.id === 'created_at'}
                class:muted={value === null || value === ''}
              >
                {#if col.id === 'name'}
                  <button type="button" class="name-btn" data-testid="roster-open" onclick={() => open(pet)}>
                    {value || '(unnamed)'}
                  </button>
                {:else if col.id === 'genetic_quality'}
                  {#if wasScored(pet) && qualityShare(pet) > 0}
                    <button
                      type="button"
                      class="quality explore"
                      data-testid="roster-quality"
                      title={qualityTitle(pet)}
                      onclick={() => open(pet, 'quality')}
                    >
                      {#if qualityShare(pet) < 0.05}
                        —
                      {:else}
                        {qualityShare(pet).toFixed(1)}%{#if genericLed(pet)}<span
                            class="generic-mark"
                            data-testid="quality-generic"
                            aria-label="mostly breed-generic">◆</span
                          >{/if}
                      {/if}
                    </button>
                  {:else}
                    <span
                      class="quality"
                      class:redundant={wasScored(pet)}
                      class:unscored={!wasScored(pet)}
                      data-testid="roster-quality"
                      title={qualityTitle(pet)}
                    >
                      {wasScored(pet) ? '—' : '·'}
                    </span>
                  {/if}
                {:else if col.id === 'created_at'}
                  {value ? formatShortDate(new Date(value)) : '—'}
                {:else}
                  {value === '' ? '—' : (value ?? '—')}
                {/if}
              </td>
            {/each}
            <td class="act-col">
              <PetActions {pet} variant="icon" />
            </td>
          </tr>
        {/each}
      {/if}
    </tbody>
  </table>
</div>

<style>
  .roster { width: 100%; }
  .roster-table { width: 100%; border-collapse: collapse; font-size: 12px; }
  .roster-table th,
  .roster-table td { padding: var(--space-xs) var(--space-md); text-align: left; border-bottom: 1px solid var(--border-primary); white-space: nowrap; }
  .roster-table th.numeric,
  .roster-table td.numeric { text-align: right; }
  .roster-table thead th { position: sticky; top: 0; background: var(--bg-tertiary); color: var(--text-secondary); font-size: 11px; font-weight: 600; z-index: 1; }
  /* Cell treatment shared with the Community table (#557). */
  .roster-table td { color: var(--text-primary); vertical-align: middle; }
  .roster-table td.numeric { font-variant-numeric: tabular-nums; }
  .roster-table td.cell-text { color: var(--text-secondary); }
  .roster-table td.cell-total { font-weight: 600; }
  .roster-table td.cell-date,
  .roster-table td.muted { color: var(--text-tertiary); }
  .roster-table th.active-sort { color: var(--accent-text, var(--accent)); }
  .sel-col { width: 1%; text-align: center; }
  .act-col { width: 1%; white-space: nowrap; text-align: right; }
  .act-col :global(.action-btn) { display: inline-grid; }
  .sort-btn { background: none; border: none; padding: 0; font: inherit; color: inherit; cursor: pointer; }
  .sort-btn:hover { color: var(--accent-text, var(--accent)); }
  .name-btn { background: none; border: none; padding: 0; font: inherit; font-weight: 600; color: var(--accent-text, var(--accent)); cursor: pointer; }
  .name-btn:hover { text-decoration: underline; }
  .roster-table tbody tr:hover { background: var(--bg-secondary); }
  .roster-table tbody tr.row-selected { background: var(--bg-selected); }
  .empty { text-align: center; color: var(--text-muted); font-style: italic; padding: var(--space-3xl); }
  /* Quality reads as a share of the stable's irreplaceable genetics. A zero is
     the useful signal for culling, so it is muted rather than shouted — the
     column is scanned for what is safe to release, not for a winner. */
  .quality { font-variant-numeric: tabular-nums; cursor: help; }
  /* Opens the Quality lens: looks like the number it is, not a button. */
  .quality.explore { background: none; border: none; padding: 0; font: inherit; color: inherit; cursor: pointer; }
  .quality.explore:hover { text-decoration: underline; }
  .quality.redundant { color: var(--text-muted); cursor: default; }
  /* Not measured, not redundant — a distinct mark so an un-stabled pet is
     never mistaken for one whose alleles are all covered elsewhere. */
  .quality.unscored { color: var(--border-primary); }
  /* The one thing the percentage cannot say: this animal's value survives a
     change of target breed. Accented rather than coloured by severity — it is
     a property of the animal, not a warning. */
  .generic-mark { margin-left: var(--space-3xs); font-size: 9px; vertical-align: 2px; color: var(--accent-text, var(--accent)); }
</style>
