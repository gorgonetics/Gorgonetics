/**
 * Demo data and gene template loading for Gorgonetics.
 * Loads bundled gene templates and sample genomes on first launch.
 */

import { getDb } from './database.js';
import { listBundledResources, loadBundledResource } from './fileService.js';
import { clearGeneEffectsCache, upsertGene } from './geneService.js';
import { hasPets, updatePet, uploadPet } from './petService.js';
import { getSetting, resetSetting, setSetting } from './settingsService.js';

const TEMPLATE_SPECIES = ['beewasp', 'horse'] as const;
const TEMPLATE_BUNDLE_HASH_KEY = 'genes.templateBundleHash';

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

/**
 * Sync the genes table with the bundled JSON templates whenever the
 * bundle's content hash differs from what was last applied.
 *
 * On first launch the genes table is empty and every row is inserted.
 * On app upgrades that ship corrected templates, existing rows are
 * refreshed in place — `notes` is preserved on conflict so any
 * user-authored gene notes survive the refresh.
 */
export async function refreshGeneTemplatesIfChanged(): Promise<void> {
  let raw: RawChromosome[];
  try {
    raw = await loadRawTemplates();
  } catch (e) {
    console.warn('Failed to read bundled gene templates:', e);
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

  const db = getDb();
  const speciesTouched = new Set<string>();
  // Pre-fetch existing notes per species so we can pass them through to
  // upsertGene — INSERT OR REPLACE deletes the prior row, so without this
  // any user-authored notes would be lost on refresh.
  const notesBySpecies = new Map<string, Map<string, string>>();
  for (const species of new Set(raw.map((c) => c.species))) {
    const rows = await db.select<{ gene: string; notes: string }[]>(
      'SELECT gene, notes FROM genes WHERE animal_type = $animal_type',
      { animal_type: species },
    );
    notesBySpecies.set(species, new Map(rows.map((r) => [r.gene, r.notes ?? ''])));
  }

  for (const { species, chromosome, content } of raw) {
    const genes = JSON.parse(content) as TemplateGene[];
    const existingNotes = notesBySpecies.get(species) ?? new Map<string, string>();
    for (const gene of genes) {
      await upsertGene(species, chromosome, gene.gene, {
        effectDominant: gene.effectDominant,
        effectRecessive: gene.effectRecessive,
        appearance: gene.appearance,
        breed: gene.breed,
        notes: existingNotes.get(gene.gene) ?? gene.notes ?? '',
      });
    }
    speciesTouched.add(species);
  }
  for (const sp of speciesTouched) clearGeneEffectsCache(sp);

  // pets.positive_genes is computed from gene effects and persisted on
  // the pets table. The backfill that populates it is guard-gated by a
  // one-shot flag, so without clearing the flag a refresh that changes
  // effects would leave every pet's "Total +" count stale forever. The
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
        if (breed) {
          await updatePet(result.pet_id, { breed });
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
