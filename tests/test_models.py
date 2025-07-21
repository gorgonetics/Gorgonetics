"""
Unit tests for pet and genome models.
"""

from pathlib import Path

import pytest

from pgbreeder.models import AttributeValues, Gene, GeneType, Genome, Pet


class TestGeneType:
    """Test the GeneType enum."""

    def test_gene_types(self) -> None:
        """Test gene type values."""
        assert GeneType.RECESSIVE.value == "R"
        assert GeneType.DOMINANT.value == "D"
        assert GeneType.MIXED.value == "x"
        assert GeneType.UNKNOWN.value == "?"


class TestGene:
    """Test the Gene class."""

    def test_gene_creation(self) -> None:
        """Test creating a gene."""
        gene = Gene(chromosome="01", block="A", position=1, gene_type=GeneType.DOMINANT)

        assert gene.chromosome == "01"
        assert gene.block == "A"
        assert gene.position == 1
        assert gene.gene_type == GeneType.DOMINANT

    def test_gene_id(self) -> None:
        """Test gene ID generation."""
        gene = Gene("01", "A", 1, GeneType.DOMINANT)
        assert gene.gene_id == "01A1"

    def test_gene_properties(self) -> None:
        """Test gene property methods."""
        # Test dominant gene
        dominant_gene = Gene("01", "A", 1, GeneType.DOMINANT)
        assert dominant_gene.is_homozygous_dominant
        assert not dominant_gene.is_homozygous_recessive
        assert not dominant_gene.is_heterozygous
        assert dominant_gene.has_dominant_effect
        assert not dominant_gene.is_unknown

        # Test recessive gene
        recessive_gene = Gene("01", "A", 2, GeneType.RECESSIVE)
        assert not recessive_gene.is_homozygous_dominant
        assert recessive_gene.is_homozygous_recessive
        assert not recessive_gene.is_heterozygous
        assert not recessive_gene.has_dominant_effect
        assert not recessive_gene.is_unknown

        # Test mixed gene
        mixed_gene = Gene("01", "A", 3, GeneType.MIXED)
        assert not mixed_gene.is_homozygous_dominant
        assert not mixed_gene.is_homozygous_recessive
        assert mixed_gene.is_heterozygous
        assert mixed_gene.has_dominant_effect
        assert not mixed_gene.is_unknown

        # Test unknown gene
        unknown_gene = Gene("01", "A", 4, GeneType.UNKNOWN)
        assert not unknown_gene.is_homozygous_dominant
        assert not unknown_gene.is_homozygous_recessive
        assert not unknown_gene.is_heterozygous
        assert not unknown_gene.has_dominant_effect
        assert unknown_gene.is_unknown


class TestAttributeValues:
    """Test the AttributeValues class."""

    def test_default_values(self) -> None:
        """Test default attribute values."""
        attrs = AttributeValues()
        assert attrs.intelligence == 0.0
        assert attrs.toughness == 0.0
        assert attrs.speed == 0.0

    def test_get_set_attribute(self) -> None:
        """Test accessing attributes directly."""
        attrs = AttributeValues()

        # Test setting directly
        attrs.intelligence = 75.5
        assert attrs.intelligence == 75.5

        # Test getting directly
        assert attrs.intelligence == 75.5


