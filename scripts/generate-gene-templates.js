/**
 * Build-time script to generate static HTML templates for gene visualization
 * This eliminates DOM creation overhead by pre-building table structures
 */

import fs from 'fs/promises';
import path from 'path';

const ASSETS_DIR = './assets';
const OUTPUT_DIR = './public/assets/gene-templates';

async function analyzeSpeciesStructure(species) {
    console.log(`🔍 Analyzing ${species} gene structure...`);
    
    const speciesDir = path.join(ASSETS_DIR, species);
    const files = await fs.readdir(speciesDir);
    const chromosomeFiles = files.filter(f => f.endsWith('.json'));
    
    console.log(`📊 Found ${chromosomeFiles.length} chromosomes for ${species}`);
    
    const allBlocks = new Set();
    const chromosomeStructures = new Map(); // Per-chromosome block counts
    const chromosomes = [];
    
    // Analyze each chromosome individually
    for (const file of chromosomeFiles) {
        const filePath = path.join(speciesDir, file);
        const content = await fs.readFile(filePath, 'utf-8');
        const genes = JSON.parse(content);
        
        const chrNumber = file.match(/chr(\d+)/)?.[1];
        if (!chrNumber) continue;
        
        chromosomes.push(chrNumber);
        
        // Count genes per block for this specific chromosome
        const blockCounts = new Map();
        genes.forEach(gene => {
            const block = gene.gene.match(/^\d+/)?.[0]; // Extract block number
            if (block) {
                allBlocks.add(block);
                const count = blockCounts.get(block) || 0;
                blockCounts.set(block, count + 1);
            }
        });
        
        // Store this chromosome's specific structure
        chromosomeStructures.set(chrNumber, blockCounts);
    }
    
    const sortedBlocks = Array.from(allBlocks).sort((a, b) => parseInt(a) - parseInt(b));
    const sortedChromosomes = chromosomes.sort((a, b) => parseInt(a) - parseInt(b));
    
    // Calculate actual total cells (sum of each chromosome's actual genes)
    let totalCells = 0;
    chromosomeStructures.forEach(blockCounts => {
        totalCells += Array.from(blockCounts.values()).reduce((a, b) => a + b, 0);
    });
    
    console.log(`✅ ${species} structure: ${sortedChromosomes.length} chromosomes, ${sortedBlocks.length} blocks, ${totalCells} actual cells`);
    
    return {
        species,
        chromosomes: sortedChromosomes,
        blocks: sortedBlocks,
        chromosomeStructures, // Per-chromosome detailed structure
        totalCells
    };
}

function generateHTMLTemplate(structure) {
    console.log(`🏗️ Generating HTML template for ${structure.species} (${structure.totalCells} cells)`);
    
    const { species, chromosomes, blocks, chromosomeStructures } = structure;
    
    let html = `<!-- Generated template for ${species} -->
<table class="gene-grid-table" data-species="${species}">
    <thead class="gene-headers">
        <tr>
            <th class="chromosome-header">Chr</th>`;
            
    // Generate header cells - use global max per block for consistency
    const globalBlockMaxGenes = new Map();
    chromosomeStructures.forEach(blockCounts => {
        blockCounts.forEach((count, block) => {
            const currentMax = globalBlockMaxGenes.get(block) || 0;
            globalBlockMaxGenes.set(block, Math.max(currentMax, count));
        });
    });
            
    blocks.forEach(block => {
        const maxGenes = globalBlockMaxGenes.get(block);
        for (let i = 0; i < maxGenes; i++) {
            html += `
            <th class="position-header ${i === 0 ? 'block-label block-start' : ''}" data-block="${block}">
                ${i === 0 ? block : ''}
            </th>`;
        }
    });
    
    html += `
        </tr>
    </thead>
    <tbody class="gene-rows">`;
    
    // Generate chromosome rows using actual per-chromosome structure
    chromosomes.forEach(chromosome => {
        html += `
        <tr class="chromosome-row" data-chromosome="${chromosome}">
            <td class="chromosome-label" data-chromosome="${chromosome}">
                ${chromosome}
            </td>`;
            
        const chromosomeBlockCounts = chromosomeStructures.get(chromosome) || new Map();
            
        blocks.forEach(block => {
            const actualGenesInThisChromosome = chromosomeBlockCounts.get(block) || 0;
            
            // Only generate cells that actually exist for this chromosome
            for (let i = 0; i < actualGenesInThisChromosome; i++) {
                html += `
            <td class="gene-cell-container ${i === 0 ? 'block-start' : ''}" 
                data-chromosome="${chromosome}" 
                data-block="${block}" 
                data-position="${i}">
                <!-- Gene content will be populated dynamically -->
            </td>`;
            }
        });
        
        html += `
        </tr>`;
    });
    
    html += `
    </tbody>
</table>`;
    
    return html;
}

async function generateSpeciesTemplate(species) {
    try {
        const structure = await analyzeSpeciesStructure(species);
        const template = generateHTMLTemplate(structure);
        
        // Create output directory
        await fs.mkdir(OUTPUT_DIR, { recursive: true });
        
        // Write template file
        const filename = `${species}_${structure.chromosomes.length}_${structure.blocks.length}.html`;
        const outputPath = path.join(OUTPUT_DIR, filename);
        await fs.writeFile(outputPath, template, 'utf-8');
        
        // Write metadata - convert Maps to objects for JSON serialization
        const metadataPath = path.join(OUTPUT_DIR, `${species}_metadata.json`);
        const metadataForJson = {
            ...structure,
            chromosomeStructures: Object.fromEntries(
                Array.from(structure.chromosomeStructures.entries()).map(([chr, blockMap]) => [
                    chr,
                    Object.fromEntries(blockMap.entries())
                ])
            )
        };
        await fs.writeFile(metadataPath, JSON.stringify(metadataForJson, null, 2), 'utf-8');
        
        console.log(`✅ Generated template: ${outputPath} (${structure.totalCells} cells)`);
        
        return { filename, structure };
    } catch (error) {
        console.error(`❌ Error generating template for ${species}:`, error);
        return null;
    }
}

async function main() {
    console.log('🚀 Generating static gene visualization templates...');
    
    const species = ['horse', 'beewasp'];
    const results = [];
    
    for (const speciesName of species) {
        const result = await generateSpeciesTemplate(speciesName);
        if (result) {
            results.push(result);
        }
    }
    
    // Generate index file
    const index = {
        generated: new Date().toISOString(),
        templates: results.map(r => ({
            species: r.structure.species,
            filename: r.filename,
            chromosomes: r.structure.chromosomes.length,
            blocks: r.structure.blocks.length,
            totalCells: r.structure.totalCells
        }))
    };
    
    await fs.writeFile(
        path.join(OUTPUT_DIR, 'index.json'), 
        JSON.stringify(index, null, 2), 
        'utf-8'
    );
    
    console.log('✅ Template generation complete!');
    console.log(`📁 Output: ${OUTPUT_DIR}/`);
    results.forEach(r => {
        console.log(`   ${r.structure.species}: ${r.structure.totalCells} pre-built cells`);
    });
}

main().catch(console.error);