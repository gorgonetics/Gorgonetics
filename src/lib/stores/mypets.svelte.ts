/**
 * Reactive state for My Pets (the table-first home): the filters, roster sort,
 * and multi-selection. Module-scoped so it survives tab switches.
 * See docs/design/redesign-library-workspace-v1.md (§9, IA v2).
 */

import { getSetting, setSetting } from '$lib/services/settingsService.js';
import type { Gender } from '$lib/types/index.js';
import type { GeneCriterion } from '$lib/utils/geneCriteria.js';
import type { PetListFilters } from '$lib/utils/petFilter.js';

export const myPetsView = $state({
  search: '',
  /** Normalized species; '' = all. */
  species: '' as string,
  /** Breed name; '' = all. */
  breed: '' as string,
  /** Exact gender; '' = all. */
  gender: '' as Gender | '',
  starredOnly: false,
  stabledOnly: false,
  petQualityOnly: false,
  tags: [] as string[],
  /** Gene criteria, ANDed (docs/design/gene-value-filter-v1.md). */
  geneCriteria: [] as GeneCriterion[],
  /** Species the gene criteria belong to; '' while none are active (§5c). */
  geneSpecies: '' as string,
  /** Whether the collapsible Genes section is expanded. */
  genesOpen: false,
  /** Roster (table) sort — column id + direction. */
  sortCol: 'name' as string,
  sortDir: 'asc' as 'asc' | 'desc',
  /** Multi-select for bulk actions (Compare / Share). */
  selectedIds: new Set<number>() as Set<number>,
  /** Cross-destination request to open a pet's detail in My Pets (e.g. clicking
   *  a parent in the Breed pair table). MyPets consumes and clears it. */
  openPetId: null as number | null,
});

/**
 * The active filter criteria as a plain `PetListFilters`. MyPets filters once
 * with these (`visiblePets`) and shares the result with the Roster via a prop,
 * so table rows and the bulk-action selection can never disagree (#405).
 * Call inside a reactive context ($derived) so the field reads are tracked.
 */
export function getMyPetsFilters(): PetListFilters {
  return {
    query: myPetsView.search,
    tags: myPetsView.tags,
    starredOnly: myPetsView.starredOnly,
    stabledOnly: myPetsView.stabledOnly,
    petQualityOnly: myPetsView.petQualityOnly,
    species: myPetsView.species,
    breed: myPetsView.breed,
    gender: myPetsView.gender,
    geneFilter:
      myPetsView.geneCriteria.length > 0
        ? { species: myPetsView.geneSpecies, criteria: myPetsView.geneCriteria }
        : undefined,
  };
}

/**
 * Add a gene criterion for `species`. The first criterion adopts the
 * species and **forces the roster's species filter** to it — the
 * alternative (silently excluding every other species) produces a roster
 * that quietly became single-species with no visible reason (§5c).
 * Reassigns the array so `$state` tracks the change.
 */
export function addGeneCriterion(criterion: GeneCriterion, species: string): void {
  if (myPetsView.geneCriteria.length === 0) myPetsView.geneSpecies = species;
  else if (species !== myPetsView.geneSpecies) return; // criteria never mix species (§5c)
  myPetsView.geneCriteria = [...myPetsView.geneCriteria, criterion];
  myPetsView.species = myPetsView.geneSpecies;
  myPetsView.genesOpen = true;
  persistActiveGeneFilter();
}

/** Replace a criterion in place (edit of want / threshold / allow set). */
export function replaceGeneCriterion(index: number, criterion: GeneCriterion): void {
  myPetsView.geneCriteria = myPetsView.geneCriteria.map((c, i) => (i === index ? criterion : c));
  persistActiveGeneFilter();
}

export function removeGeneCriterion(index: number): void {
  myPetsView.geneCriteria = myPetsView.geneCriteria.filter((_, i) => i !== index);
  if (myPetsView.geneCriteria.length === 0) myPetsView.geneSpecies = '';
  persistActiveGeneFilter();
}

export function clearGeneCriteria(): void {
  myPetsView.geneCriteria = [];
  myPetsView.geneSpecies = '';
  persistActiveGeneFilter();
}

// --- Gene filter persistence (design §6) -------------------------------------
// A filter is a hand-tuned artefact — a chromosome campaign plus map-picked
// loci and thresholds — that a breeder reuses across days. The active filter
// is written through on every mutation and restored at startup; named saves
// let a player park one campaign and load another.

const ACTIVE_FILTER_KEY = 'geneFilter.active';
const SAVED_FILTERS_KEY = 'geneFilter.saved';

export interface SavedGeneFilter {
  name: string;
  species: string;
  criteria: GeneCriterion[];
}

const KNOWN_STATES = new Set(['D', 'R', 'x']);
const validAllow = (a: unknown): boolean =>
  Array.isArray(a) && a.length > 0 && a.every((s) => KNOWN_STATES.has(s as string));