class TestGenome:
    """Test the Genome class."""

    def test_genome_from_test_data(self) -> None:
        """Test loading genome from actual test file if available."""
        test_file = Path("data/Genes_BabyFaeBee178.txt")

        if test_file.exists():
            genome = Genome.from_file(test_file)

            assert genome.format_version == "v1.0"
            assert genome.breeder == "Konekonyan"
            assert genome.name == "Baby Fae Bee 178"
            assert genome.genome_type == "BeeWasp"
            assert len(genome.genes) == 10  # 10 chromosomes

            # Test chromosome access
            chr1_genes = genome.get_chromosome_genes("01")
            assert len(chr1_genes) > 0

            # Test gene access
            first_gene = chr1_genes[0] if chr1_genes else None
            if first_gene:
                assert first_gene.chromosome == "01"
                assert first_gene.block == "A"
                assert first_gene.position == 1
        else:
            pytest.skip("Test genome file not available")

    def test_parse_chromosome_genes(self) -> None:
        """Test parsing chromosome gene data."""
        # Test simple case
        genes = Genome.parse_chromosome_genes("01", "RDDR")

        assert len(genes) == 4
        assert genes[0].gene_type == GeneType.RECESSIVE
        assert genes[1].gene_type == GeneType.DOMINANT
        assert genes[2].gene_type == GeneType.DOMINANT
        assert genes[3].gene_type == GeneType.RECESSIVE

        # Check positions and blocks
        for i, gene in enumerate(genes):
            assert gene.chromosome == "01"
            assert gene.block == "A"
            assert gene.position == i + 1

    def test_get_gene(self) -> None:
        """Test getting specific genes."""
        genes = Genome.parse_chromosome_genes("01", "RDDR")
        genome = Genome("v1.0", "Test Breeder", "Test Pet", "TestSpecies", {"01": genes})

        gene = genome.get_gene("01A1")
        assert gene is not None
        assert gene.gene_type == GeneType.RECESSIVE

        gene = genome.get_gene("01A2")
        assert gene is not None
        assert gene.gene_type == GeneType.DOMINANT

        # Test non-existent gene
        gene = genome.get_gene("02A1")
        assert gene is None

    def test_genome_serialization(self) -> None:
        """Test genome serialization with cattrs."""
        genes = Genome.parse_chromosome_genes("01", "RDDR")
        genome = Genome("v1.0", "Test Breeder", "Test Genome", "TestSpecies", {"01": genes})

        # Test dict serialization
        genome_dict = genome.to_dict()
        assert genome_dict["genome_type"] == "TestSpecies"
        assert genome_dict["format_version"] == "v1.0"

        # Test round-trip
        restored_genome = Genome.from_dict(genome_dict)
        assert restored_genome.genome_type == "TestSpecies"
        assert restored_genome.format_version == "v1.0"
        assert len(restored_genome.genes) == 1
        assert len(restored_genome.get_chromosome_genes("01")) == 4


class TestPet:
    """Test the Pet class."""

    def test_pet_creation(self) -> None:
        """Test creating a pet with genome."""
        genes = Genome.parse_chromosome_genes("01", "RDDR")
        genome = Genome("v1.0", "Test Breeder", "Test Pet", "TestSpecies", {"01": genes})

        pet = Pet(name="Test Pet", genome=genome)

        assert pet.name == "Test Pet"
        assert pet.species == "TestSpecies"
        assert pet.total_genes == 4
        assert pet.chromosomes == ["01"]

    def test_pet_from_file(self) -> None:
        """Test creating pet from genome file if available."""
        test_file = Path("data/Genes_BabyFaeBee178.txt")

        if test_file.exists():
            pet = Pet.from_genome_file(name="Test Bee", genome_file=test_file, notes="Test pet")

            assert pet.name == "Test Bee"
            assert pet.species == "BeeWasp"
            assert pet.notes == "Test pet"
            assert pet.total_genes > 0

            # Test default attributes are set
            assert pet.attributes.intelligence == 50.0
            assert pet.attributes.toughness == 50.0
        else:
            pytest.skip("Test genome file not available")

    def test_pet_json_export(self) -> None:
        """Test exporting pet to JSON."""
        genes = Genome.parse_chromosome_genes("01", "RD")
        genome = Genome("v1.0", "Test Breeder", "Test Pet", "TestSpecies", {"01": genes})

        pet = Pet(name="Test Pet", genome=genome)

        # Test dict export
        pet_dict = pet.to_dict()
        assert pet_dict["name"] == "Test Pet"
        assert pet_dict["genome"]["genome_type"] == "TestSpecies"

        # Test JSON export
        json_str = pet.to_json()
        assert "Test Pet" in json_str
        assert "TestSpecies" in json_str

        # Test round-trip serialization
        restored_pet = Pet.from_json(json_str)
        assert restored_pet.name == "Test Pet"
        assert restored_pet.species == "TestSpecies"
        assert restored_pet.total_genes == 2

        # Test dict round-trip
        dict_restored = Pet.from_dict(pet_dict)
        assert dict_restored.name == "Test Pet"
        assert dict_restored.species == "TestSpecies"
