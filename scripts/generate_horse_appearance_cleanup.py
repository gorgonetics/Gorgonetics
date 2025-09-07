#!/usr/bin/env python3
"""
Script to generate the cleaned up horse appearance attributes for AttributeConfig.
This script was used to create the grouped appearance attributes from gene files.

Usage:
    uv run python scripts/generate_horse_appearance_cleanup.py

The script extracts all appearance values from horse gene files and groups them
by their base attribute name (e.g., "Scale", "Coat", etc.) rather than having
separate entries for each breed variant.
"""

import json
import os
from pathlib import Path


def main():
    # Horse breed abbreviation mapping
    HORSE_BREED_ABBREVIATIONS = {
        "Sb": "Standardbred",
        "Kb": "Kurbone",
        "Il": "Ilmarian",
        "Po": "Plateau Pony",
        "Sc": "Satincoat",
        "St": "Statehelm",
        "Bl": "Blanketed",
        "Le": "Leopard",
        "Pt": "Paint",
        "Cl": "Calico",
    }

    # Load all horse gene files
    gene_files_dir = Path("assets/horse")
    appearances = set()

    for file_path in gene_files_dir.glob("*_genes_*.json"):
        with open(file_path, "r", encoding="utf-8") as f:
            file_data = json.load(f)
            for gene in file_data:
                if "appearance" in gene and gene["appearance"] and gene["appearance"].strip() not in ["None", ""]:
                    appearances.add(gene["appearance"].strip())

    # Group appearances by base name
    base_attributes = {}
    for appearance in appearances:
        # Extract base name (before parentheses if any)
        if "(" in appearance:
            base_name = appearance.split("(")[0].strip()
        else:
            base_name = appearance

        # Normalize base name to key
        base_key = base_name.lower().replace(" ", "-")

        if base_key not in base_attributes:
            base_attributes[base_key] = {"display_name": base_name, "variants": []}

        base_attributes[base_key]["variants"].append(appearance)

    # Generate hardcoded attributes with colors
    colors = [
        "#e74c3c",
        "#3498db",
        "#2ecc71",
        "#f39c12",
        "#9b59b6",
        "#1abc9c",
        "#34495e",
        "#e67e22",
        "#16a085",
        "#27ae60",
        "#2980b9",
        "#8e44ad",
        "#f1c40f",
        "#d35400",
        "#c0392b",
    ]

    print('        "horse": {')
    print("            # Horse appearance attributes (grouped by base attribute from gene files)")
    for i, (key, info) in enumerate(sorted(base_attributes.items())):
        color = colors[i % len(colors)]
        variant_count = len(info["variants"])

        print(f'            "{key}": {{')
        print(f'                "name": "{info["display_name"]}",')
        if variant_count > 1:
            print(f'                "examples": "{info["display_name"]} effects (all breeds)",')
        else:
            print(f'                "examples": "{info["display_name"]} effects",')
        print(f'                "color_indicator": "{color}",')
        print(f"            }},")
    print("        },")

    print()
    print("# Variants found for each base attribute:")
    for key, info in sorted(base_attributes.items()):
        if len(info["variants"]) > 1:
            print(f"# {info['display_name']}: {len(info['variants'])} variants - {', '.join(sorted(info['variants']))}")
        else:
            print(f"# {info['display_name']}: {info['variants'][0]}")


if __name__ == "__main__":
    main()
