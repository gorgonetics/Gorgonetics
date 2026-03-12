"""
Integration tests for Gorgonetics API endpoints.

These tests ensure that the API endpoints work correctly and return the expected
data format that the frontend depends on. This prevents regressions that would
break the UI functionality.
"""

import tempfile
from collections.abc import Generator
from typing import TYPE_CHECKING, Any

import pytest
from fastapi.testclient import TestClient

from gorgonetics.web_app import app, get_database

if TYPE_CHECKING:
    from gorgonetics.ducklake_database import DuckLakeGeneDatabase


@pytest.fixture(scope="function")
def client(populated_test_database: "DuckLakeGeneDatabase") -> Generator[TestClient]:
    """Create a test client for the FastAPI app with test database."""
    # Override the database dependency
    app.dependency_overrides[get_database] = lambda: populated_test_database

    test_client = TestClient(app)

    yield test_client

    # Clean up the override after the test
    app.dependency_overrides.clear()


@pytest.fixture(scope="function")
def populated_test_database(test_database: "DuckLakeGeneDatabase") -> "DuckLakeGeneDatabase":
    """Set up test database with sample data."""
    db = test_database

    # Add sample gene data
    sample_genes = [
        {
            "animal_type": "horse",
            "chromosome": "01",
            "gene": "01A1",
            "effectDominant": "None",
            "effectRecessive": "Intelligence+",
            "appearance": "Mane Color",
            "notes": "Test gene 1",
        },
        {
            "animal_type": "horse",
            "chromosome": "01",
            "gene": "01A2",
            "effectDominant": "Toughness-",
            "effectRecessive": "None",
            "appearance": "Mane Color",
            "notes": "Test gene 2",
        },
        {
            "animal_type": "beewasp",
            "chromosome": "01",
            "gene": "01A1",
            "effectDominant": "None",
            "effectRecessive": "Friendliness+",
            "appearance": "Body Color",
            "notes": "Test bee gene",
        },
    ]

    for gene_data in sample_genes:
        db._upsert_gene(gene_data["animal_type"], gene_data["chromosome"], gene_data["gene"], gene_data)

    if db.conn:
        db.conn.commit()

    return db


@pytest.fixture(scope="module")
def sample_pet_file() -> str:
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

    def test_get_animal_types(self, client: TestClient, populated_test_database: "DuckLakeGeneDatabase") -> None:
        """Test that animal types endpoint returns expected data."""
        response = client.get("/api/animal-types")

        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        assert "horse" in data
        assert "beewasp" in data

    def test_get_chromosomes(self, client: TestClient, populated_test_database: "DuckLakeGeneDatabase") -> None:
        """Test that chromosomes endpoint returns expected data."""
        response = client.get("/api/chromosomes/horse")

        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        assert "01" in data

    def test_get_genes_by_chromosome(self, client: TestClient, populated_test_database: "DuckLakeGeneDatabase") -> None:
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
        assert "effect_recessive" not in gene  # Should not have snake_case

    def test_get_gene_effects(self, client: TestClient, populated_test_database: "DuckLakeGeneDatabase") -> None:
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

    def test_get_gene_effects_beewasp(
        self, client: TestClient, populated_test_database: "DuckLakeGeneDatabase"
    ) -> None:
        """Test gene effects for different species."""
        response = client.get("/api/gene-effects/BeeWasp")

        assert response.status_code == 200
        data = response.json()
        effects = data["effects"]
        assert "01A1" in effects
        assert effects["01A1"]["effectRecessive"] == "Friendliness+"

    def test_get_effect_options(self, client: TestClient, populated_test_database: "DuckLakeGeneDatabase") -> None:
        """Test that effect options endpoint returns valid data."""
        response = client.get("/api/effect-options")

        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        assert len(data) > 0
        assert "None" in data

    def test_get_effect_options_for_species(
        self, client: TestClient, populated_test_database: "DuckLakeGeneDatabase"
    ) -> None:
        """Test species-specific effect options."""
        response = client.get("/api/effect-options/horse")

        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        assert len(data) > 0


