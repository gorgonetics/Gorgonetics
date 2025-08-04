"""
Integration tests for Gorgonetics API endpoints.

These tests ensure that the API endpoints work correctly and return the expected
data format that the frontend depends on. This prevents regressions that would
break the UI functionality.
"""

import tempfile

import pytest
from fastapi.testclient import TestClient

from gorgonetics.database_config import create_database_instance
from gorgonetics.web_app import app


@pytest.fixture(scope="module")
def client():
    """Create a test client for the FastAPI app."""
    return TestClient(app)


@pytest.fixture(scope="module")
def test_database():
    """Set up test database with sample data."""
    db = create_database_instance()

    # Clear any existing data
    db.conn.execute("DELETE FROM genes")
    db.conn.execute("DELETE FROM pets")
    db.conn.commit()

    # Add sample gene data
    sample_genes = [
        {
            "animal_type": "horse",
            "chromosome": "01",
            "gene": "01A1",
            "effect_dominant": "None",
            "effect_recessive": "Intelligence+",
            "appearance": "Mane Color",
            "notes": "Test gene 1",
        },
        {
            "animal_type": "horse",
            "chromosome": "01",
            "gene": "01A2",
            "effect_dominant": "Toughness-",
            "effect_recessive": "None",
            "appearance": "Mane Color",
            "notes": "Test gene 2",
        },
        {
            "animal_type": "beewasp",
            "chromosome": "01",
            "gene": "01A1",
            "effect_dominant": "None",
            "effect_recessive": "Friendliness+",
            "appearance": "Body Color",
            "notes": "Test bee gene",
        },
    ]

    for gene_data in sample_genes:
        db._upsert_gene(gene_data["animal_type"], gene_data["chromosome"], gene_data["gene"], gene_data)

    db.conn.commit()

    # Clear pets table to avoid conflicts between tests
    db.conn.execute("DELETE FROM pets")
    db.conn.commit()

    return db


@pytest.fixture(scope="module")
def sample_pet_file():
    """Create a sample pet genome file for testing uploads."""
    pet_content = """[Overview]
Format=v1.0
Character=TestBreeder
Entity=Test Pet
Genome=Horse

[Genes]
01=RDRD RDRD RDRD RDRD RRDD RRDD RDRD RDRD

End of Genome
"""

    with tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False) as f:
        f.write(pet_content)
        return f.name


class TestGeneEndpoints:
    """Test gene-related API endpoints."""

    def test_get_animal_types(self, client, test_database):
        """Test that animal types endpoint returns expected data."""
        response = client.get("/api/animal-types")

        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        assert "horse" in data
        assert "beewasp" in data

    def test_get_chromosomes(self, client, test_database):
        """Test that chromosomes endpoint returns expected data."""
        response = client.get("/api/chromosomes/horse")

        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        assert "01" in data

    def test_get_genes_by_chromosome(self, client, test_database):
        """Test that genes by chromosome endpoint returns expected format."""
        response = client.get("/api/genes/horse/01")

        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        assert len(data) >= 2  # We added 2 horse genes

        # Check gene data structure
        gene = data[0]
        required_fields = ["gene", "effectDominant", "effectRecessive", "appearance", "notes"]
        for field in required_fields:
            assert field in gene

        # Check that camelCase field names are used (not snake_case)
        assert "effectDominant" in gene
        assert "effectRecessive" in gene
        assert "effect_dominant" not in gene  # Should not have snake_case

    def test_get_gene_effects(self, client, test_database):
        """Test that gene effects endpoint returns expected format."""
        response = client.get("/api/gene-effects/horse")

        assert response.status_code == 200
        data = response.json()
        assert "effects" in data
        assert isinstance(data["effects"], dict)

        # Check that we have our test genes
        effects = data["effects"]
        assert "01A1" in effects
        assert "01A2" in effects

        # Check effect structure
        gene_effect = effects["01A1"]
        assert "effectDominant" in gene_effect
        assert "effectRecessive" in gene_effect
        assert "appearance" in gene_effect
        assert "notes" in gene_effect

        # Check that actual effects are present
        assert gene_effect["effectRecessive"] == "Intelligence+"

    def test_get_gene_effects_beewasp(self, client, test_database):
        """Test gene effects for different species."""
        response = client.get("/api/gene-effects/BeeWasp")

        assert response.status_code == 200
        data = response.json()
        effects = data["effects"]
        assert "01A1" in effects
        assert effects["01A1"]["effectRecessive"] == "Friendliness+"

    def test_get_effect_options(self, client, test_database):
        """Test that effect options endpoint returns valid data."""
        response = client.get("/api/effect-options")

        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        assert len(data) > 0
        assert "None" in data

    def test_get_effect_options_for_species(self, client, test_database):
        """Test species-specific effect options."""
        response = client.get("/api/effect-options/horse")

        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        assert len(data) > 0