/** Defensive shape check for criteria read back from settings — a corrupt or
 *  legacy payload must degrade to "no filter", never to a crash or a lie. */
function isValidCriterion(c: unknown): c is GeneCriterion {
  if (!c || typeof c !== 'object') return false;
  const cr = c as Record<string, unknown>;
  if (cr.kind === 'locus') return typeof cr.geneId === 'string' && validAllow(cr.allow);
  if (cr.kind === 'group') {
    const source = cr.source as Record<string, unknown> | undefined;
    return (
      typeof cr.label === 'string' &&
      typeof cr.min === 'number' &&
      !!source &&
      (source.type === 'attribute' || source.type === 'chromosome') &&
      Array.isArray(cr.loci) &&
      cr.loci.every(
        (l) =>
          l &&
          typeof (l as Record<string, unknown>).geneId === 'string' &&
          validAllow((l as Record<string, unknown>).allow),
      )
    );
  }
  return false;
}

/**
 * Fire-and-forget write-through; a failed write costs persistence, not the
 * session. Writes are **chained**: `setSetting` is a DELETE + INSERT, so two
 * concurrent writes (e.g. rapid slider edits) can interleave and leave the
 * stale row first — last call must win.
 */
let persistChain: Promise<unknown> = Promise.resolve();
function persistActiveGeneFilter(): void {
  const value =
    myPetsView.geneCriteria.length > 0 ? { species: myPetsView.geneSpecies, criteria: myPetsView.geneCriteria } : null;
  persistChain = persistChain
    .then(() => setSetting(ACTIVE_FILTER_KEY, value))
    .catch((err) => console.warn('gene filter: persist failed', err));
}

/**
 * Restore the active gene filter at startup (called from AuthWrapper after
 * the DB is ready). No-ops if the user already built criteria this session,
 * or if the stored payload fails the shape check. Restoring re-forces the
 * species filter (§5c), same as building the criteria by hand would.
 */
export async function restoreGeneFilter(): Promise<void> {
  try {
    if (myPetsView.geneCriteria.length > 0) return;
    const stored = await getSetting<{ species: string; criteria: unknown[] } | null>(ACTIVE_FILTER_KEY);
    if (!stored || typeof stored.species !== 'string' || !Array.isArray(stored.criteria)) return;
    const criteria = stored.criteria.filter(isValidCriterion);
    if (criteria.length === 0) return;
    myPetsView.geneCriteria = criteria;
    myPetsView.geneSpecies = stored.species;
    myPetsView.species = stored.species;
  } catch (err) {
    console.warn('gene filter: restore failed', err);
  }
}

/** Saved filters, shape-checked; corrupt entries are dropped, not crashed on. */
export async function listSavedGeneFilters(): Promise<SavedGeneFilter[]> {
  const raw = await getSetting<unknown>(SAVED_FILTERS_KEY);
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (f): f is SavedGeneFilter =>
      !!f &&
      typeof (f as SavedGeneFilter).name === 'string' &&
      typeof (f as SavedGeneFilter).species === 'string' &&
      Array.isArray((f as SavedGeneFilter).criteria) &&
      (f as SavedGeneFilter).criteria.every(isValidCriterion),
  );
}

/** Save the current active filter under `name`, replacing an existing save of the same name. */
export async function saveGeneFilterAs(name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed || myPetsView.geneCriteria.length === 0) return;
  const entry: SavedGeneFilter = {
    name: trimmed,
    species: myPetsView.geneSpecies,
    criteria: myPetsView.geneCriteria,
  };
  const existing = await listSavedGeneFilters();
  await setSetting(SAVED_FILTERS_KEY, [...existing.filter((f) => f.name !== trimmed), entry]);
}

/** Load a saved filter as the active one (replaces it, campaign switch). */
export async function applySavedGeneFilter(name: string): Promise<boolean> {
  const saved = (await listSavedGeneFilters()).find((f) => f.name === name);
  if (!saved || saved.criteria.length === 0) return false;
  myPetsView.geneCriteria = saved.criteria;
  myPetsView.geneSpecies = saved.species;
  myPetsView.species = saved.species;
  myPetsView.genesOpen = true;
  persistActiveGeneFilter();
  return true;
}

export async function deleteSavedGeneFilter(name: string): Promise<void> {
  const existing = await listSavedGeneFilters();
  await setSetting(
    SAVED_FILTERS_KEY,
    existing.filter((f) => f.name !== name),
  );
}

/** Replace the selection set (reassign so $state tracks the change). */
export function setMyPetsSelection(ids: Set<number>): void {
  myPetsView.selectedIds = ids;
}

export function toggleMyPetsSelection(id: number): void {
  const next = new Set(myPetsView.selectedIds);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  myPetsView.selectedIds = next;
}

export function clearMyPetsSelection(): void {
  myPetsView.selectedIds = new Set();
}

/** Ask My Pets to open a pet's detail (used from other destinations). */
export function requestOpenPet(id: number): void {
  myPetsView.openPetId = id;
}