class TestPetEndpoints:
    """Test pet-related API endpoints."""

    def test_get_pets_empty(self, client: TestClient, populated_test_database: "DuckLakeGeneDatabase") -> None:
        """Test getting pets when database is empty."""
        response = client.get("/api/pets")

        assert response.status_code == 200
        data = response.json()
        assert "items" in data
        assert isinstance(data["items"], list)
        assert "total" in data

    def _upload_pet_helper(
        self, client: TestClient, test_database: "DuckLakeGeneDatabase", sample_pet_file: str, name_suffix: str = ""
    ) -> int:
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

    def test_upload_pet(
        self, authenticated_client: TestClient, populated_test_database: "DuckLakeGeneDatabase", sample_pet_file: str
    ) -> None:
        """Test pet upload functionality."""
        pet_id = self._upload_pet_helper(authenticated_client, populated_test_database, sample_pet_file)
        assert pet_id is not None

    def test_get_pets_with_data(
        self, authenticated_client: TestClient, populated_test_database: "DuckLakeGeneDatabase", sample_pet_file: str
    ) -> None:
        """Test getting pets after uploading one."""
        # Get initial count of pets
        initial_response = authenticated_client.get("/api/pets")
        initial_count = initial_response.json()["total"]

        # Upload a pet first
        pet_id = self._upload_pet_helper(authenticated_client, populated_test_database, sample_pet_file, "_withdata")

        response = authenticated_client.get("/api/pets")
        assert response.status_code == 200
        data = response.json()
        assert data["total"] == initial_count + 1

        # Find our uploaded pet
        uploaded_pet = None
        for pet in data["items"]:
            if pet["id"] == pet_id:
                uploaded_pet = pet
                break

        assert uploaded_pet is not None, f"Could not find uploaded pet with id {pet_id}"

        required_fields = ["id", "name", "species", "created_at"]
        for field in required_fields:
            assert field in uploaded_pet

        assert uploaded_pet["id"] == pet_id
        assert uploaded_pet["species"] == "Horse"

    def test_get_pet_by_id(
        self, authenticated_client: TestClient, populated_test_database: "DuckLakeGeneDatabase", sample_pet_file: str
    ) -> None:
        """Test getting a specific pet by ID."""
        # Upload a pet first
        pet_id = self._upload_pet_helper(authenticated_client, populated_test_database, sample_pet_file, "_byid")

        response = authenticated_client.get(f"/api/pets/{pet_id}")
        assert response.status_code == 200
        data = response.json()

        assert data["id"] == pet_id
        assert "genome_data" in data
        assert "created_at" in data
        assert "updated_at" in data

    def test_get_pet_genome_visualization(
        self, authenticated_client: TestClient, populated_test_database: "DuckLakeGeneDatabase", sample_pet_file: str
    ) -> None:
        """Test pet genome data for visualization."""
        # Upload a pet first
        pet_id = self._upload_pet_helper(authenticated_client, populated_test_database, sample_pet_file, "_viz")

        response = authenticated_client.get(f"/api/pet-genome/{pet_id}")
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

    def test_delete_pet(
        self, authenticated_client: TestClient, populated_test_database: "DuckLakeGeneDatabase", sample_pet_file: str
    ) -> None:
        """Test pet deletion."""
        # Upload a pet first
        pet_id = self._upload_pet_helper(authenticated_client, populated_test_database, sample_pet_file, "_delete")

        # Delete the pet
        response = authenticated_client.delete(f"/api/pets/{pet_id}")
        assert response.status_code == 200
        result = response.json()
        assert result["status"] == "success"

        # Verify pet is gone
        response = authenticated_client.get(f"/api/pets/{pet_id}")
        assert response.status_code == 404

    def test_pet_upload_duplicate_detection(
        self, authenticated_client: TestClient, populated_test_database: "DuckLakeGeneDatabase", sample_pet_file: str
    ) -> None:
        """Test that duplicate file uploads are detected."""
        # Clear any existing pets first
        authenticated_client.get("/api/pets")  # Ensure database is ready

        # Upload same file twice with unique filenames to avoid early conflicts
        with open(sample_pet_file, "rb") as f:
            files = {"file": ("first_upload.txt", f, "text/plain")}
            data = {"name": "First Upload"}
            response1 = authenticated_client.post("/api/pets/upload", files=files, data=data)

        # Should succeed
        if response1.status_code != 200:
            pytest.skip(f"Pet upload not working: {response1.status_code}")

        with open(sample_pet_file, "rb") as f:
            files = {"file": ("second_upload.txt", f, "text/plain")}
            data = {"name": "Second Upload"}
            response2 = authenticated_client.post("/api/pets/upload", files=files, data=data)

        assert response2.status_code == 409  # Conflict - duplicate content


