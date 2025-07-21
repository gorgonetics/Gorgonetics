#!/usr/bin/env python3
"""
Test cattrs serialization with the new models.
"""

from pathlib import Path

from src.pgbreeder.models import Genome, Pet


def main():
    # Test loading the genome file
    genome_file = Path("data/Genes_BabyFaeBee178.txt")

    if not genome_file.exists():
        print(f"Error: Genome file {genome_file} not found")
        return

    print("Testing cattrs serialization...")

    # Create a pet from the genome file
    pet = Pet.from_genome_file(name="Test Bee", genome_file=genome_file, notes="Testing cattrs serialization")

    print(f"Pet created: {pet.name}")
    print(f"Species: {pet.species}")
    print(f"Total genes: {pet.total_genes}")

    # Test serialization to dict
    print("\nTesting to_dict()...")
    pet_dict = pet.to_dict()
    print(f"Dict keys: {list(pet_dict.keys())}")

    # Test serialization to JSON
    print("\nTesting to_json()...")
    pet_json = pet.to_json()
    print(f"JSON length: {len(pet_json)} characters")

    # Test deserialization from dict
    print("\nTesting from_dict()...")
    pet_reconstructed = Pet.from_dict(pet_dict)
    print(f"Reconstructed pet name: {pet_reconstructed.name}")
    print(f"Reconstructed species: {pet_reconstructed.species}")
    print(f"Reconstructed total genes: {pet_reconstructed.total_genes}")

    # Test deserialization from JSON
    print("\nTesting from_json()...")
    pet_from_json = Pet.from_json(pet_json)
    print(f"From JSON pet name: {pet_from_json.name}")
    print(f"From JSON species: {pet_from_json.species}")
    print(f"From JSON total genes: {pet_from_json.total_genes}")

    # Test that the data is preserved correctly
    original_gene = pet.get_gene("01A1")
    reconstructed_gene = pet_reconstructed.get_gene("01A1")
    json_gene = pet_from_json.get_gene("01A1")

    if original_gene and reconstructed_gene and json_gene:
        print("\nGene 01A1 preservation test:")
        print(f"  Original: {original_gene.gene_type.value}")
        print(f"  From dict: {reconstructed_gene.gene_type.value}")
        print(f"  From JSON: {json_gene.gene_type.value}")

        if original_gene.gene_type == reconstructed_gene.gene_type == json_gene.gene_type:
            print("  ✅ Gene data preserved correctly!")
        else:
            print("  ❌ Gene data NOT preserved correctly!")

    # Test genome serialization separately
    print("\nTesting genome serialization...")
    genome_dict = pet.genome.to_dict()
    genome_json = pet.genome.to_json()
    genome_from_dict = Genome.from_dict(genome_dict)
    genome_from_json = Genome.from_json(genome_json)

    print(f"Genome dict keys: {list(genome_dict.keys())}")
    print(f"Genome from dict entity: {genome_from_dict.entity}")
    print(f"Genome from JSON entity: {genome_from_json.entity}")

    print("\nCattrs serialization test completed successfully!")


if __name__ == "__main__":
    main()