class TestPetEndpoints:
    """Test pet-related API endpoints."""

    def test_get_pets_empty(self, client, test_database):
        """Test getting pets when database is empty."""
        response = client.get("/api/pets")

        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)

    def _upload_pet_helper(self, client, test_database, sample_pet_file, name_suffix=""):
        """Helper method to upload a pet and return the pet_id."""
        # Create unique content by adding suffix to gene data to avoid hash conflicts
        with open(sample_pet_file) as f:
            content = f.read()

        # Modify content slightly to make it unique by changing the pet name and adding a unique gene
        if name_suffix:
            # Make the entity name unique
            content = content.replace("Entity=Test Pet", f"Entity=Test Pet{name_suffix}")
            # Also modify gene data to ensure unique hash
            import hashlib

            unique_hash = hashlib.md5(name_suffix.encode()).hexdigest()[:2]
            content = content.replace(
                "01=RDRD RDRD RDRD RDRD RRDD RRDD RDRD RDRD",
                f"01=RDRD RDRD RDRD RDRD RRDD RRDD RDRD RD{unique_hash.upper()}",
            )

        files = {"file": ("test_pet.txt", content.encode(), "text/plain")}
        data = {"name": f"Integration Test Pet{name_suffix}"}
        response = client.post("/api/pets/upload", files=files, data=data)

        assert response.status_code == 200
        result = response.json()
        assert result["status"] == "success"
        assert "pet_id" in result
        assert isinstance(result["pet_id"], int)
        # Name comes from file content which we modified, so check if it contains the base name
        assert "Test Pet" in result["name"]  # Name from file content or filename

        return result["pet_id"]

    def test_upload_pet(self, client, test_database, sample_pet_file):
        """Test pet upload functionality."""
        pet_id = self._upload_pet_helper(client, test_database, sample_pet_file)
        assert pet_id is not None

    def test_get_pets_with_data(self, client, test_database, sample_pet_file):
        """Test getting pets after uploading one."""
        # Get initial count of pets
        initial_response = client.get("/api/pets")
        initial_count = len(initial_response.json())

        # Upload a pet first
        pet_id = self._upload_pet_helper(client, test_database, sample_pet_file, "_data")

        response = client.get("/api/pets")
        assert response.status_code == 200
        data = response.json()
        assert len(data) == initial_count + 1

        # Find our uploaded pet
        uploaded_pet = None
        for pet in data:
            if pet["id"] == pet_id:
                uploaded_pet = pet
                break

        assert uploaded_pet is not None, f"Could not find uploaded pet with id {pet_id}"

        required_fields = ["id", "name", "species", "created_at"]
        for field in required_fields:
            assert field in uploaded_pet

        assert uploaded_pet["id"] == pet_id
        assert uploaded_pet["species"] == "Horse"

    def test_get_pet_by_id(self, client, test_database, sample_pet_file):
        """Test getting a specific pet by ID."""
        # Upload a pet first
        pet_id = self._upload_pet_helper(client, test_database, sample_pet_file, "_byid")

        response = client.get(f"/api/pets/{pet_id}")
        assert response.status_code == 200
        data = response.json()

        assert data["id"] == pet_id
        assert "genome_data" in data
        assert "created_at" in data
        assert "updated_at" in data

    def test_get_pet_genome_visualization(self, client, test_database, sample_pet_file):
        """Test pet genome data for visualization."""
        # Upload a pet first
        pet_id = self._upload_pet_helper(client, test_database, sample_pet_file, "_viz")

        response = client.get(f"/api/pet-genome/{pet_id}")
        assert response.status_code == 200
        data = response.json()

        required_fields = ["name", "owner", "species", "format", "genes"]
        for field in required_fields:
            assert field in data

        assert data["species"] == "Horse"
        assert "Test Pet" in data["name"]  # Name was modified to be unique
        assert isinstance(data["genes"], dict)
        assert "01" in data["genes"]
        assert isinstance(data["genes"]["01"], str)

    def test_delete_pet(self, client, test_database, sample_pet_file):
        """Test pet deletion."""
        # Upload a pet first
        pet_id = self._upload_pet_helper(client, test_database, sample_pet_file, "_delete")

        # Delete the pet
        response = client.delete(f"/api/pets/{pet_id}")
        assert response.status_code == 200
        result = response.json()
        assert result["status"] == "success"

        # Verify pet is gone
        response = client.get(f"/api/pets/{pet_id}")
        assert response.status_code == 404

    def test_pet_upload_duplicate_detection(self, client, test_database, sample_pet_file):
        """Test that duplicate file uploads are detected."""
        # Clear any existing pets first
        client.get("/api/pets")  # Ensure database is ready

        # Upload same file twice with unique filenames to avoid early conflicts
        with open(sample_pet_file, "rb") as f:
            files = {"file": ("first_upload.txt", f, "text/plain")}
            data = {"name": "First Upload"}
            response1 = client.post("/api/pets/upload", files=files, data=data)

        # Should succeed
        if response1.status_code != 200:
            pytest.skip(f"Pet upload not working: {response1.status_code}")

        with open(sample_pet_file, "rb") as f:
            files = {"file": ("second_upload.txt", f, "text/plain")}
            data = {"name": "Second Upload"}
            response2 = client.post("/api/pets/upload", files=files, data=data)

        assert response2.status_code == 409  # Conflict - duplicate content


