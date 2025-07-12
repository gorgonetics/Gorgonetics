"""
Database module for PGBreeder gene data management.

This module handles the DuckDB database operations for storing and retrieving
gene information from the JSON template files.
"""

import json
import logging
from pathlib import Path
from types import TracebackType
from typing import Any

import duckdb

logger = logging.getLogger(__name__)


class GeneDatabase:
    """Database manager for gene data using DuckDB."""

    def __init__(self, db_path: str = "pgbreeder.db"):
        """
        Initialize the gene database.

        Args:
            db_path: Path to the DuckDB database file
        """
        self.db_path = db_path
        self.conn = duckdb.connect(db_path)
        self._create_tables()

    def _create_tables(self) -> None:
        """Create the necessary database tables."""
        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS genes (
                animal_type VARCHAR NOT NULL,
                chromosome VARCHAR NOT NULL,
                gene VARCHAR NOT NULL,
                effect_dominant VARCHAR DEFAULT 'None',
                effect_recessive VARCHAR DEFAULT 'None',
                appearance VARCHAR DEFAULT '|String for me to fill in|',
                notes VARCHAR DEFAULT '|String for me to fill in|',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (animal_type, gene)
            )
        """)

        # Create index for faster lookups
        self.conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_animal_chromosome
            ON genes(animal_type, chromosome)
        """)

    def load_from_json_files(self, assets_dir: str = "assets") -> None:
        """
        Load gene data from JSON template files into the database.

        Args:
            assets_dir: Directory containing the gene JSON files
        """
        assets_path = Path(assets_dir)

        # Load bee/wasp genes
        beewasp_dir = assets_path / "beewasp"
        if beewasp_dir.exists():
            self._load_animal_genes("beewasp", beewasp_dir)

        # Load horse genes
        horse_dir = assets_path / "horse"
        if horse_dir.exists():
            self._load_animal_genes("horse", horse_dir)

        logger.info("Gene data loaded from JSON files")

    def _load_animal_genes(self, animal_type: str, genes_dir: Path) -> None:
        """
        Load genes for a specific animal type from JSON files.

        Args:
            animal_type: Type of animal (beewasp, horse, etc.)
            genes_dir: Directory containing the gene JSON files
        """
        for json_file in genes_dir.glob(f"{animal_type}_genes_chr*.json"):
            # Extract chromosome number from filename
            chr_num = json_file.stem.split("_chr")[1]

            try:
                with open(json_file, encoding="utf-8") as f:
                    genes_data = json.load(f)

                # Insert or update genes
                for gene_data in genes_data:
                    self._upsert_gene(animal_type, chr_num, gene_data)

            except Exception as e:
                logger.error(f"Error loading {json_file}: {e}")

    def _upsert_gene(self, animal_type: str, chromosome: str, gene_data: dict[str, Any]) -> None:
        """
        Insert or update a gene record.

        Args:
            animal_type: Type of animal
            chromosome: Chromosome number
            gene_data: Gene data dictionary
        """
        # Handle both old and new JSON structure
        effect_dominant = gene_data.get("effectDominant") or gene_data.get("effect", "None")
        effect_recessive = gene_data.get("effectRecessive", "None")

        # If using old structure with single effect + trigger
        if "trigger" in gene_data and "effectDominant" not in gene_data:
            trigger = gene_data.get("trigger", "").lower()
            if trigger == "dominant":
                effect_dominant = gene_data.get("effect", "None")
                effect_recessive = "None"
            elif trigger == "recessive":
                effect_dominant = "None"
                effect_recessive = gene_data.get("effect", "None")

        # Check if gene already exists
        existing = self.conn.execute(
            """
            SELECT gene FROM genes WHERE animal_type = ? AND gene = ?
        """,
            [animal_type, gene_data["gene"]],
        ).fetchone()

        if existing:
            # Update existing record
            self.conn.execute(
                """
                UPDATE genes
                SET chromosome = ?, effect_dominant = ?, effect_recessive = ?,
                    appearance = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
                WHERE animal_type = ? AND gene = ?
            """,
                [
                    chromosome,
                    effect_dominant,
                    effect_recessive,
                    gene_data.get("appearance", ""),
                    gene_data.get("notes", ""),
                    animal_type,
                    gene_data["gene"],
                ],
            )
        else:
            # Insert new record
            self.conn.execute(
                """
                INSERT INTO genes (
                    animal_type, chromosome, gene,
                    effect_dominant, effect_recessive, appearance, notes
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
                [
                    animal_type,
                    chromosome,
                    gene_data["gene"],
                    effect_dominant,
                    effect_recessive,
                    gene_data.get("appearance", ""),
                    gene_data.get("notes", ""),
                ],
            )

    def get_animal_types(self) -> list[str]:
        """Get list of available animal types."""
        result = self.conn.execute("SELECT DISTINCT animal_type FROM genes ORDER BY animal_type").fetchall()
        return [row[0] for row in result]

    def get_chromosomes(self, animal_type: str) -> list[str]:
        """
        Get list of chromosomes for an animal type.

        Args:
            animal_type: Type of animal

        Returns:
            List of chromosome numbers
        """
        result = self.conn.execute(
            "SELECT DISTINCT chromosome FROM genes WHERE animal_type = ? ORDER BY chromosome", [animal_type]
        ).fetchall()
        return [row[0] for row in result]

    def get_genes_by_chromosome(self, animal_type: str, chromosome: str) -> list[dict[str, Any]]:
        """
        Get all genes for a specific chromosome.

        Args:
            animal_type: Type of animal
            chromosome: Chromosome number

        Returns:
            List of gene dictionaries
        """
        result = self.conn.execute(
            """
            SELECT gene, effect_dominant, effect_recessive, appearance, notes
            FROM genes
            WHERE animal_type = ? AND chromosome = ?
            ORDER BY gene
        """,
            [animal_type, chromosome],
        ).fetchall()

        return [
            {
                "gene": row[0],
                "effectDominant": row[1] or "None",
                "effectRecessive": row[2] or "None",
                "appearance": row[3] or "",
                "notes": row[4] or "",
            }
            for row in result
        ]

    def get_genes_for_animal(self, animal_type: str) -> list[dict[str, Any]]:
        """
        Get all genes for a specific animal type.

        Args:
            animal_type: Type of animal

        Returns:
            List of gene dictionaries
        """
        result = self.conn.execute(
            """
            SELECT chromosome, gene, effect_dominant, effect_recessive, appearance, notes
            FROM genes
            WHERE animal_type = ?
            ORDER BY chromosome, gene
        """,
            [animal_type],
        ).fetchall()

        return [
            {
                "chromosome": row[0],
                "gene": row[1],
                "effectDominant": row[2] or "None",
                "effectRecessive": row[3] or "None",
                "appearance": row[4] or "",
                "notes": row[5] or "",
            }
            for row in result
        ]

    def update_gene(
        self,
        animal_type: str,
        gene: str,
        effect_dominant: str | None = None,
        effect_recessive: str | None = None,
        appearance: str | None = None,
        notes: str | None = None,
    ) -> bool:
        """
        Update a specific gene.

        Args:
            animal_type: Type of animal
            gene: Gene identifier
            effect_dominant: Dominant effect
            effect_recessive: Recessive effect
            appearance: Appearance description
            notes: Additional notes

        Returns:
            True if update was successful
        """
        try:
            # Build dynamic update query
            updates: list[str] = []
            params: list[str | None] = []

            if effect_dominant is not None:
                updates.append("effect_dominant = ?")
                params.append(effect_dominant)

            if effect_recessive is not None:
                updates.append("effect_recessive = ?")
                params.append(effect_recessive)

            if appearance is not None:
                updates.append("appearance = ?")
                params.append(appearance)

            if notes is not None:
                updates.append("notes = ?")
                params.append(notes)

            if not updates:
                return False

            updates.append("updated_at = CURRENT_TIMESTAMP")
            params.extend([animal_type, gene])

            query = f"""
                UPDATE genes
                SET {", ".join(updates)}
                WHERE animal_type = ? AND gene = ?
            """

            self.conn.execute(query, params)
            return True

        except Exception as e:
            logger.error(f"Error updating gene {gene}: {e}")
            return False

    def get_gene(self, animal_type: str, gene: str) -> dict[str, Any] | None:
        """
        Get a specific gene.

        Args:
            animal_type: Type of animal
            gene: Gene identifier

        Returns:
            Gene dictionary or None if not found
        """
        result = self.conn.execute(
            """
            SELECT chromosome, gene, effect_dominant, effect_recessive, appearance, notes
            FROM genes
            WHERE animal_type = ? AND gene = ?
        """,
            [animal_type, gene],
        ).fetchone()

        if result:
            return {
                "chromosome": result[0],
                "gene": result[1],
                "effectDominant": result[2] or "None",
                "effectRecessive": result[3] or "None",
                "appearance": result[4] or "",
                "notes": result[5] or "",
            }
        return None

    def migrate_cleverness_to_intelligence(self) -> None:
        """Migrate existing 'Cleverness' effects to 'Intelligence' in the database."""
        try:
            # Update dominant effects
            self.conn.execute("""
                UPDATE genes
                SET effect_dominant = REPLACE(effect_dominant, 'Cleverness', 'Intelligence')
                WHERE effect_dominant LIKE '%Cleverness%'
            """)

            # Update recessive effects
            self.conn.execute("""
                UPDATE genes
                SET effect_recessive = REPLACE(effect_recessive, 'Cleverness', 'Intelligence')
                WHERE effect_recessive LIKE '%Cleverness%'
            """)

            logger.info("Successfully migrated Cleverness effects to Intelligence")

        except Exception as e:
            logger.error(f"Error migrating Cleverness to Intelligence: {e}")

    def close(self) -> None:
        """Close the database connection."""
        if self.conn:
            self.conn.close()

    def __enter__(self) -> "GeneDatabase":
        """Context manager entry."""
        return self

    def __exit__(
        self, exc_type: type[BaseException] | None, exc_val: BaseException | None, exc_tb: TracebackType | None
    ) -> None:
        """Context manager exit."""
        self.close()
