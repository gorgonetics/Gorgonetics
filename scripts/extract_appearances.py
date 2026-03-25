import glob
import json


def extract_unique_appearances() -> None:
    unique_appearances: set[str] = set()

    # Get all horse gene JSON files
    pattern = "assets/horse/horse_genes_chr*.json"
    files = glob.glob(pattern)

    for file_path in sorted(files):
        try:
            with open(file_path, encoding="utf-8") as f:
                data = json.load(f)

            for gene in data:
                if "appearance" in gene:
                    appearance = gene["appearance"].strip()
                    if appearance:  # Only add non-empty appearances
                        unique_appearances.add(appearance)

        except Exception as e:
            print(f"Error processing {file_path}: {e}")

    # Sort the appearances for consistent output
    sorted_appearances = sorted(unique_appearances)

    print("=== UNIQUE APPEARANCE VALUES ===")
    for appearance in sorted_appearances:
        print(f"- {appearance}")

    print(f"\nTotal unique appearance values found: {len(sorted_appearances)}")

    # Also separate out ones with breed abbreviations
    breed_abbreviations = [app for app in sorted_appearances if "(" in app and ")" in app]
    if breed_abbreviations:
        print("\n=== APPEARANCE VALUES WITH BREED ABBREVIATIONS ===")
        for appearance in breed_abbreviations:
            print(f"- {appearance}")


if __name__ == "__main__":
    extract_unique_appearances()
