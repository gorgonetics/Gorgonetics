import { beforeEach, describe, expect, it, vi } from 'vitest';
import { closeDatabase, initDatabase } from '$lib/services/database.js';
import { runMigrations } from '$lib/services/migrationService.js';
import { getSetting, setSetting } from '$lib/services/settingsService.js';
import {
  addGeneCriterion,
  applySavedGeneFilter,
  clearGeneCriteria,
  deleteSavedGeneFilter,
  listSavedGeneFilters,
  myPetsView,
  removeGeneCriterion,
  restoreGeneFilter,
  saveGeneFilterAs,
} from '$lib/stores/mypets.svelte.js';
import { GeneType } from '$lib/types/index.js';
import type { GeneCriterion, GroupCriterion } from '$lib/utils/geneCriteria.js';

const locus: GeneCriterion = { kind: 'locus', geneId: '01A1', allow: [GeneType.RECESSIVE, GeneType.MIXED] };
const group: GroupCriterion = {
  kind: 'group',
  label: 'Chr 01',
  source: { type: 'chromosome', chromosome: '01' },
  want: 'pure',
  loci: [{ geneId: '01A1', allow: [GeneType.RECESSIVE] }],
  min: 1,
};

/** Blank the in-memory view WITHOUT the mutators, so no write-through fires. */
function wipeViewState(): void {
  myPetsView.geneCriteria = [];
  myPetsView.geneSpecies = '';
  myPetsView.species = '';
}

/** The write-through is fire-and-forget; poll until the expected criteria count lands. */
async function waitForPersisted(criteriaCount: number): Promise<void> {
  await vi.waitFor(async () => {
    const value = (await getSetting('geneFilter.active')) as { criteria?: unknown[] } | null | undefined;
    expect(value?.criteria).toHaveLength(criteriaCount);
  });
}

beforeEach(async () => {
  await closeDatabase();
  await initDatabase();
  await runMigrations();
  wipeViewState();
});

describe('active gene filter persistence (design §6)', () => {
  it('round-trips across a simulated restart', async () => {
    addGeneCriterion(group, 'horse');
    addGeneCriterion(locus, 'horse');
    await waitForPersisted(2);

    wipeViewState(); // "restart": state gone, settings row remains
    await restoreGeneFilter();

    expect(myPetsView.geneCriteria).toHaveLength(2);
    expect(myPetsView.geneSpecies).toBe('horse');
    // Restoring re-forces the species filter (§5c).
    expect(myPetsView.species).toBe('horse');
  });

  it('clearing the criteria clears the persisted filter too', async () => {
    addGeneCriterion(locus, 'horse');
    await waitForPersisted(1);
    clearGeneCriteria();
    await vi.waitFor(async () => {
      expect(await getSetting('geneFilter.active')).toBeNull();
    });
    await restoreGeneFilter();
    expect(myPetsView.geneCriteria).toHaveLength(0);
  });

  it('threshold edits persist — the tuned filter is the artefact worth keeping', async () => {
    addGeneCriterion(group, 'horse');
    removeGeneCriterion(0);
    addGeneCriterion({ ...group, min: 1 }, 'horse');
    await vi.waitFor(async () => {
      const stored = (await getSetting('geneFilter.active')) as { criteria: GroupCriterion[] };
      expect(stored?.criteria?.[0]?.min).toBe(1);
    });
  });

  it('does not clobber criteria the user already built this session', async () => {
    await setSetting('geneFilter.active', { species: 'horse', criteria: [locus] });
    addGeneCriterion(group, 'beewasp');
    await restoreGeneFilter();
    expect(myPetsView.geneCriteria).toHaveLength(1);
    expect(myPetsView.geneSpecies).toBe('beewasp');
  });

  it('a corrupt or legacy payload degrades to no filter, not a crash', async () => {
    await setSetting('geneFilter.active', { species: 'horse', criteria: [{ kind: 'bogus' }, 42, null] });
    await restoreGeneFilter();
    expect(myPetsView.geneCriteria).toHaveLength(0);
    expect(myPetsView.geneSpecies).toBe('');

    await setSetting('geneFilter.active', 'not even an object');
    await restoreGeneFilter();
    expect(myPetsView.geneCriteria).toHaveLength(0);
  });
});

describe('named saved filters (design §6)', () => {
  it('save / list / apply / delete cycle', async () => {
    addGeneCriterion(group, 'horse');
    await saveGeneFilterAs('Line A');

    clearGeneCriteria();
    expect(myPetsView.geneCriteria).toHaveLength(0);

    expect((await listSavedGeneFilters()).map((f) => f.name)).toEqual(['Line A']);
    expect(await applySavedGeneFilter('Line A')).toBe(true);
    expect(myPetsView.geneCriteria).toHaveLength(1);
    expect(myPetsView.species).toBe('horse');

    await deleteSavedGeneFilter('Line A');
    expect(await listSavedGeneFilters()).toHaveLength(0);
    expect(await applySavedGeneFilter('Line A')).toBe(false);
  });

  it('saving under an existing name replaces it, not duplicates it', async () => {
    addGeneCriterion(group, 'horse');
    await saveGeneFilterAs('Line A');
    addGeneCriterion(locus, 'horse');
    await saveGeneFilterAs('Line A');
    const saved = await listSavedGeneFilters();
    expect(saved).toHaveLength(1);
    expect(saved[0].criteria).toHaveLength(2);
  });

  it('applying a saved filter also becomes the persisted active filter', async () => {
    addGeneCriterion(group, 'horse');
    await saveGeneFilterAs('Line A');
    clearGeneCriteria();
    await applySavedGeneFilter('Line A');
    await waitForPersisted(1); // the write-through is chained, not awaited by apply
    wipeViewState();
    await restoreGeneFilter();
    expect(myPetsView.geneCriteria).toHaveLength(1);
  });

  it('blank names and empty filters are not saveable; corrupt saved entries are dropped', async () => {
    await saveGeneFilterAs('   ');
    clearGeneCriteria();
    await saveGeneFilterAs('Empty');
    expect(await listSavedGeneFilters()).toHaveLength(0);

    await setSetting('geneFilter.saved', [{ name: 'Bad', species: 'horse', criteria: [{ kind: 'nope' }] }, 'junk']);
    expect(await listSavedGeneFilters()).toHaveLength(0);
  });

  it('concurrent saves are serialised — neither entry is lost to a read-modify-write race', async () => {
    addGeneCriterion(group, 'horse');
    // Fire both without awaiting: unserialised, both would read the same base
    // list and the second write would silently drop the first's entry.
    const a = saveGeneFilterAs('Line A');
    const b = saveGeneFilterAs('Line B');
    await Promise.all([a, b]);
    expect((await listSavedGeneFilters()).map((f) => f.name).sort()).toEqual(['Line A', 'Line B']);
  });
});

describe('restore rejects payloads that would misbehave (§6)', () => {
  it('an empty species does not restore — it would exclude every pet (§5c)', async () => {
    await setSetting('geneFilter.active', { species: '', criteria: [locus] });
    await restoreGeneFilter();
    expect(myPetsView.geneCriteria).toHaveLength(0);
  });

  it('a group without a valid want or source is dropped — it would re-expand as something else', async () => {
    const noWant = { ...group, want: undefined };
    const badSource = { ...group, source: { type: 'chromosome' } };
    await setSetting('geneFilter.active', { species: 'horse', criteria: [noWant, badSource] });
    await restoreGeneFilter();
    expect(myPetsView.geneCriteria).toHaveLength(0);
  });
});
