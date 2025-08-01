"""
Shared utilities for parsing genome files and generating gene data.

This module contains common functions used by both the models and template generation scripts.
"""

from __future__ import annotations

from pathlib import Path


def parse_genome_file_header(file_path: str | Path) -> dict[str, str]:
    """
    Parse a genome file and extract header information.

    Args:
        file_path: Path to the genome file

    Returns:
        Dictionary with header information (format_version, breeder, name, genome_type)
    """
    file_path = Path(file_path)

    with open(file_path, encoding="utf-8") as f:
        lines = f.readlines()

    header_info = {"format_version": "", "breeder": "", "name": "", "genome_type": ""}

    in_overview = False

    for line in lines:
        line = line.strip()

        if line == "[Overview]":
            in_overview = True
            continue
        elif line.startswith("["):
            in_overview = False
            continue

        if in_overview and "=" in line:
            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip()

            if key == "Format":
                header_info["format_version"] = value
            elif key == "Character":
                header_info["breeder"] = value
            elif key == "Entity":
                header_info["name"] = value
            elif key == "Genome":
                header_info["genome_type"] = value

    return header_info


def parse_genome_file_genes(file_path: str | Path) -> dict[str, str]:
    """
    Parse a genome file and extract chromosome gene data.

    Args:
        file_path: Path to the genome file

    Returns:
        Dictionary mapping chromosome numbers to gene data strings
    """
    file_path = Path(file_path)

    with open(file_path, encoding="utf-8") as f:
        lines = f.readlines()

    chromosomes: dict[str, str] = {}
    in_genes = False

    for line in lines:
        line = line.strip()

        if line == "[Genes]":
            in_genes = True
            continue
        elif line.startswith("["):
            in_genes = False
            continue

        if in_genes and "=" in line:
            chr_num, gene_data = line.split("=", 1)
            chr_num = chr_num.strip()
            gene_data = gene_data.strip()
            chromosomes[chr_num] = gene_data

    return chromosomes


def generate_block_letters(num_blocks: int) -> list[str]:
    """
    Generate block letters (A, B, C, ..., Z, AA, AB, ...).

    Args:
        num_blocks: Number of blocks needed

    Returns:
        List of block letter strings
    """
    letters: list[str] = []

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


def count_blocks_in_chromosome(gene_data: str) -> int:
    """
    Count the number of gene blocks in a chromosome.
    Each block is a sequence of gene characters separated by spaces.

    Args:
        gene_data: String containing gene data like "RDRD RDRR ?D?? x?xR"

    Returns:
        Number of blocks
    """
    # Split by spaces and filter out empty strings
    blocks = [block for block in gene_data.split() if block and len(block) >= 2]
    return len(blocks)