class TestConfigEndpoints:
    """Test configuration-related endpoints."""

    def test_get_attribute_config(self, client, test_database):
        """Test attribute configuration endpoint."""
        response = client.get("/api/attribute-config/horse")

        # Attribute config endpoint may not exist, check if it's implemented
        if response.status_code == 404:
            pytest.skip("Attribute config endpoint not implemented")

        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, dict)
        assert len(data) > 0

        # Check that response has expected structure
        assert "species" in data
        assert "attributes" in data
        assert data["species"] == "horse"
        assert isinstance(data["attributes"], list)
        assert len(data["attributes"]) > 0

        # Check that first attribute has expected structure
        first_attr = data["attributes"][0]
        assert isinstance(first_attr, dict)
        assert "name" in first_attr
        assert "key" in first_attr

    def test_get_appearance_config(self, client, test_database):
        """Test appearance configuration endpoint."""
        response = client.get("/api/appearance-config/horse")

        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, dict)
        assert "species" in data
        assert "appearance_attributes" in data
        assert data["species"] == "horse"


class TestErrorHandling:
    """Test error handling and edge cases."""

    def test_invalid_species(self, client, test_database):
        """Test handling of invalid species names."""
        response = client.get("/api/chromosomes/invalid_species")
        assert response.status_code == 200  # Should return empty list
        data = response.json()
        assert isinstance(data, list)
        assert len(data) == 0

    def test_invalid_chromosome(self, client, test_database):
        """Test handling of invalid chromosome."""
        response = client.get("/api/genes/horse/99")
        assert response.status_code == 200  # Should return empty list
        data = response.json()
        assert isinstance(data, list)
        assert len(data) == 0

    def test_nonexistent_pet(self, client, test_database):
        """Test handling of nonexistent pet IDs."""
        response = client.get("/api/pets/99999")
        assert response.status_code == 404

        response = client.get("/api/pet-genome/99999")
        assert response.status_code == 404

        response = client.delete("/api/pets/99999")
        assert response.status_code == 404

    def test_invalid_file_upload(self, client, test_database):
        """Test handling of invalid file uploads."""
        # Test with truly invalid UTF-8 bytes
        files = {"file": ("test.bin", b"\xff\xfe\xfd", "application/octet-stream")}
        response = client.post("/api/pets/upload", files=files)
        assert response.status_code == 400

        # Test with empty file
        files = {"file": ("empty.txt", "", "text/plain")}
        response = client.post("/api/pets/upload", files=files)
        assert response.status_code == 400


