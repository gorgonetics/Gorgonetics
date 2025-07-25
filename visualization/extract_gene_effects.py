#!/usr/bin/env python3
"""
Extract gene effects from the database and generate JavaScript data for the visualization.
This script reads all gene effects from the PGBreeder database and outputs them as JSON.
"""

import json
import sys
from pathlib import Path

# Add the parent directory to the path to import pgbreeder modules
sys.path.append(str(Path(__file__).parent.parent / "src"))

from pgbreeder.database import GeneDatabase


def extract_all_gene_effects():
    """Extract all gene effects from the database."""
    db = GeneDatabase()

    try:
        # Get all available species
        species_list = db.get_animal_types()
        print(f"Found species: {species_list}")

        all_effects = {}

        for species in species_list:
            print(f"\nProcessing {species}...")
            species_effects = {}

            # Get all chromosomes for this species
            chromosomes = db.get_chromosomes(species)
            print(f"  Chromosomes: {len(chromosomes)}")

            effects_count = 0
            for chromosome in chromosomes:
                genes = db.get_genes_by_chromosome(species, chromosome)

                for gene_data in genes:
                    gene_id = gene_data["gene"]

                    # Store the gene effect data
                    species_effects[gene_id] = {
                        "effectDominant": gene_data.get("effectDominant"),
                        "effectRecessive": gene_data.get("effectRecessive"),
                        "appearance": gene_data.get("appearance", ""),
                        "notes": gene_data.get("notes", ""),
                    }

                    # Count non-None effects
                    if gene_data.get("effectDominant") not in [None, "None"] or gene_data.get(
                        "effectRecessive"
                    ) not in [None, "None"]:
                        effects_count += 1

            all_effects[species] = species_effects
            print(f"  Total genes: {len(species_effects)}")
            print(f"  Genes with effects: {effects_count}")

        return all_effects

    except Exception as e:
        print(f"Error extracting gene effects: {e}")
        return {}
    finally:
        db.close()


def generate_javascript_data(effects_data):
    """Generate JavaScript code with the gene effects data."""
    js_code = (
        """// Gene effects data extracted from PGBreeder database
// Generated automatically - do not edit manually

const GENE_EFFECTS_DB = """
        + json.dumps(effects_data, indent=2)
        + """;

// Helper function to get gene effect
function getGeneEffect(species, geneId, geneType) {
    // Normalize species name
    let speciesKey = species.toLowerCase();
    if (speciesKey === "horse") {
        speciesKey = "horse";
    } else if (speciesKey === "beewasp" || speciesKey === "bee" || speciesKey === "wasp") {
        speciesKey = "beewasp";
    } else {
        // Default fallback
        speciesKey = "horse";
    }

    const geneData = GENE_EFFECTS_DB[speciesKey] && GENE_EFFECTS_DB[speciesKey][geneId];

    if (!geneData) {
        return "No gene data found";
    }

    // For mixed genes (x), treat as dominant
    if (geneType === "D" || geneType === "x") {
        const effect = geneData.effectDominant;
        if (!effect || effect === "None" || effect === null || effect === "null") {
            return "No dominant effect";
        }
        return effect;
    } else if (geneType === "R") {
        const effect = geneData.effectRecessive;
        if (!effect || effect === "None" || effect === null || effect === "null") {
            return "No recessive effect";
        }
        return effect;
    } else {
        return "Unknown gene type";
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { GENE_EFFECTS_DB, getGeneEffect };
}
"""
    )
    return js_code


def main():
    """Main function to extract data and generate files."""
    print("Extracting gene effects from PGBreeder database...")

    # Extract all gene effects
    effects_data = extract_all_gene_effects()

    if not effects_data:
        print("No gene effects data extracted!")
        return

    # Generate JavaScript file
    js_code = generate_javascript_data(effects_data)

    # Write JavaScript file
    js_file_path = Path(__file__).parent / "gene_effects_data.js"
    with open(js_file_path, "w") as f:
        f.write(js_code)

    print(f"\nGenerated JavaScript data file: {js_file_path}")

    # Also write JSON file for reference
    json_file_path = Path(__file__).parent / "gene_effects_data.json"
    with open(json_file_path, "w") as f:
        json.dump(effects_data, f, indent=2)

    print(f"Generated JSON data file: {json_file_path}")

    # Print summary
    print("\nSummary:")
    for species, genes in effects_data.items():
        effects_count = sum(
            1
            for gene_data in genes.values()
            if (
                gene_data.get("effectDominant") not in [None, "None"]
                or gene_data.get("effectRecessive") not in [None, "None"]
            )
        )
        print(f"  {species}: {len(genes)} genes, {effects_count} with effects")


if __name__ == "__main__":
    main()
