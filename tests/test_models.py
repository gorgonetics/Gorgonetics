"""
Unit tests for pet and genome models.
"""

from pathlib import Path

import pytest

from gorgonetics.models import (
    BeeWaspAttributes,
    CoreAttributes,
    Gene,
    GeneType,
    Genome,
    HorseAttributes,
    Pet,
    create_attribute_values_for_species,
)


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


class TestAttributeValues:
    """Test the AttributeValues class."""

    def test_default_values(self) -> None:
        """Test default attribute values."""
        attrs = create_attribute_values_for_species("BeeWasp")
        assert attrs.intelligence == 50
        assert attrs.toughness == 50

    def test_get_set_attribute(self) -> None:
        """Test accessing attributes directly."""
        attrs = create_attribute_values_for_species("BeeWasp")

        # Test setting directly
        attrs.intelligence = 75
        assert attrs.intelligence == 75

        # Test getting directly
        assert attrs.intelligence == 75

    def test_beewasp_attributes(self) -> None:
        """Test BeeWasp-specific attributes."""
        attrs = create_attribute_values_for_species("BeeWasp")

        # Test core attributes (should have defaults)
        assert attrs.intelligence == 50
        assert attrs.toughness == 50

        # Test BeeWasp-specific attribute
        assert attrs.ferocity == 50

        # Test setting ferocity
        attrs.ferocity = 85
        assert attrs.ferocity == 85

        # Test model_dump includes ferocity
        attrs_dict = attrs.model_dump()
        assert "ferocity" in attrs_dict
        assert attrs_dict["ferocity"] == 85

    def test_horse_attributes(self) -> None:
        """Test Horse-specific attributes."""
        attrs = create_attribute_values_for_species("Horse")

        # Test core attributes (should have defaults)
        assert attrs.intelligence == 50
        assert attrs.toughness == 50

        # Test Horse-specific attribute
        assert attrs.temperament == 50

        # Test setting temperament
        attrs.temperament = 90
        assert attrs.temperament == 90

        # Test model_dump includes temperament
        attrs_dict = attrs.model_dump()
        assert "temperament" in attrs_dict
        assert attrs_dict["temperament"] == 90

    def test_create_attribute_values_for_species(self) -> None:
        """Test creating species-specific attribute values."""
        # Test BeeWasp species
        bee_attrs = create_attribute_values_for_species("BeeWasp")
        assert isinstance(bee_attrs, BeeWaspAttributes)
        assert hasattr(bee_attrs, "ferocity")
        assert bee_attrs.ferocity == 50

        # Test Horse species
        horse_attrs = create_attribute_values_for_species("Horse")
        assert isinstance(horse_attrs, HorseAttributes)
        assert hasattr(horse_attrs, "temperament")
        assert horse_attrs.temperament == 50

        # Test unknown species defaults to core
        unknown_attrs = create_attribute_values_for_species("Unknown")
        assert isinstance(unknown_attrs, CoreAttributes)
        assert not hasattr(unknown_attrs, "ferocity")
        assert not hasattr(unknown_attrs, "temperament")


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
        genome = Genome(
            format_version="v1.0",
            breeder="Test Breeder",
            name="Test Pet",
            genome_type="TestSpecies",
            genes={"01": genes},
        )

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
        """Test genome serialization with Pydantic."""
        genes = Genome.parse_chromosome_genes("01", "RDDR")
        genome = Genome(
            format_version="v1.0",
            breeder="Test Breeder",
            name="Test Genome",
            genome_type="TestSpecies",
            genes={"01": genes},
        )

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
        genome = Genome(
            format_version="v1.0",
            breeder="Test Breeder",
            name="Test Pet",
            genome_type="TestSpecies",
            genes={"01": genes},
        )

        pet = Pet(name="Test Pet", genome=genome)

        assert pet.name == "Test Pet"
        assert pet.genome.genome_type == "TestSpecies"
        assert len(pet.genome.get_all_genes()) == 4
        assert sorted(pet.genome.genes.keys()) == ["01"]

    def test_pet_from_file(self) -> None:
        """Test creating pet from genome file if available."""
        test_file = Path("data/Genes_BabyFaeBee178.txt")

        if test_file.exists():
            pet = Pet.from_genome_file(name="Test Bee", genome_file=test_file, notes="Test pet")

            assert pet.name == "Test Bee"
            assert pet.genome.genome_type == "BeeWasp"
            assert pet.notes == "Test pet"
            assert len(pet.genome.get_all_genes()) > 0

            # Test default attributes are set with species-specific attributes
            assert pet.attributes.intelligence == 50
            assert pet.attributes.toughness == 50
            # BeeWasp should have ferocity
            assert pet.has_attribute("ferocity")
            assert pet.attributes.ferocity == 50
        else:
            pytest.skip("Test genome file not available")

    def test_pet_json_export(self) -> None:
        """Test exporting pet to JSON."""
        genes = Genome.parse_chromosome_genes("01", "RD")
        genome = Genome(
            format_version="v1.0",
            breeder="Test Breeder",
            name="Test Pet",
            genome_type="TestSpecies",
            genes={"01": genes},
        )

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
        assert restored_pet.genome.genome_type == "TestSpecies"
        assert len(restored_pet.genome.get_all_genes()) == 2

        # Test dict round-trip
        dict_restored = Pet.from_dict(pet_dict)
        assert dict_restored.name == "Test Pet"
        assert dict_restored.genome.genome_type == "TestSpecies"