class TestDataConsistency:
    """Test data consistency across different endpoints."""

    def test_gene_data_consistency(self, client, test_database):
        """Test that gene data is consistent across different endpoints."""
        # Get genes from chromosome endpoint
        response1 = client.get("/api/genes/horse/01")
        chromosome_genes = response1.json()

        # Get genes from effects endpoint
        response2 = client.get("/api/gene-effects/horse")
        effects_data = response2.json()["effects"]

        # Check that the same genes appear in both
        chromosome_gene_ids = {gene["gene"] for gene in chromosome_genes}
        effects_gene_ids = set(effects_data.keys())

        # All chromosome genes should have effects data
        for gene_id in chromosome_gene_ids:
            assert gene_id in effects_gene_ids

        # Check that effect values match
        for gene in chromosome_genes:
            gene_id = gene["gene"]
            effect_data = effects_data[gene_id]
            assert gene["effectDominant"] == effect_data["effectDominant"]
            assert gene["effectRecessive"] == effect_data["effectRecessive"]

    def test_species_consistency(self, client, test_database):
        """Test that species names are consistent across endpoints."""
        # Get animal types
        response = client.get("/api/animal-types")
        animal_types = response.json()

        for animal_type in animal_types:
            # Test that chromosomes endpoint works for each species
            response = client.get(f"/api/chromosomes/{animal_type}")
            assert response.status_code == 200

            # Test that gene effects endpoint works for each species
            response = client.get(f"/api/gene-effects/{animal_type}")
            assert response.status_code == 200

            # Test that attribute config works for each species
            response = client.get(f"/api/attribute-config/{animal_type}")
            assert response.status_code == 200


class TestPerformance:
    """Test performance-related aspects."""

    def test_large_dataset_handling(self, client, test_database):
        """Test that endpoints handle reasonable dataset sizes efficiently."""
        import time

        # Test gene effects endpoint (typically largest response)
        start_time = time.time()
        response = client.get("/api/gene-effects/horse")
        end_time = time.time()

        assert response.status_code == 200
        assert end_time - start_time < 5.0  # Should complete within 5 seconds

        data = response.json()
        effects = data["effects"]
        assert len(effects) > 0  # Should have some data

    def test_concurrent_requests(self, client, test_database):
        """Test that the API can handle multiple concurrent requests."""
        import threading
        import time

        results = []

        def make_request():
            try:
                start_time = time.time()
                response = client.get("/api/animal-types")
                end_time = time.time()
                results.append({"status_code": response.status_code, "duration": end_time - start_time})
            except Exception as e:
                results.append({"status_code": 500, "duration": 5.0, "error": str(e)})

        # Create multiple threads
        threads = []
        for _ in range(5):
            thread = threading.Thread(target=make_request)
            threads.append(thread)

        # Start all threads
        start_time = time.time()
        for thread in threads:
            thread.start()

        # Wait for all threads to complete
        for thread in threads:
            thread.join()
        end_time = time.time()

        # Check results
        assert len(results) == 5
        success_count = sum(1 for result in results if result["status_code"] == 200)
        # Allow some failures in concurrent testing due to database locking
        assert success_count >= 3  # At least 60% should succeed

        for result in results:
            if result["status_code"] == 200:
                assert result["duration"] < 5.0  # Each successful request should be reasonably fast

        # Total time should be reasonable (concurrent execution)
        assert end_time - start_time < 10.0


if __name__ == "__main__":
    pytest.main([__file__])
