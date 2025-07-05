#!/usr/bin/env python3
"""
Gene Template Generator for Project Gorgon Pet Breeding

This script generates JSON template files for each chromosome based on genome data.
It reads a genome file and creates individual JSON files for each chromosome with
placeholder gene information.
"""

import json
import os
from pathlib import Path


def parse_genome_file(file_path: str) -> tuple[str, dict[str, str]]:
    """
    Parse a genome file and extract genome type and chromosome data.

    Args:
        file_path: Path to the genome file

    Returns:
        Tuple of (genome_type, chromosome_data_dict)
    """
    genome_type = ""
    chromosomes = {}

    with open(file_path, encoding="utf-8") as f:
        lines = f.readlines()

    # Find genome type
    for line in lines:
        if line.startswith("Genome="):
            genome_type = line.split("=")[1].strip()
            break

    # Find genes section and parse chromosomes
    in_genes_section = False
    for line in lines:
        line = line.strip()

        if line == "[Genes]":
            in_genes_section = True
            continue

        if in_genes_section and "=" in line:
            # Parse chromosome line like "01=       RDRD RDRR RDRD ..."
            chr_num, gene_data = line.split("=", 1)
            chr_num = chr_num.strip()
            gene_data = gene_data.strip()
            chromosomes[chr_num] = gene_data

    return genome_type.lower(), chromosomes


def count_blocks_in_chromosome(gene_data: str) -> int:
    """
    Count the number of gene blocks in a chromosome.
    Each block is a 4-character sequence separated by spaces.
    Handles R, D, ?, and x characters as valid gene data.

    Args:
        gene_data: String containing gene data like "RDRD RDRR ?D?? x?xR"

    Returns:
        Number of blocks
    """
    # Split by spaces and filter out empty strings
    blocks = [block for block in gene_data.split() if block and len(block) >= 2]
    return len(blocks)


def generate_block_letters(num_blocks: int) -> list[str]:
    """
    Generate block letters (A, B, C, ..., Z, AA, AB, ...).

    Args:
        num_blocks: Number of blocks needed

    Returns:
        List of block letter strings
    """
    letters = []

    # First 26 blocks use single letters A-Z
    for i in range(min(num_blocks, 26)):
        letters.append(chr(ord("A") + i))

    # If more than 26 blocks, use double letters AA, AB, AC, etc.
    remaining = num_blocks - 26
    if remaining > 0:
        for i in range(remaining):
            first_letter = chr(ord("A") + (i // 26))
            second_letter = chr(ord("A") + (i % 26))
            letters.append(first_letter + second_letter)

    return letters


def generate_chromosome_template(chr_num: str, gene_data: str) -> list[dict[str, str]]:
    """
    Generate a JSON template for a single chromosome.

    Args:
        chr_num: Chromosome number (e.g., "01", "02")
        gene_data: Gene data string

    Returns:
        List of gene dictionaries
    """
    num_blocks = count_blocks_in_chromosome(gene_data)
    block_letters = generate_block_letters(num_blocks)

    genes = []

    for block_letter in block_letters:
        for gene_pos in range(1, 5):  # 4 genes per block (1, 2, 3, 4)
            gene_id = f"{chr_num}{block_letter}{gene_pos}"
            gene_entry = {
                "gene": gene_id,
                "effect": "|String for me to fill in|",
                "appearance": "|String for me to fill in|",
                "trigger": "|String for me to fill in|",
                "notes": "|String for me to fill in|",
            }
            genes.append(gene_entry)

    return genes


def create_template_files(genome_file: str, output_dir: str) -> None:
    """
    Create all chromosome template files for a genome.

    Args:
        genome_file: Path to the genome file
        output_dir: Directory to create template files in
    """
    # Parse the genome file
    genome_type, chromosomes = parse_genome_file(genome_file)

    # Create output directory if it doesn't exist
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)

    print(f"Generating templates for {genome_type} genome...")
    print(f"Found {len(chromosomes)} chromosomes")

    # Generate template for each chromosome
    for chr_num, gene_data in chromosomes.items():
        # Skip only completely empty chromosomes (no data at all)
        if not gene_data or not gene_data.strip():
            print(f"Skipping chromosome {chr_num} (completely empty)")
            continue

        num_blocks = count_blocks_in_chromosome(gene_data)
        print(f"Chromosome {chr_num}: {num_blocks} blocks")

        # Generate template
        template = generate_chromosome_template(chr_num, gene_data)

        # Write to file
        filename = f"{genome_type}_genes_chr{chr_num}.json"
        file_path = output_path / filename

        with open(file_path, "w", encoding="utf-8") as f:
            json.dump(template, f, indent=2, ensure_ascii=False)

        print(f"Created {filename} with {len(template)} genes")

    print(f"\\nAll template files created in: {output_path}")


def main():
    """Main function to run the generator."""
    # You can modify these paths as needed
    genome_file = "data/Genes_Roach.txt"  # Horse genome file
    output_dir = "assets/horse"

    # Check if genome file exists
    if not os.path.exists(genome_file):
        print(f"Error: Genome file '{genome_file}' not found!")
        print("Please update the genome_file path in the script.")
        return

    try:
        create_template_files(genome_file, output_dir)
    except Exception as e:
        print(f"Error generating templates: {e}")


if __name__ == "__main__":
    main()