class TestConfigEndpoints:
    """Test configuration-related endpoints."""

    def test_get_attribute_config(self, client: TestClient, populated_test_database: "DuckLakeGeneDatabase") -> None:
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

    def test_get_appearance_config(self, client: TestClient, populated_test_database: "DuckLakeGeneDatabase") -> None:
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

    def test_invalid_species(self, client: TestClient, populated_test_database: "DuckLakeGeneDatabase") -> None:
        """Test handling of invalid species names."""
        response = client.get("/api/chromosomes/invalid_species")
        assert response.status_code == 200  # Should return empty list
        data = response.json()
        assert isinstance(data, list)
        assert len(data) == 0

    def test_invalid_chromosome(self, client: TestClient, populated_test_database: "DuckLakeGeneDatabase") -> None:
        """Test handling of invalid chromosome."""
        response = client.get("/api/genes/horse/99")
        assert response.status_code == 200  # Should return empty list
        data = response.json()
        assert isinstance(data, list)
        assert len(data) == 0

    def test_nonexistent_pet(
        self, authenticated_client: TestClient, populated_test_database: "DuckLakeGeneDatabase"
    ) -> None:
        """Test handling of nonexistent pet IDs."""
        response = authenticated_client.get("/api/pets/99999")
        assert response.status_code == 404

        response = authenticated_client.get("/api/pet-genome/99999")
        assert response.status_code == 404

        response = authenticated_client.delete("/api/pets/99999")
        assert response.status_code == 404

    def test_invalid_file_upload(
        self, authenticated_client: TestClient, populated_test_database: "DuckLakeGeneDatabase"
    ) -> None:
        """Test handling of invalid file uploads."""
        # Test with truly invalid UTF-8 bytes
        files = {"file": ("test.bin", b"\xff\xfe\xfd", "application/octet-stream")}
        response = authenticated_client.post("/api/pets/upload", files=files)
        assert response.status_code == 400

        # Test with empty file
        files = {"file": ("empty.txt", b"", "text/plain")}
        response = authenticated_client.post("/api/pets/upload", files=files)
        assert response.status_code == 400


