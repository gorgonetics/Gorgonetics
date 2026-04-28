/**
 * Demo data and gene template loading for Gorgonetics.
 * Loads bundled gene templates and sample genomes on first launch.
 */

import { listBundledResources, loadBundledResource } from './fileService.js';
import { hasGenes, upsertGene } from './geneService.js';
import { hasPets, updatePet, uploadPet } from './petService.js';

/**
 * Populate the genes table from bundled JSON template files if empty.
 */
export async function populateGenesIfNeeded(): Promise<void> {
  if (await hasGenes()) return;

  console.log('Populating genes from bundled templates...');

  const species = ['beewasp', 'horse'];
  for (const sp of species) {
    try {
      const files = await listBundledResources(`resources/assets/${sp}`);
      for (const filePath of files) {
        const content = await loadBundledResource(filePath);
        const genes = JSON.parse(content) as {
          gene: string;
          effectDominant?: string;
          effectRecessive?: string;
          appearance?: string;
          breed?: string;
          notes?: string;
        }[];

        // Extract chromosome from filename (e.g., "beewasp_genes_chr01.json" -> "chr01")
        const match = filePath.match(/chr(\d+)/);
        const chromosome = match ? `chr${match[1]}` : '';

        for (const gene of genes) {
          await upsertGene(sp, chromosome, gene.gene, {
            effectDominant: gene.effectDominant,
            effectRecessive: gene.effectRecessive,
            appearance: gene.appearance,
            breed: gene.breed,
            notes: gene.notes,
          });
        }
      }
      console.log(`Loaded genes for ${sp}`);
    } catch (e) {
      console.warn(`Failed to load genes for ${sp}:`, e);
    }
  }
}

/**
 * Load demo pets from bundled sample genome files if the pets table is empty.
 */
export async function loadDemoPetsIfNeeded(): Promise<void> {
  if (await hasPets()) return;

  console.log('Loading demo pets...');

  const demoFiles = [
    { path: 'resources/data/Genes_SampleFaeBee.txt', name: 'Sample Fae Bee', gender: 'Female', breed: '' },
    { path: 'resources/data/Genes_SampleHorse.txt', name: 'Sample Horse', gender: 'Male', breed: 'Standardbred' },
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
