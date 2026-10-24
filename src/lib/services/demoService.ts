/**
 * Demo data and gene template loading for Gorgonetics.
 * Loads bundled gene templates and sample genomes on first launch.
 */

import { TEMPLATE_SPECIES } from '#lib/types/index.js';
import { normaliseEffect } from '#lib/utils/geneAnalysis.js';
import { getDb } from './database.js';
import { listBundledResources, loadBundledResource } from './fileService.js';
import { upsertGenesBulk } from './geneService.js';
import { hasPets, updatePet, uploadPet } from './petService.js';
import { getSetting, resetSetting, setSetting, TEMPLATE_BUNDLE_HASH_KEY } from './settingsService.js';

type TemplateGene = {
  gene: string;
  effectDominant?: string;
  effectRecessive?: string;
  appearance?: string;
  breed?: string;
  notes?: string;
};

type RawChromosome = {
  species: string;
  chromosome: string;
  filePath: string;
  content: string;
};

async function loadRawTemplates(): Promise<RawChromosome[]> {
  const result: RawChromosome[] = [];
  for (const species of [...TEMPLATE_SPECIES].sort()) {
    const files = (await listBundledResources(`resources/assets/${species}`)).slice().sort();
    for (const filePath of files) {
      const content = await loadBundledResource(filePath);
      const match = filePath.match(/chr(\d+)/);
      const chromosome = match ? `chr${match[1]}` : '';
      result.push({ species, chromosome, filePath, content });
    }
  }
  return result;
}