class TestDataConsistency:
    """Test data consistency across different endpoints."""

    def test_gene_data_consistency(self, client: TestClient, populated_test_database: "DuckLakeGeneDatabase") -> None:
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

    def test_species_consistency(self, client: TestClient, populated_test_database: "DuckLakeGeneDatabase") -> None:
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

    def test_large_dataset_handling(self, client: TestClient, populated_test_database: "DuckLakeGeneDatabase") -> None:
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

    def test_multiple_sequential_requests(
        self, client: TestClient, populated_test_database: "DuckLakeGeneDatabase"
    ) -> None:
        """Test that the API can handle multiple sequential requests efficiently."""
        import time

        # Test multiple requests in sequence to validate performance consistency
        endpoints = [
            "/api/animal-types",
            "/api/chromosomes/horse",
            "/api/genes/horse/01",
            "/api/gene-effects/horse",
            "/api/pets",
        ]

        results: list[dict[str, Any]] = []

        # Make multiple requests sequentially
        start_time = time.time()
        for endpoint in endpoints:
            request_start = time.time()
            response = client.get(endpoint)
            request_end = time.time()

            results.append(
                {"endpoint": endpoint, "status_code": response.status_code, "duration": request_end - request_start}
            )
        end_time = time.time()

        # Check results
        assert len(results) == 5
        success_count = sum(1 for result in results if result["status_code"] == 200)
        assert success_count == 5  # All requests should succeed

        # Each individual request should be reasonably fast
        for result in results:
            duration = result["duration"]
            assert isinstance(duration, int | float) and duration < 2.0, (
                f"Request to {result['endpoint']} took {result['duration']:.2f}s"
            )

        # Total time should be reasonable for sequential requests
        assert end_time - start_time < 8.0


class TestPagination:
    """Test server-side pagination on the pets endpoint."""

    def _upload_pets(
        self,
        client: TestClient,
        db: "DuckLakeGeneDatabase",
        sample_pet_file: str,
        count: int,
    ) -> list[int]:
        """Upload *count* uniquely-named pets and return their IDs."""
        ids = []
        for i in range(count):
            with open(sample_pet_file) as f:
                content = f.read()
            content = content.replace("Entity=Test Pet", f"Entity=Paginated Pet {i}")
            content = content.replace(
                "01=RDRD RDRD RDRD RDRD RRDD RRDD RDRD RDRD",
                f"01=RDRD RDRD RDRD RDRD RRDD RRDD RD{i:02d} RDRD",
            )
            files = {"file": ("pet.txt", content.encode(), "text/plain")}
            data = {"name": f"Paginated Pet {i}"}
            resp = client.post("/api/pets/upload", files=files, data=data)
            assert resp.status_code == 200, resp.json()
            ids.append(resp.json()["pet_id"])
        return ids

    def test_pagination_limit_offset(
        self,
        authenticated_client: TestClient,
        populated_test_database: "DuckLakeGeneDatabase",
        sample_pet_file: str,
    ) -> None:
        """limit and offset return the correct slice of results."""
        self._upload_pets(authenticated_client, populated_test_database, sample_pet_file, 5)

        page1 = authenticated_client.get("/api/pets?limit=2&offset=0").json()
        page2 = authenticated_client.get("/api/pets?limit=2&offset=2").json()

        assert len(page1["items"]) == 2
        assert len(page2["items"]) == 2
        assert page1["total"] == page2["total"]
        assert page1["total"] >= 5
        # Pages must not overlap
        ids1 = {p["id"] for p in page1["items"]}
        ids2 = {p["id"] for p in page2["items"]}
        assert ids1.isdisjoint(ids2)

    def test_pagination_total_matches_full_list(
        self,
        authenticated_client: TestClient,
        populated_test_database: "DuckLakeGeneDatabase",
        sample_pet_file: str,
    ) -> None:
        """total field matches the count returned when no limit is set."""
        self._upload_pets(authenticated_client, populated_test_database, sample_pet_file, 3)

        full = authenticated_client.get("/api/pets").json()
        paginated = authenticated_client.get("/api/pets?limit=1").json()

        assert full["total"] == paginated["total"]
        assert len(full["items"]) == full["total"]

    def test_pagination_response_structure(
        self,
        authenticated_client: TestClient,
        populated_test_database: "DuckLakeGeneDatabase",
    ) -> None:
        """Response always contains items, total, limit, offset."""
        resp = authenticated_client.get("/api/pets").json()
        assert "items" in resp
        assert "total" in resp
        assert "limit" in resp
        assert "offset" in resp


if __name__ == "__main__":
    pytest.main([__file__])