async function bundleHash(raw: RawChromosome[]): Promise<string> {
  const parts = raw.map((c) => `${c.filePath}\n${c.content}`).join('\n---\n');
  const buf = new TextEncoder().encode(parts);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

type ExistingGeneRow = {
  gene: string;
  notes: string | null;
  effectDominant: string | null;
  effectRecessive: string | null;
  template_dominant: string | null;
  template_recessive: string | null;
};

/** Per `species/gene`: the dominant and recessive values releases up to v0.10.3 shipped. */
type ShippedHistory = Record<string, [string[], string[]] | undefined>;

/**
 * The effect to store after a refresh: the new template value, unless the
 * current value is the user's edit. A row is untouched when its effect
 * equals the template it came from; for rows from before v21, which did not
 * record it, when it equals any value a release shipped.
 */
function keepOrTake(
  current: string | null,
  template: string | null,
  next: string,
  shipped: string[] | undefined,
): string {
  // No value at all is not an edit: take the template.
  if (current == null) return next;
  const value = normaliseEffect(current);
  const untouched =
    template != null
      ? value === normaliseEffect(template)
      : value === normaliseEffect(next) || (shipped ?? []).includes(value);
  return untouched ? next : current;
}

/**
 * Sync the genes table with the bundled JSON templates whenever the
 * bundle's content hash differs from what was last applied.
 *
 * On first launch the genes table is empty and every row is inserted.
 * On app upgrades that ship corrected templates, existing rows are
 * refreshed in place. `notes` and any effect the user edited are kept;
 * each row records the template effects it was refreshed against, so the
 * next refresh can tell an edit from an untouched row.
 */
export async function refreshGeneTemplatesIfChanged(): Promise<void> {
  let raw: RawChromosome[];
  try {
    raw = await loadRawTemplates();
  } catch (e) {
    console.warn('Failed to read bundled gene templates:', e);
    return;
  }

  // Defend against an empty bundle (resource dir missing, glob mismatch,
  // partial install). Persisting the empty-bundle hash here would lock
  // future launches into the no-op branch forever; better to leave the
  // sentinel unchanged and retry next launch.
  if (raw.length === 0) {
    console.warn('Bundled gene templates are missing — skipping refresh.');
    return;
  }

  // Hash the raw bundle and gate on it before parsing JSON — steady-state
  // launches do nothing more than read the files and run one digest.
  const currentHash = await bundleHash(raw);
  const storedHash = await getSetting<string | undefined>(TEMPLATE_BUNDLE_HASH_KEY);
  if (storedHash === currentHash) return;

  console.log(
    storedHash
      ? 'Bundled gene templates changed — refreshing catalog...'
      : 'Seeding gene catalog from bundled templates...',
  );

  // Parse every template file before touching the DB. A failure here
  // aborts the refresh without any partial upserts, so a malformed asset
  // can never leave the catalog half-updated. The hash sentinel stays
  // unchanged so a fixed bundle in a later release retries cleanly.
  const parsed: { species: string; chromosome: string; genes: TemplateGene[] }[] = [];
  for (const { species, chromosome, filePath, content } of raw) {
    try {
      parsed.push({ species, chromosome, genes: JSON.parse(content) as TemplateGene[] });
    } catch (e) {
      console.warn(`Aborting gene template refresh: failed to parse ${filePath}:`, e);
      return;
    }
  }

  const db = getDb();
  // Pre-fetch existing rows per species: INSERT OR REPLACE deletes the prior
  // row, so notes and the user's effect edits must be passed through.
  const rowsBySpecies = new Map<string, Map<string, ExistingGeneRow>>();
  for (const species of new Set(parsed.map((c) => c.species))) {
    const rows = await db.select<ExistingGeneRow[]>(
      `SELECT gene, notes, effectDominant, effectRecessive, template_dominant, template_recessive
       FROM genes WHERE animal_type = $animal_type`,
      { animal_type: species },
    );
    rowsBySpecies.set(species, new Map(rows.map((r) => [r.gene, r])));
  }

  // Rows from before schema v21 have no recorded template; decide those
  // from the values releases shipped. Loaded only when a gene still in the
  // bundle needs it: a row of a gene the bundle dropped never gets a
  // template, and must not force the load on every later refresh.
  const needsHistory = parsed.some(({ species, genes }) => {
    const rows = rowsBySpecies.get(species);
    return genes.some((g) => {
      const r = rows?.get(g.gene);
      return r !== undefined && (r.template_dominant == null || r.template_recessive == null);
    });
  });
  const history: ShippedHistory = needsHistory
    ? ((await import('#lib/data/gene-template-history.json')).default as unknown as ShippedHistory)
    : {};

  let kept = 0;
  for (const { species, chromosome, genes } of parsed) {
    const existing = rowsBySpecies.get(species) ?? new Map<string, ExistingGeneRow>();
    await upsertGenesBulk(
      species,
      chromosome,
      genes.map((gene) => {
        const row = existing.get(gene.gene);
        const shipped = history[`${species}/${gene.gene}`];
        const nextDominant = normaliseEffect(gene.effectDominant);
        const nextRecessive = normaliseEffect(gene.effectRecessive);
        const effectDominant = row
          ? keepOrTake(row.effectDominant, row.template_dominant, nextDominant, shipped?.[0])
          : nextDominant;
        const effectRecessive = row
          ? keepOrTake(row.effectRecessive, row.template_recessive, nextRecessive, shipped?.[1])
          : nextRecessive;
        if (effectDominant !== nextDominant || effectRecessive !== nextRecessive) kept++;
        return {
          gene: gene.gene,
          effectDominant,
          effectRecessive,
          appearance: gene.appearance,
          breed: gene.breed,
          notes: row?.notes ?? gene.notes ?? '',
          templateDominant: nextDominant,
          templateRecessive: nextRecessive,
        };
      }),
    );
  }
  if (kept > 0) console.log(`Kept user-edited effects on ${kept} gene(s).`);

  // pets.positive_genes is computed from gene effects and persisted on
  // the pets table. The backfill that populates it is guard-gated by a
  // one-shot flag, so without clearing the flag a refresh that changes
  // effects would leave every pet's positive-gene count stale forever. The
  // backfill task is already queued in AuthWrapper's startup tail —
  // clearing the flag here lets it re-fire on the same launch.
  await resetSetting('pets.positive_genes_backfilled');

  await setSetting(TEMPLATE_BUNDLE_HASH_KEY, currentHash);
}

/**
 * Load demo pets from bundled sample genome files if the pets table is empty.
 *
 * Two horses (one of each gender) plus one beewasp give the Breeding
 * Assistant tab at least one same-species M × F pair to rank from the
 * first launch.
 */
export async function loadDemoPetsIfNeeded(): Promise<void> {
  if (await hasPets()) return;

  console.log('Loading demo pets...');

  const demoFiles = [
    { path: 'resources/data/Genes_SampleFaeBee.txt', name: 'Sample Fae Bee', gender: 'Female', breed: '' },
    { path: 'resources/data/Genes_SampleHorse.txt', name: 'Sample Horse', gender: 'Male', breed: 'Standardbred' },
    { path: 'resources/data/Genes_Roach.txt', name: 'Roach', gender: 'Female', breed: 'Standardbred' },
  ];

  for (const { path, name, gender, breed } of demoFiles) {
    try {
      const content = await loadBundledResource(path);
      const result = await uploadPet(content, {
        name,
        gender,
        notes: 'Sample pet for exploring Gorgonetics features',
      });
      if (result.status === 'success') {
        if (breed && result.pet_id != null) {
          await updatePet(result.pet_id, { breed });
        } else if (breed) {
          console.warn(`Demo pet "${name}" uploaded without a pet_id; breed not set`);
        }
        console.log(`Loaded demo pet: ${name} (ID: ${result.pet_id})`);
      } else {
        console.warn(`Failed to load demo pet ${name}: ${result.message}`);
      }
    } catch (e) {
      console.warn(`Failed to load demo pet from ${path}:`, e);
    }
  }
}
